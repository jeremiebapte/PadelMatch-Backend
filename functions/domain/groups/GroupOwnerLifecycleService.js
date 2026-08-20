import {
  GroupMembershipStatus,
  GroupRole,
} from "./GroupEnums.js";

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function timestampMillis(value) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();

    return Number.isFinite(millis)
      ? millis
      : Number.MAX_SAFE_INTEGER;
  }

  if (
    typeof value.seconds === "number"
  ) {
    const nanoseconds =
      typeof value.nanoseconds === "number"
        ? value.nanoseconds
        : 0;

    return (
      value.seconds * 1000
      + Math.floor(nanoseconds / 1_000_000)
    );
  }

  if (value instanceof Date) {
    const millis = value.getTime();

    return Number.isFinite(millis)
      ? millis
      : Number.MAX_SAFE_INTEGER;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : Number.MAX_SAFE_INTEGER;
  }

  return Number.MAX_SAFE_INTEGER;
}

function membershipAgeMillis(membership) {
  const joinedAt =
    timestampMillis(
      membership?.joinedAt
    );

  if (
    joinedAt !== Number.MAX_SAFE_INTEGER
  ) {
    return joinedAt;
  }

  return timestampMillis(
    membership?.createdAt
  );
}

export function compareOwnershipCandidates(
  left,
  right
) {
  const leftRole =
    left?.role === GroupRole.ADMIN
      ? 0
      : 1;

  const rightRole =
    right?.role === GroupRole.ADMIN
      ? 0
      : 1;

  if (leftRole !== rightRole) {
    return leftRole - rightRole;
  }

  const leftAge =
    membershipAgeMillis(left);

  const rightAge =
    membershipAgeMillis(right);

  if (leftAge !== rightAge) {
    return leftAge - rightAge;
  }

  return asTrimmedString(left?.userId)
    .localeCompare(
      asTrimmedString(right?.userId)
    );
}

export function selectOwnershipSuccessor({
  memberships,
  departingOwnerUid,
}) {
  const ownerUid =
    asTrimmedString(
      departingOwnerUid
    );

  if (!Array.isArray(memberships)) {
    return null;
  }

  const candidates =
    memberships
      .filter((membership) => {
        const userId =
          asTrimmedString(
            membership?.userId
          );

        return (
          userId
          && userId !== ownerUid
          && membership?.status
            === GroupMembershipStatus.ACTIVE
          && (
            membership?.role
              === GroupRole.ADMIN
            || membership?.role
              === GroupRole.MEMBER
          )
        );
      })
      .sort(
        compareOwnershipCandidates
      );

  return candidates[0] ?? null;
}

async function updateQueryInBatches({
  db,
  query,
  buildUpdate,
  batchSize = 400,
}) {
  let updatedCount = 0;

  while (true) {
    const snapshot =
      await query
        .limit(batchSize)
        .get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();

    for (const document of snapshot.docs) {
      batch.update(
        document.ref,
        buildUpdate(
          document.data() ?? {},
          document.id
        )
      );
    }

    await batch.commit();

    updatedCount += snapshot.size;

    if (snapshot.size < batchSize) {
      break;
    }
  }

  return updatedCount;
}

async function deleteQueryInBatches({
  db,
  query,
  batchSize = 400,
}) {
  let deletedCount = 0;

  while (true) {
    const snapshot =
      await query
        .limit(batchSize)
        .get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();

    for (const document of snapshot.docs) {
      batch.delete(document.ref);
    }

    await batch.commit();

    deletedCount += snapshot.size;

    if (snapshot.size < batchSize) {
      break;
    }
  }

  return deletedCount;
}

