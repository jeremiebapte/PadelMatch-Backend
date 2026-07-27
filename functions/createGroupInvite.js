// Path: functions/createGroupInvite.js
// ======================================================
// Padima — Mes Groupes V1
// Callable createGroupInvite
// Invitation directe d’un utilisateur
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupInviteError,
  GroupInviteStatus,
  GroupInviteValidationError,
  GroupPermissionError,
  GroupValidationError,
  assertCanInvitePlayers,
  buildDirectGroupInvite,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateCreateDirectInviteInput,
} from "./domain/groups/index.js";

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function mapCreateGroupInviteError(
  error,
  HttpsError
) {
  if (error instanceof HttpsError) {
    return error;
  }

  if (
    error instanceof
      GroupInviteValidationError ||
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
        return new HttpsError(
          "failed-precondition",
          "GROUP_NOT_ACTIVE"
        );

      case "ACTIVE_MEMBERSHIP_REQUIRED":
      case "INVITATION_NOT_ALLOWED":
        return new HttpsError(
          "permission-denied",
          error.code
        );

      default:
        return new HttpsError(
          "permission-denied",
          error.code ??
            "INVITATION_NOT_ALLOWED"
        );
    }
  }

  if (
    error instanceof GroupInviteError
  ) {
    switch (error.code) {
      case "CANNOT_INVITE_SELF":
        return new HttpsError(
          "invalid-argument",
          "CANNOT_INVITE_SELF"
        );

      default:
        return new HttpsError(
          "failed-precondition",
          error.code ??
            "CREATE_GROUP_INVITE_FAILED"
        );
    }
  }

  switch (error?.code) {
    case "GROUP_NOT_FOUND":
    case "TARGET_USER_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    case "INVITER_PROFILE_NOT_FOUND":
      return new HttpsError(
        "failed-precondition",
        "INVITER_PROFILE_NOT_FOUND"
      );

    case "TARGET_ALREADY_MEMBER":
      return new HttpsError(
        "already-exists",
        "TARGET_ALREADY_MEMBER"
      );

    case "PENDING_INVITE_ALREADY_EXISTS":
      return new HttpsError(
        "already-exists",
        "PENDING_INVITE_ALREADY_EXISTS",
        {
          inviteId:
            error.inviteId ?? null,
        }
      );

    default:
      return new HttpsError(
        "internal",
        "CREATE_GROUP_INVITE_INTERNAL"
      );
  }
}

