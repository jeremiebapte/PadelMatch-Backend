// Path: functions/leaveGroup.js
// ======================================================
// Padima — Mes Groupes V1
// Callable leaveGroup
//
// Permet à un membre ou à un administrateur actif de
// quitter volontairement un groupe.
//
// Le propriétaire ne peut pas quitter directement le
// groupe : il devra transférer la propriété ou supprimer
// le groupe.
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupMembershipStatus,
  GroupPermissionError,
  GroupRole,
  GroupValidationError,
  assertActiveMember,
  assertGroupActive,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateGroupId,
} from "./domain/groups/index.js";

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function mapLeaveGroupError(
  error,
  HttpsError
) {
  if (error instanceof HttpsError) {
    return error;
  }

  if (
    error instanceof
    GroupValidationError
  ) {
    return new HttpsError(
      "invalid-argument",
      error.code,
      {
        field: error.field,
        code: error.code,
      }
    );
  }

  if (
    error instanceof
    GroupPermissionError
  ) {
    switch (error.code) {
      case "GROUP_NOT_ACTIVE":
      case "ACTIVE_MEMBERSHIP_REQUIRED":
        return new HttpsError(
          "failed-precondition",
          error.code
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

    case "OWNER_CANNOT_LEAVE_GROUP":
      return new HttpsError(
        "failed-precondition",
        "OWNER_CANNOT_LEAVE_GROUP"
      );

    default:
      return new HttpsError(
        "internal",
        "LEAVE_GROUP_INTERNAL"
      );
  }
}

export function buildLeaveGroup({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
}) {
  if (typeof onCall !== "function") {
    throw new TypeError(
      "ON_CALL_REQUIRED"
    );
  }

  if (
    typeof HttpsError !== "function"
  ) {
    throw new TypeError(
      "HTTPS_ERROR_REQUIRED"
    );
  }

  if (!db) {
    throw new TypeError(
      "DB_REQUIRED"
    );
  }

  if (
    !FieldValue?.serverTimestamp ||
    !FieldValue?.increment
  ) {
    throw new TypeError(
      "FIELD_VALUE_REQUIRED"
    );
  }

  const recordGroupActivity =
    createGroupActivityRecorder({
      db,
      logger,
    });

  return onCall(
    runtime,
    async (req) => {
      const uid =
        req.auth?.uid;

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

        const membershipId =
          membershipDocumentId(
            groupId,
            uid
          );

        const membershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(membershipId);

        const userRef =
          db
            .collection("users")
            .doc(uid);

        const result =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                membershipSnapshot,
                userSnapshot,
              ] = await Promise.all([
                transaction.get(
                  groupRef
                ),
                transaction.get(
                  membershipRef
                ),
                transaction.get(
                  userRef
                ),
              ]);

              if (
                !groupSnapshot.exists
              ) {
                throw codedError(
                  "GROUP_NOT_FOUND"
                );
              }

              if (
                !membershipSnapshot.exists
              ) {
                throw codedError(
                  "MEMBERSHIP_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() ??
                {};

              const membership =
                membershipSnapshot.data() ??
                {};

              const user =
                userSnapshot.exists
                  ? userSnapshot.data() ??
                    {}
                  : {};

              assertGroupActive(
                group
              );

              assertActiveMember(
                membership
              );

              if (
                membership.role ===
                GroupRole.OWNER
              ) {
                throw codedError(
                  "OWNER_CANNOT_LEAVE_GROUP"
                );
              }

              const now =
                FieldValue
                  .serverTimestamp();

              transaction.update(
                membershipRef,
                {
                  status:
                    GroupMembershipStatus
                      .LEFT,
                  leftAt: now,
                  updatedAt: now,
                  removedAt: null,
                  removedByUid: null,
                }
              );

              transaction.update(
                groupRef,
                {
                  "stats.memberCount":
                    FieldValue.increment(
                      -1
                    ),
                  updatedAt: now,
                }
              );

              const actorPseudo =
                asTrimmedString(
                  user.pseudo
                ) ||
                asTrimmedString(
                  membership
                    .userPseudoSnapshot
                ) ||
                asTrimmedString(
                  membership
                    .pseudoSnapshot
                ) ||
                "Joueur";

              const actorAvatar =
                asTrimmedString(
                  user.avatar
                ) ||
                asTrimmedString(
                  user.photoURL
                ) ||
                asTrimmedString(
                  user.photoUrl
                ) ||
                asTrimmedString(
                  membership
                    .userAvatarSnapshot
                ) ||
                asTrimmedString(
                  membership
                    .avatarSnapshot
                );

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .MEMBER_LEFT,
                    actorUid: uid,
                    targetUserId: uid,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,
                    actorPseudoSnapshot:
                      actorPseudo,
                    targetPseudoSnapshot:
                      actorPseudo,

                    ...(actorAvatar
                      ? {
                          actorAvatarSnapshot:
                            actorAvatar,
                        }
                      : {}),

                    metadata: {
                      membershipId,
                      previousRole:
                        membership.role,
                      previousStatus:
                        membership.status,
                      nextStatus:
                        GroupMembershipStatus
                          .LEFT,
                    },

                    deduplicationKey:
                      `leave_group:${groupId}:${uid}:${Date.now()}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                groupId,
                membershipId,
                previousRole:
                  membership.role,
                status:
                  GroupMembershipStatus
                    .LEFT,
                activityId,
              };
            }
          );

        logger?.info?.(
          "leaveGroup ok",
          {
            uid,
            groupId:
              result.groupId,
            membershipId:
              result.membershipId,
            previousRole:
              result.previousRole,
            status:
              result.status,
          }
        );

        return {
          ok: true,
          groupId:
            result.groupId,
          membershipId:
            result.membershipId,
          role:
            result.previousRole,
          status:
            result.status,
          activityId:
            result.activityId,
        };
      } catch (error) {
        logger?.error?.(
          "leaveGroup failed",
          {
            uid,
            groupId:
              req.data?.groupId,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            message:
              String(
                error?.message ??
                  error
              ),
          }
        );

        throw mapLeaveGroupError(
          error,
          HttpsError
        );
      }
    }
  );
}