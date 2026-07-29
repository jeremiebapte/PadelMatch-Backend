// Path: functions/manageGroupMember.js
// ======================================================
// Padima — Mes Groupes V1
// Callable manageGroupMember
//
// Actions supportées :
// - promote_to_admin
// - demote_to_member
// - remove_from_group
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupMembershipError,
  GroupMembershipStatus,
  GroupPermissionError,
  GroupRole,
  GroupValidationError,
  assertActiveMember,
  assertCanManageTarget,
  assertGroupActive,
  assertOwner,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateGroupId,
  validateUserId,
} from "./domain/groups/index.js";

const GroupMemberAction = Object.freeze({
  PROMOTE_TO_ADMIN: "promote_to_admin",
  DEMOTE_TO_MEMBER: "demote_to_member",
  REMOVE_FROM_GROUP: "remove_from_group",
});

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function validateAction(value) {
  const action = asTrimmedString(value);

  if (!Object.values(GroupMemberAction).includes(action)) {
    const error = new Error("INVALID_MEMBER_ACTION");
    error.code = "INVALID_MEMBER_ACTION";
    throw error;
  }

  return action;
}

function mapManageGroupMemberError(
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
        field: error.field,
        code: error.code,
      }
    );
  }

  if (error instanceof GroupMembershipError) {
    switch (error.code) {
      case "INVALID_MEMBERSHIP_ROLE":
        return new HttpsError(
          "invalid-argument",
          error.code
        );

      case "OWNER_TRANSFER_REQUIRED":
      case "OWNER_REQUIRED_FOR_TRANSFER":
        return new HttpsError(
          "permission-denied",
          error.code
        );

      default:
        return new HttpsError(
          "failed-precondition",
          error.code
        );
    }
  }

  if (error instanceof GroupPermissionError) {
    switch (error.code) {
      case "GROUP_NOT_ACTIVE":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      case "ACTIVE_MEMBERSHIP_REQUIRED":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      case "TARGET_MEMBERSHIP_NOT_FOUND":
        return new HttpsError(
          "not-found",
          error.code
        );

      case "ADMIN_REQUIRED":
      case "OWNER_REQUIRED":
      case "OWNER_CANNOT_BE_MANAGED":
      case "OWNER_REQUIRED_FOR_ADMIN_TARGET":
        return new HttpsError(
          "permission-denied",
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
    case "INVALID_MEMBER_ACTION":
      return new HttpsError(
        "invalid-argument",
        "INVALID_MEMBER_ACTION"
      );

    case "GROUP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "GROUP_NOT_FOUND"
      );

    case "MEMBERSHIP_NOT_FOUND":
      return new HttpsError(
        "permission-denied",
        "MEMBERSHIP_NOT_FOUND"
      );

    case "TARGET_MEMBERSHIP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "TARGET_MEMBERSHIP_NOT_FOUND"
      );

    case "TARGET_MEMBERSHIP_NOT_ACTIVE":
      return new HttpsError(
        "failed-precondition",
        "TARGET_MEMBERSHIP_NOT_ACTIVE"
      );

    case "SELF_MANAGEMENT_NOT_ALLOWED":
      return new HttpsError(
        "permission-denied",
        "SELF_MANAGEMENT_NOT_ALLOWED"
      );

    case "TARGET_ALREADY_ADMIN":
      return new HttpsError(
        "already-exists",
        "TARGET_ALREADY_ADMIN"
      );

    case "TARGET_NOT_MEMBER":
      return new HttpsError(
        "failed-precondition",
        "TARGET_NOT_MEMBER"
      );

    case "TARGET_NOT_ADMIN":
      return new HttpsError(
        "failed-precondition",
        "TARGET_NOT_ADMIN"
      );

    default:
      return new HttpsError(
        "internal",
        "MANAGE_GROUP_MEMBER_INTERNAL"
      );
  }
}