export function buildHandleUserGroupOwnershipLifecycle({
  db,
  FieldValue,
  logger,
  recordGroupActivity,
  recordUserActivity,
  authAdmin,
}) {
  if (!db) {
    throw new TypeError("DB_REQUIRED");
  }

  if (!FieldValue?.serverTimestamp) {
    throw new TypeError("FIELD_VALUE_REQUIRED");
  }

  if (typeof recordGroupActivity !== "function") {
    throw new TypeError(
      "GROUP_ACTIVITY_RECORDER_REQUIRED"
    );
  }

  if (typeof recordUserActivity !== "function") {
    throw new TypeError(
      "USER_ACTIVITY_RECORDER_REQUIRED"
    );
  }

  if (!authAdmin || typeof authAdmin.getUser !== "function") {
    throw new TypeError(
      "AUTH_ADMIN_REQUIRED"
    );
  }

  async function candidateAccountIsValid(userId) {
    const uid = asTrimmedString(userId);

    if (!uid) {
      return false;
    }

    const userSnapshot =
      await db
        .collection("users")
        .doc(uid)
        .get();

    if (!userSnapshot.exists) {
      return false;
    }

    try {
      await authAdmin.getUser(uid);
      return true;
    } catch (error) {
      if (error?.code === "auth/user-not-found") {
        return false;
      }

      throw error;
    }
  }

  return async function handleUserGroupOwnershipLifecycle(
    rawUserId
  ) {
    const departingOwnerUid =
      asTrimmedString(rawUserId);

    if (!departingOwnerUid) {
      throw new Error(
        "DEPARTING_OWNER_UID_REQUIRED"
      );
    }

    const groupsSnapshot =
      await db
        .collection("groups")
        .where(
          "ownerUid",
          "==",
          departingOwnerUid
        )
        .get();

    const results = [];

    for (const groupDocument of groupsSnapshot.docs) {
      const initialGroup =
        groupDocument.data() ?? {};

      /*
       * Un groupe déjà supprimé PAR CE LIFECYCLE peut avoir
       * besoin de reprendre son cleanup si une écriture
       * secondaire a échoué après la transaction métier.
       *
       * Tous les autres groupes inactifs restent intouchables.
       */
      const initialDeletionCleanupRetry =
        initialGroup.status === "deleted"
        && initialGroup.deletionReason
          === "owner_account_deleted"
        && asTrimmedString(
          initialGroup.deletedByUid
        ) === departingOwnerUid
        && asTrimmedString(
          initialGroup.ownerUid
        ) === departingOwnerUid;

      if (
        initialGroup.status !== "active"
        && !initialDeletionCleanupRetry
      ) {
        results.push({
          groupId: groupDocument.id,
          action: "skipped_inactive",
        });

        continue;
      }

      const groupId =
        asTrimmedString(
          initialGroup.groupId
        ) || groupDocument.id;

      const groupRef =
        groupDocument.ref;

      const activeMembershipsQuery =
        db
          .collection("groupMemberships")
          .where(
            "groupId",
            "==",
            groupId
          )
          .where(
            "status",
            "==",
            GroupMembershipStatus.ACTIVE
          );

      const transactionResult =
        await db.runTransaction(
          async (transaction) => {
            const [
              groupSnapshot,
              activeMembershipsSnapshot,
            ] = await Promise.all([
              transaction.get(groupRef),
              transaction.get(
                activeMembershipsQuery
              ),
            ]);

            if (!groupSnapshot.exists) {
              return {
                groupId,
                action: "skipped_missing",
              };
            }

            const group =
              groupSnapshot.data() ?? {};

            /*
             * Retry-safe :
             *
             * Si cette suppression logique a déjà été commise,
             * on ne recrée aucune activité et on ne retouche
             * pas l'état métier. On indique seulement au code
             * hors transaction qu'il doit reprendre le cleanup.
             */
            const deletionCleanupRetry =
              group.status === "deleted"
              && group.deletionReason
                === "owner_account_deleted"
              && asTrimmedString(
                group.deletedByUid
              ) === departingOwnerUid
              && asTrimmedString(
                group.ownerUid
              ) === departingOwnerUid;

            if (deletionCleanupRetry) {
              return {
                groupId,
                action:
                  "group_deleted_cleanup_resume",
                previousOwnerUid:
                  departingOwnerUid,
              };
            }

            /*
             * Idempotence / concurrence :
             * si quelqu'un a déjà changé le propriétaire ou
             * désactivé le groupe autrement, on ne touche rien.
             */
            if (
              group.status !== "active"
              || asTrimmedString(
                group.ownerUid
              ) !== departingOwnerUid
            ) {
              return {
                groupId,
                action:
                  "skipped_already_resolved",
              };
            }

            const activeDocuments =
              activeMembershipsSnapshot.docs;

            const activeMemberships =
              activeDocuments.map(
                (document) => ({
                  ...(document.data() ?? {}),
                  __ref: document.ref,
                })
              );

            const departingOwnerDocument =
              activeDocuments.find(
                (document) =>
                  asTrimmedString(
                    document.data()?.userId
                  ) === departingOwnerUid
              ) ?? null;

            const rankedCandidates =
              activeMemberships
                .filter((membership) => {
                  const userId =
                    asTrimmedString(
                      membership?.userId
                    );

                  return (
                    userId
                    && userId !== departingOwnerUid
                    && membership?.status
                      === GroupMembershipStatus.ACTIVE
                    && (
                      membership?.role
                        === GroupRole.ADMIN
                      || membership?.role
                        === GroupRole.MEMBER
                    )
                  );
                })
                .sort(
                  compareOwnershipCandidates
                );

            const validCandidates = [];
            const invalidCandidates = [];

            /*
             * On valide TOUS les membres actifs, pas seulement
             * jusqu'au premier successeur.
             *
             * Cela permet :
             * - de choisir un owner réellement valide ;
             * - de retirer les memberships de comptes morts ;
             * - de recalculer stats.memberCount correctement.
             */
            for (
              const candidate
              of rankedCandidates
            ) {
              if (
                await candidateAccountIsValid(
                  candidate.userId
                )
              ) {
                validCandidates.push(
                  candidate
                );

                continue;
              }

              invalidCandidates.push(
                candidate
              );

              logger?.warn?.(
                "group ownership candidate ignored: invalid account",
                {
                  groupId,
                  candidateUid:
                    asTrimmedString(
                      candidate.userId
                    ),
                }
              );
            }

            const successor =
              validCandidates[0] ?? null;

            const now =
              FieldValue.serverTimestamp();

            const departingOwnerMembership =
              departingOwnerDocument?.data?.()
              ?? {};

            const departingOwnerUserSnapshot =
              await transaction.get(
                db
                  .collection("users")
                  .doc(departingOwnerUid)
              );

            const departingOwnerUser =
              departingOwnerUserSnapshot.exists
                ? departingOwnerUserSnapshot.data() ?? {}
                : {};

            const departingOwnerPseudo =
              asTrimmedString(
                departingOwnerUser.pseudo
              )
              || asTrimmedString(
                departingOwnerMembership.userPseudoSnapshot
              )
              || asTrimmedString(
                departingOwnerMembership.pseudoSnapshot
              )
              || "un ancien membre";

            /*
             * ==================================================
             * CAS A — le groupe survit
             * ==================================================
             */
            if (successor) {
              const successorUid =
                asTrimmedString(
                  successor.userId
                );

              const successorDocument =
                activeDocuments.find(
                  (document) =>
                    asTrimmedString(
                      document.data()?.userId
                    ) === successorUid
                );

              if (!successorDocument) {
                throw new Error(
                  "SUCCESSOR_MEMBERSHIP_NOT_FOUND"
                );
              }

              const previousSuccessorRole =
                successor.role;

              /*
               * Les comptes Auth/Firestore invalides ne doivent
               * plus rester membres actifs du groupe.
               */
              for (
                const invalidCandidate
                of invalidCandidates
              ) {
                const invalidRef =
                  invalidCandidate.__ref;

                if (!invalidRef) {
                  throw new Error(
                    "INVALID_CANDIDATE_REF_MISSING"
                  );
                }

                transaction.update(
                  invalidRef,
                  {
                    status:
                      GroupMembershipStatus.REMOVED,

                    removedAt:
                      now,

                    removedByUid:
                      "system",

                    updatedAt:
                      now,

                    notificationsEnabled:
                      false,

                    matchNotificationsEnabled:
                      false,

                    messageNotificationsEnabled:
                      false,

                    removalReason:
                      "account_missing_during_owner_transfer",
                  }
                );
              }

              const remainingActiveCount =
                validCandidates.length;

              transaction.update(
                groupRef,
                {
                  ownerUid:
                    successorUid,
                  updatedAt:
                    now,
                  "stats.memberCount":
                    remainingActiveCount,

                  ownershipTransferredAt:
                    now,
                  ownershipTransferredFromUid:
                    departingOwnerUid,
                  ownershipTransferReason:
                    "owner_account_deleted",
                }
              );

              transaction.update(
                successorDocument.ref,
                {
                  role:
                    GroupRole.OWNER,
                  roleUpdatedAt:
                    now,
                  roleUpdatedByUid:
                    departingOwnerUid,

                  ownershipAcquiredAt:
                    now,
                  ownershipAcquiredReason:
                    "owner_account_deleted",

                  updatedAt:
                    now,
                }
              );

              if (departingOwnerDocument) {
                transaction.update(
                  departingOwnerDocument.ref,
                  {
                    status:
                      GroupMembershipStatus.REMOVED,

                    removedAt:
                      now,
                    removedByUid:
                      departingOwnerUid,
                    updatedAt:
                      now,

                    notificationsEnabled:
                      false,
                    matchNotificationsEnabled:
                      false,
                    messageNotificationsEnabled:
                      false,
                  }
                );
              }

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,

                    type:
                      "ownership_transferred",

                    actorUid:
                      "system",

                    visibility:
                      "members",

                    createdAt:
                      now,

                    targetUserId:
                      successorUid,

                    targetPseudoSnapshot:
                      asTrimmedString(
                        successor
                          .userPseudoSnapshot
                      )
                      || asTrimmedString(
                        successor
                          .pseudoSnapshot
                      )
                      || undefined,

                    metadata: {
                      reason:
                        "owner_account_deleted",

                      previousOwnerUid:
                        departingOwnerUid,

                      previousOwnerPseudo:
                        departingOwnerPseudo,

                      newOwnerUid:
                        successorUid,

                      previousSuccessorRole,

                      remainingActiveMemberCount:
                        remainingActiveCount,
                    },

                    deduplicationKey:
                      `ownership_transfer:${groupId}:${departingOwnerUid}:${successorUid}`,
                  },
                  {
                    transaction,
                  }
                );

              const groupName =
                asTrimmedString(
                  group.name
                )
                || asTrimmedString(
                  group.title
                )
                || "Groupe Padima";

              /*
               * Projection personnelle pour le Centre d'activité.
               *
               * On réutilise group_member_role_changed,
               * déjà supporté par les clients iOS/Android.
               * La source métier reste l'activité
               * ownership_transferred ci-dessus.
               */
              const userActivityId =
                await recordUserActivity(
                  {
                    userId:
                      successorUid,

                    type:
                      "group_member_role_changed",

                    entityType:
                      "group",

                    entityId:
                      groupId,

                    title:
                      "Tu prends les commandes 👑",

                    subtitle:
                      `Suite à la suppression du compte de ${departingOwnerPseudo}, tu deviens propriétaire de « ${groupName} ». Le groupe continue avec toi !`,

                    sourceType:
                      "group_owner_lifecycle",

                    sourceId:
                      `group_ownership_transferred:${groupId}:${successorUid}`,

                    createdAt:
                      now,

                    groupId,

                    metadata: {
                      action:
                        "ownership_transferred",

                      previousRole:
                        previousSuccessorRole,

                      nextRole:
                        GroupRole.OWNER,

                      previousOwnerUid:
                        departingOwnerUid,

                      previousOwnerPseudo:
                        departingOwnerPseudo,

                      newOwnerUid:
                        successorUid,

                      reason:
                        "owner_account_deleted",
                    },
                  },
                  {
                    transaction,
                  }
                );

              return {
                groupId,
                action:
                  "ownership_transferred",
                previousOwnerUid:
                  departingOwnerUid,
                newOwnerUid:
                  successorUid,
                previousSuccessorRole,
                activityId,
                userActivityId,
                remainingActiveCount,
              };
            }

            /*
             * ==================================================
             * CAS B — plus aucun membre capable de reprendre
             * le groupe : suppression logique.
             * ==================================================
             */

            transaction.update(
              groupRef,
              {
                status:
                  "deleted",

                deletedAt:
                  now,
                deletedByUid:
                  departingOwnerUid,
                updatedAt:
                  now,

                discoverability:
                  "hidden",

                linkJoinEnabled:
                  false,

                "stats.memberCount":
                  0,

                deletionReason:
                  "owner_account_deleted",
              }
            );

            if (departingOwnerDocument) {
              transaction.update(
                departingOwnerDocument.ref,
                {
                  status:
                    GroupMembershipStatus.REMOVED,

                  removedAt:
                    now,
                  removedByUid:
                    departingOwnerUid,
                  updatedAt:
                    now,

                  notificationsEnabled:
                    false,
                  matchNotificationsEnabled:
                    false,
                  messageNotificationsEnabled:
                    false,
                }
              );
            }

            const activityId =
              await recordGroupActivity(
                {
                  groupId,

                  type:
                    "group_deleted",

                  actorUid:
                    "system",

                  visibility:
                    "admins",

                  createdAt:
                    now,

                  metadata: {
                    previousStatus:
                      group.status,

                    nextStatus:
                      "deleted",

                    reason:
                      "owner_account_deleted",

                    previousOwnerUid:
                      departingOwnerUid,
                  },

                  deduplicationKey:
                    `delete_group_owner_account:${groupId}:${departingOwnerUid}`,
                },
                {
                  transaction,
                }
              );

            return {
              groupId,
              action:
                "group_deleted",
              previousOwnerUid:
                departingOwnerUid,
              activityId,
            };
          }
        );

      /*
       * Le cleanup lourd reste hors transaction, comme dans
       * deleteGroup.js.
       */
      if (
        transactionResult.action
          === "group_deleted"
        || transactionResult.action
          === "group_deleted_cleanup_resume"
      ) {
        const cleanupNow =
          FieldValue.serverTimestamp();

        const membershipsUpdated =
          await updateQueryInBatches({
            db,

            query:
              db
                .collection(
                  "groupMemberships"
                )
                .where(
                  "groupId",
                  "==",
                  groupId
                )
                .where(
                  "status",
                  "==",
                  GroupMembershipStatus.ACTIVE
                ),

            buildUpdate:
              () => ({
                status:
                  GroupMembershipStatus
                    .REMOVED,

                removedAt:
                  cleanupNow,
                removedByUid:
                  departingOwnerUid,
                updatedAt:
                  cleanupNow,

                notificationsEnabled:
                  false,
                matchNotificationsEnabled:
                  false,
                messageNotificationsEnabled:
                  false,
              }),
          });

        const invitationsRevoked =
          await updateQueryInBatches({
            db,

            query:
              db
                .collection(
                  "groupInvites"
                )
                .where(
                  "groupId",
                  "==",
                  groupId
                )
                .where(
                  "status",
                  "==",
                  "pending"
                ),

            buildUpdate:
              () => ({
                status:
                  "revoked",

                revokedAt:
                  cleanupNow,
                updatedAt:
                  cleanupNow,

                statusChangedByUid:
                  departingOwnerUid,
              }),
          });

        const joinRequestsCancelled =
          await updateQueryInBatches({
            db,

            query:
              db
                .collection(
                  "groupJoinRequests"
                )
                .where(
                  "groupId",
                  "==",
                  groupId
                )
                .where(
                  "status",
                  "==",
                  "pending"
                ),

            buildUpdate:
              () => ({
                status:
                  "cancelled",

                resolvedAt:
                  cleanupNow,
                resolvedByUid:
                  departingOwnerUid,
                updatedAt:
                  cleanupNow,
              }),
          });

        const notificationQueueDeleted =
          await deleteQueryInBatches({
            db,

            query:
              db
                .collection(
                  "groupChatNotificationQueue"
                )
                .where(
                  "groupId",
                  "==",
                  groupId
                ),
          });

        Object.assign(
          transactionResult,
          {
            cleanup: {
              membershipsUpdated,
              invitationsRevoked,
              joinRequestsCancelled,
              notificationQueueDeleted,
            },
          }
        );
      }

      results.push(
        transactionResult
      );
    }

    const summary = {
      userId:
        departingOwnerUid,

      groupsFound:
        groupsSnapshot.size,

      ownershipTransferred:
        results.filter(
          (result) =>
            result.action
              === "ownership_transferred"
        ).length,

      groupsDeleted:
        results.filter(
          (result) =>
            result.action
              === "group_deleted"
        ).length,

      skipped:
        results.filter(
          (result) =>
            result.action.startsWith(
              "skipped_"
            )
        ).length,

      results,
    };

    logger?.info?.(
      "group owner lifecycle resolved",
      summary
    );

    return summary;
  };
}
