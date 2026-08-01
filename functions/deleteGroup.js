// Path: functions/deleteGroup.js
// ======================================================
// Padima — suppression logique d'un groupe.
//
// Réservé au propriétaire actif.
//
// Le groupe et ses données historiques sont conservés.
// Les accès actifs, invitations, demandes et files de
// notifications sont désactivés.
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupInviteStatus,
  GroupJoinRequestStatus,
  GroupMembershipStatus,
  GroupPermissionError,
  GroupStatus,
  GroupValidationError,
  assertActiveMember,
  assertGroupActive,
  assertOwner,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateGroupId,
} from "./domain/groups/index.js";

const CLEANUP_BATCH_SIZE = 400;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function mapDeleteGroupError(
  error,
  HttpsError
) {
  if (error instanceof HttpsError) {
    return error;
  }

  if (error instanceof GroupValidationError) {
    return new HttpsError(
      "invalid-argument",
      error.code,
      {
        code: error.code,
        field: error.field,
      }
    );
  }

  if (error instanceof GroupPermissionError) {
    switch (error.code) {
      case "GROUP_NOT_ACTIVE":
      case "ACTIVE_MEMBERSHIP_REQUIRED":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      case "OWNER_REQUIRED":
        return new HttpsError(
          "permission-denied",
          "OWNER_REQUIRED"
        );

      default:
        return new HttpsError(
          "permission-denied",
          "GROUP_PERMISSION_DENIED"
        );
    }
  }

  switch (error?.code) {
    case "GROUP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "GROUP_NOT_FOUND"
      );

    case "MEMBERSHIP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "MEMBERSHIP_NOT_FOUND"
      );

    default:
      return new HttpsError(
        "internal",
        "DELETE_GROUP_INTERNAL"
      );
  }
}

async function updateQueryInBatches({
  db,
  query,
  buildUpdate,
}) {
  let updatedCount = 0;

  while (true) {
    const snapshot =
      await query
        .limit(CLEANUP_BATCH_SIZE)
        .get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();

    for (const document of snapshot.docs) {
      batch.update(
        document.ref,
        buildUpdate(
          document.data() || {},
          document.id
        )
      );
    }

    await batch.commit();

    updatedCount += snapshot.size;

    if (snapshot.size < CLEANUP_BATCH_SIZE) {
      break;
    }
  }

  return updatedCount;
}

async function deleteQueryInBatches({
  db,
  query,
}) {
  let deletedCount = 0;

  while (true) {
    const snapshot =
      await query
        .limit(CLEANUP_BATCH_SIZE)
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

    if (snapshot.size < CLEANUP_BATCH_SIZE) {
      break;
    }
  }

  return deletedCount;
}