function codedError(
  code,
  extra = {}
) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function buildCreateGroupInvite({
  onCall,
  HttpsError,
  runtime,
  db,
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
        const validatedInput =
          validateCreateDirectInviteInput(
            req.data ?? {}
          );

        const {
          groupId,
          targetUserId,
        } = validatedInput;

        if (targetUserId === uid) {
          throw new GroupInviteError(
            "CANNOT_INVITE_SELF"
          );
        }

        const inviteRef =
          db
            .collection("groupInvites")
            .doc();

        const inviterMembershipId =
          membershipDocumentId(
            groupId,
            uid
          );

        const targetMembershipId =
          membershipDocumentId(
            groupId,
            targetUserId
          );

        const groupRef =
          db
            .collection("groups")
            .doc(groupId);

        const inviterUserRef =
          db
            .collection("users")
            .doc(uid);

        const targetUserRef =
          db
            .collection("users")
            .doc(targetUserId);

        const inviterMembershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(inviterMembershipId);

        const targetMembershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(targetMembershipId);

        const pendingInviteQuery =
          db
            .collection("groupInvites")
            .where(
              "groupId",
              "==",
              groupId
            )
            .where(
              "targetUserId",
              "==",
              targetUserId
            )
            .where(
              "status",
              "==",
              GroupInviteStatus.PENDING
            )
            .limit(1);

        const result =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                inviterUserSnapshot,
                targetUserSnapshot,
                inviterMembershipSnapshot,
                targetMembershipSnapshot,
                pendingInviteSnapshot,
              ] = await Promise.all([
                transaction.get(groupRef),
                transaction.get(
                  inviterUserRef
                ),
                transaction.get(
                  targetUserRef
                ),
                transaction.get(
                  inviterMembershipRef
                ),
                transaction.get(
                  targetMembershipRef
                ),
                transaction.get(
                  pendingInviteQuery
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
                !inviterUserSnapshot.exists
              ) {
                throw codedError(
                  "INVITER_PROFILE_NOT_FOUND"
                );
              }

              if (
                !targetUserSnapshot.exists
              ) {
                throw codedError(
                  "TARGET_USER_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() ?? {};

              const inviterMembership =
                inviterMembershipSnapshot
                  .exists
                  ? inviterMembershipSnapshot
                      .data()
                  : null;

              assertCanInvitePlayers(
                group,
                inviterMembership
              );

              if (
                targetMembershipSnapshot
                  .exists
              ) {
                const targetMembership =
                  targetMembershipSnapshot
                    .data() ?? {};

                if (
                  targetMembership.status ===
                  "active"
                ) {
                  throw codedError(
                    "TARGET_ALREADY_MEMBER"
                  );
                }
              }

              if (
                !pendingInviteSnapshot.empty
              ) {
                throw codedError(
                  "PENDING_INVITE_ALREADY_EXISTS",
                  {
                    inviteId:
                      pendingInviteSnapshot
                        .docs[0]
                        .id,
                  }
                );
              }

              const now = new Date();

              const inviterUser =
                inviterUserSnapshot
                  .data() ?? {};

              const targetUser =
                targetUserSnapshot
                  .data() ?? {};

              const invite =
                buildDirectGroupInvite({
                  inviteId:
                    inviteRef.id,
                  input:
                    validatedInput,
                  inviterUid: uid,
                  group,
                  inviterUser,
                  targetUser,
                  now,
                });

              transaction.create(
                inviteRef,
                invite
              );

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .MEMBER_INVITED,
                    actorUid: uid,
                    targetUserId,
                    inviteId:
                      inviteRef.id,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,

                    actorPseudoSnapshot:
                      asTrimmedString(
                        inviterUser.pseudo
                      ) || "Joueur",

                    ...(asTrimmedString(
                      inviterUser.avatar ??
                        inviterUser.photoUrl
                    )
                      ? {
                          actorAvatarSnapshot:
                            asTrimmedString(
                              inviterUser.avatar ??
                                inviterUser.photoUrl
                            ),
                        }
                      : {}),

                    targetPseudoSnapshot:
                      asTrimmedString(
                        targetUser.pseudo
                      ) || "Joueur",

                    metadata: {
                      inviteType:
                        invite.type,
                      inviteSource:
                        invite.source,
                      expiresAt:
                        invite.expiresAt,
                    },

                    deduplicationKey:
                      `member_invited:${inviteRef.id}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                inviteId:
                  inviteRef.id,
                activityId,
                groupId,
                targetUserId,
                expiresAt:
                  invite.expiresAt,
              };
            }
          );

        logger?.info?.(
          "createGroupInvite ok",
          {
            uid,
            groupId:
              result.groupId,
            inviteId:
              result.inviteId,
            targetUserId:
              result.targetUserId,
          }
        );

        return {
          ok: true,
          inviteId:
            result.inviteId,
          groupId:
            result.groupId,
          targetUserId:
            result.targetUserId,
          expiresAt:
            result.expiresAt
              .toISOString(),
        };
      } catch (error) {
        logger?.error?.(
          "createGroupInvite failed",
          {
            uid,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            field:
              error?.field,
            inviteId:
              error?.inviteId,
            message: String(
              error?.message ??
                error
            ),
          }
        );

        throw mapCreateGroupInviteError(
          error,
          HttpsError
        );
      }
    }
  );
}