export function buildManageGroupMember({
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

  if (!FieldValue?.serverTimestamp) {
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

        const targetUserId =
          validateUserId(
            req.data?.targetUserId,
            "targetUserId"
          );

        const action =
          validateAction(
            req.data?.action
          );

        if (uid === targetUserId) {
          const error =
            new Error(
              "SELF_MANAGEMENT_NOT_ALLOWED"
            );

          error.code =
            "SELF_MANAGEMENT_NOT_ALLOWED";

          throw error;
        }

        const groupRef =
          db
            .collection("groups")
            .doc(groupId);

        const actorMembershipRef =
          db
            .collection("groupMemberships")
            .doc(
              membershipDocumentId(
                groupId,
                uid
              )
            );

        const targetMembershipRef =
          db
            .collection("groupMemberships")
            .doc(
              membershipDocumentId(
                groupId,
                targetUserId
              )
            );

        const actorUserRef =
          db
            .collection("users")
            .doc(uid);

        const targetUserRef =
          db
            .collection("users")
            .doc(targetUserId);

        const result =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                actorMembershipSnapshot,
                targetMembershipSnapshot,
                actorUserSnapshot,
                targetUserSnapshot,
              ] = await Promise.all([
                transaction.get(groupRef),
                transaction.get(
                  actorMembershipRef
                ),
                transaction.get(
                  targetMembershipRef
                ),
                transaction.get(
                  actorUserRef
                ),
                transaction.get(
                  targetUserRef
                ),
              ]);

              if (!groupSnapshot.exists) {
                const error =
                  new Error(
                    "GROUP_NOT_FOUND"
                  );

                error.code =
                  "GROUP_NOT_FOUND";

                throw error;
              }

              if (
                !actorMembershipSnapshot.exists
              ) {
                const error =
                  new Error(
                    "MEMBERSHIP_NOT_FOUND"
                  );

                error.code =
                  "MEMBERSHIP_NOT_FOUND";

                throw error;
              }

              if (
                !targetMembershipSnapshot.exists
              ) {
                const error =
                  new Error(
                    "TARGET_MEMBERSHIP_NOT_FOUND"
                  );

                error.code =
                  "TARGET_MEMBERSHIP_NOT_FOUND";

                throw error;
              }

              const group =
                groupSnapshot.data() ?? {};

              const actorMembership =
                actorMembershipSnapshot.data() ??
                {};

              const targetMembership =
                targetMembershipSnapshot.data() ??
                {};

              const actorUser =
                actorUserSnapshot.exists
                  ? actorUserSnapshot.data() ?? {}
                  : {};

              const targetUser =
                targetUserSnapshot.exists
                  ? targetUserSnapshot.data() ?? {}
                  : {};

              assertGroupActive(group);
              assertActiveMember(actorMembership);
              assertActiveMember(targetMembership);

              assertCanManageTarget(
                actorMembership,
                targetMembership
              );

              const previousRole =
                targetMembership.role;

              const now =
                FieldValue.serverTimestamp();

              let nextRole =
                previousRole;

              let nextStatus =
                targetMembership.status;

              let activityType =
                GroupActivityType
                  .MEMBER_ROLE_CHANGED;

              const membershipUpdates = {
                updatedAt: now,
              };

              switch (action) {
                case GroupMemberAction
                  .PROMOTE_TO_ADMIN:
                  assertOwner(
                    actorMembership
                  );

                  if (
                    previousRole ===
                    GroupRole.ADMIN
                  ) {
                    const error =
                      new Error(
                        "TARGET_ALREADY_ADMIN"
                      );

                    error.code =
                      "TARGET_ALREADY_ADMIN";

                    throw error;
                  }

                  if (
                    previousRole !==
                    GroupRole.MEMBER
                  ) {
                    const error =
                      new Error(
                        "TARGET_NOT_MEMBER"
                      );

                    error.code =
                      "TARGET_NOT_MEMBER";

                    throw error;
                  }

                  nextRole =
                    GroupRole.ADMIN;

                  membershipUpdates.role =
                    nextRole;

                  membershipUpdates
                    .roleUpdatedAt =
                    now;

                  membershipUpdates
                    .roleUpdatedByUid =
                    uid;

                  break;

                case GroupMemberAction
                  .DEMOTE_TO_MEMBER:
                  assertOwner(
                    actorMembership
                  );

                  if (
                    previousRole !==
                    GroupRole.ADMIN
                  ) {
                    const error =
                      new Error(
                        "TARGET_NOT_ADMIN"
                      );

                    error.code =
                      "TARGET_NOT_ADMIN";

                    throw error;
                  }

                  nextRole =
                    GroupRole.MEMBER;

                  membershipUpdates.role =
                    nextRole;

                  membershipUpdates
                    .roleUpdatedAt =
                    now;

                  membershipUpdates
                    .roleUpdatedByUid =
                    uid;

                  break;

                case GroupMemberAction
                  .REMOVE_FROM_GROUP:
                  nextStatus =
                    GroupMembershipStatus
                      .REMOVED;

                  activityType =
                    GroupActivityType
                      .MEMBER_REMOVED;

                  membershipUpdates.status =
                    nextStatus;

                  membershipUpdates
                    .removedAt =
                    now;

                  membershipUpdates
                    .removedByUid =
                    uid;

                  break;

                default: {
                  const error =
                    new Error(
                      "INVALID_MEMBER_ACTION"
                    );

                  error.code =
                    "INVALID_MEMBER_ACTION";

                  throw error;
                }
              }

              transaction.update(
                targetMembershipRef,
                membershipUpdates
              );

              const actorPseudo =
                asTrimmedString(
                  actorUser.pseudo
                ) ||
                asTrimmedString(
                  actorMembership
                    .pseudoSnapshot
                ) ||
                "Joueur";

              const actorAvatar =
                asTrimmedString(
                  actorUser.avatar
                ) ||
                asTrimmedString(
                  actorUser.photoURL
                ) ||
                asTrimmedString(
                  actorUser.photoUrl
                ) ||
                asTrimmedString(
                  actorMembership
                    .avatarSnapshot
                );

              const targetPseudo =
                asTrimmedString(
                  targetUser.pseudo
                ) ||
                asTrimmedString(
                  targetMembership
                    .pseudoSnapshot
                ) ||
                "Joueur";

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      activityType,
                    actorUid:
                      uid,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt:
                      now,
                    targetUserId,
                    actorPseudoSnapshot:
                      actorPseudo,
                    targetPseudoSnapshot:
                      targetPseudo,

                    ...(actorAvatar
                      ? {
                          actorAvatarSnapshot:
                            actorAvatar,
                        }
                      : {}),

                    metadata: {
                      action,
                      previousRole,
                      nextRole,
                      previousStatus:
                        targetMembership.status,
                      nextStatus,
                    },

                    deduplicationKey:
                      `manage_group_member:${groupId}:${targetUserId}:${action}:${Date.now()}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                groupId,
                targetUserId,
                action,
                previousRole,
                nextRole,
                nextStatus,
                activityId,
              };
            }
          );

        logger?.info?.(
          "manageGroupMember ok",
          {
            uid,
            groupId:
              result.groupId,
            targetUserId:
              result.targetUserId,
            action:
              result.action,
            previousRole:
              result.previousRole,
            nextRole:
              result.nextRole,
            nextStatus:
              result.nextStatus,
          }
        );

        return {
          ok: true,
          groupId:
            result.groupId,
          targetUserId:
            result.targetUserId,
          action:
            result.action,
          previousRole:
            result.previousRole,
          role:
            result.nextRole,
          status:
            result.nextStatus,
          activityId:
            result.activityId,
        };
      } catch (error) {
        logger?.error?.(
          "manageGroupMember failed",
          {
            uid,
            groupId:
              req.data?.groupId,
            targetUserId:
              req.data?.targetUserId,
            action:
              req.data?.action,
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

        throw mapManageGroupMemberError(
          error,
          HttpsError
        );
      }
    }
  );
}