export function buildDeleteGroup({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
}) {
  if (typeof onCall !== "function") {
    throw new TypeError("ON_CALL_REQUIRED");
  }

  if (typeof HttpsError !== "function") {
    throw new TypeError("HTTPS_ERROR_REQUIRED");
  }

  if (!db) {
    throw new TypeError("DB_REQUIRED");
  }

  if (
    !FieldValue?.serverTimestamp
  ) {
    throw new TypeError("FIELD_VALUE_REQUIRED");
  }

  const recordGroupActivity =
    createGroupActivityRecorder({
      db,
      logger,
    });

  return onCall(
    runtime,
    async (req) => {
      const uid = req.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "UNAUTHENTICATED"
        );
      }

      try {
        const groupId =
          validateGroupId(
            req.data?.groupId
          );

        const groupRef =
          db
            .collection("groups")
            .doc(groupId);

        const ownerMembershipId =
          membershipDocumentId(
            groupId,
            uid
          );

        const ownerMembershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(ownerMembershipId);

        const userRef =
          db
            .collection("users")
            .doc(uid);

        const transactionResult =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                membershipSnapshot,
                userSnapshot,
              ] = await Promise.all([
                transaction.get(groupRef),
                transaction.get(
                  ownerMembershipRef
                ),
                transaction.get(userRef),
              ]);

              if (!groupSnapshot.exists) {
                throw codedError(
                  "GROUP_NOT_FOUND"
                );
              }

              if (!membershipSnapshot.exists) {
                throw codedError(
                  "MEMBERSHIP_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() || {};

              const membership =
                membershipSnapshot.data() || {};

              const user =
                userSnapshot.exists
                  ? userSnapshot.data() || {}
                  : {};

              const alreadyDeletedByCurrentOwner =
                group.status ===
                  GroupStatus.DELETED
                && group.deletedByUid === uid
                && membership.role === "owner";

              if (!alreadyDeletedByCurrentOwner) {
                assertGroupActive(group);
                assertActiveMember(membership);
                assertOwner(membership);
              }

              const now =
                FieldValue.serverTimestamp();

              if (!alreadyDeletedByCurrentOwner) {
                transaction.update(
                  groupRef,
                  {
                    status:
                      GroupStatus.DELETED,

                    deletedAt: now,
                    deletedByUid: uid,
                    updatedAt: now,

                    discoverability:
                      "hidden",

                    linkJoinEnabled:
                      false,

                    "stats.memberCount":
                      0,
                  }
                );

                transaction.update(
                  ownerMembershipRef,
                  {
                    status:
                      GroupMembershipStatus.REMOVED,

                    removedAt: now,
                    removedByUid: uid,
                    updatedAt: now,

                    notificationsEnabled:
                      false,

                    matchNotificationsEnabled:
                      false,

                    messageNotificationsEnabled:
                      false,
                  }
                );
              }

              const actorPseudo =
                asString(user.pseudo)
                || asString(
                  membership
                    .userPseudoSnapshot
                )
                || asString(
                  membership
                    .pseudoSnapshot
                )
                || "Joueur";

              const actorAvatar =
                asString(user.avatar)
                || asString(user.photoURL)
                || asString(user.photoUrl)
                || asString(
                  membership
                    .userAvatarSnapshot
                )
                || asString(
                  membership
                    .avatarSnapshot
                );

              let activityId =
                asString(
                  group.deleteActivityId
                );

              if (!alreadyDeletedByCurrentOwner) {
                activityId =
                  await recordGroupActivity(
                    {
                      groupId,

                      type:
                        GroupActivityType
                          .GROUP_DELETED,

                      visibility:
                        GroupActivityVisibility
                          .ADMINS,

                      actorUid: uid,
                      createdAt: now,

                      actorPseudoSnapshot:
                        actorPseudo,

                      ...(actorAvatar
                        ? {
                            actorAvatarSnapshot:
                              actorAvatar,
                          }
                        : {}),

                      metadata: {
                        previousStatus:
                          group.status,

                        nextStatus:
                          GroupStatus.DELETED,

                        ownerMembershipId,
                      },

                      deduplicationKey:
                        `delete_group:${groupId}`,
                    },
                    {
                      transaction,
                    }
                  );

                transaction.update(
                  groupRef,
                  {
                    deleteActivityId:
                      activityId,
                  }
                );
              }

              return {
                groupId,
                activityId,
                resumedCleanup:
                  alreadyDeletedByCurrentOwner,
              };
            }
          );

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
                  uid,

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
                  GroupInviteStatus.PENDING
                ),

            buildUpdate:
              () => ({
                status:
                  GroupInviteStatus
                    .REVOKED,

                revokedAt:
                  cleanupNow,

                updatedAt:
                  cleanupNow,

                statusChangedByUid:
                  uid,
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
                  GroupJoinRequestStatus
                    .PENDING
                ),

            buildUpdate:
              () => ({
                status:
                  GroupJoinRequestStatus
                    .CANCELLED,

                resolvedAt:
                  cleanupNow,

                resolvedByUid:
                  uid,

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

        logger?.info?.(
          "deleteGroup ok",
          {
            uid,
            groupId,
            activityId:
              transactionResult.activityId,
            resumedCleanup:
              transactionResult.resumedCleanup,
            membershipsUpdated,
            invitationsRevoked,
            joinRequestsCancelled,
            notificationQueueDeleted,
          }
        );

        return {
          ok: true,
          groupId,
          status:
            GroupStatus.DELETED,
          activityId:
            transactionResult.activityId,
          resumedCleanup:
            transactionResult.resumedCleanup,
          cleanup: {
            membershipsUpdated,
            invitationsRevoked,
            joinRequestsCancelled,
            notificationQueueDeleted,
          },
        };
      } catch (error) {
        logger?.error?.(
          "deleteGroup failed",
          {
            uid,
            groupId:
              req.data?.groupId,
            code:
              error?.code
              || error?.name
              || "UNKNOWN_ERROR",
            message:
              String(
                error?.message
                || error
              ),
          }
        );

        throw mapDeleteGroupError(
          error,
          HttpsError
        );
      }
    }
  );
}
