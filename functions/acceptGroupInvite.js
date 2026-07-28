import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupInviteError,
  GroupInviteStatus,
  GroupInviteValidationError,
  GroupMembershipStatus,
  GroupValidationError,
  assertGroupActive,
  assertInviteUsable,
  buildInviteStatusUpdate,
  buildMembershipFromAcceptedInvite,
  createGroupActivityRecorder,
  hashInviteToken,
  membershipDocumentId,
  validateInviteId,
  validateInviteToken,
} from "./domain/groups/index.js";

function codedError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function validateInput(data) {
  const payload =
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
      ? data
      : {};

  const hasInviteId =
    typeof payload.inviteId === "string" &&
    payload.inviteId.trim() !== "";

  const hasToken =
    typeof payload.token === "string" &&
    payload.token.trim() !== "";

  if (hasInviteId === hasToken) {
    throw codedError(
      "INVITE_ID_OR_TOKEN_REQUIRED"
    );
  }

  if (hasInviteId) {
    return {
      inviteId:
        validateInviteId(
          payload.inviteId
        ),
    };
  }

  return {
    token:
      validateInviteToken(
        payload.token
      ),
  };
}

function mapAcceptGroupInviteError(
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
    error instanceof GroupInviteError
  ) {
    switch (error.code) {
      case "INVITE_NOT_FOR_USER":
        return new HttpsError(
          "permission-denied",
          error.code
        );

      case "INVITE_EXPIRED":
      case "INVITE_NOT_PENDING":
      case "INVITE_USAGE_LIMIT_REACHED":
      case "INVALID_INVITE_EXPIRATION":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      default:
        return new HttpsError(
          "failed-precondition",
          error.code ??
            "ACCEPT_GROUP_INVITE_FAILED"
        );
    }
  }

  switch (error?.code) {
    case "INVITE_ID_OR_TOKEN_REQUIRED":
      return new HttpsError(
        "invalid-argument",
        error.code
      );

    case "GROUP_INVITE_NOT_FOUND":
    case "GROUP_NOT_FOUND":
    case "USER_PROFILE_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    case "GROUP_NOT_ACTIVE":
      return new HttpsError(
        "failed-precondition",
        error.code
      );

    case "ALREADY_GROUP_MEMBER":
      return new HttpsError(
        "already-exists",
        error.code,
        {
          membershipId:
            error.membershipId ??
            null,
        }
      );

    default:
      return new HttpsError(
        "internal",
        "ACCEPT_GROUP_INVITE_INTERNAL"
      );
  }
}

export function buildAcceptGroupInvite({
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
    !FieldValue ||
    typeof FieldValue.increment !==
      "function"
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
      const uid = req.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "UNAUTHENTICATED"
        );
      }

      try {
        const input =
          validateInput(
            req.data
          );

        const result =
          await db.runTransaction(
            async (transaction) => {
              let inviteSnapshot;

              if (input.inviteId) {
                const inviteRef =
                  db
                    .collection(
                      "groupInvites"
                    )
                    .doc(
                      input.inviteId
                    );

                inviteSnapshot =
                  await transaction.get(
                    inviteRef
                  );
              } else {
                const tokenHash =
                  hashInviteToken(
                    input.token
                  );

                const inviteQuery =
                  db
                    .collection(
                      "groupInvites"
                    )
                    .where(
                      "tokenHash",
                      "==",
                      tokenHash
                    )
                    .limit(1);

                const querySnapshot =
                  await transaction.get(
                    inviteQuery
                  );

                inviteSnapshot =
                  querySnapshot.empty
                    ? null
                    : querySnapshot
                        .docs[0];
              }

              if (
                !inviteSnapshot ||
                !inviteSnapshot.exists
              ) {
                throw codedError(
                  "GROUP_INVITE_NOT_FOUND"
                );
              }

              const invite =
                inviteSnapshot.data() ??
                {};

              logger?.info?.(
                "acceptGroupInvite invite debug",
                {
                  inviteId: inviteSnapshot.id,
                  groupId: invite.groupId,
                  status: invite.status,
                  type: invite.type,
                  hasTokenHash: !!invite.tokenHash,
                }
              );

              const inviteRef =
                inviteSnapshot.ref;

              const groupId =
                invite.groupId;

              logger?.info?.(
                "acceptGroupInvite group lookup",
                {
                  groupId,
                }
              );

              const groupRef =
                db
                  .collection("groups")
                  .doc(groupId);

              const userRef =
                db
                  .collection("users")
                  .doc(uid);

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
                  .doc(
                    membershipId
                  );

              const [
                groupSnapshot,
                userSnapshot,
                membershipSnapshot,
              ] = await Promise.all([
                transaction.get(
                  groupRef
                ),
                transaction.get(
                  userRef
                ),
                transaction.get(
                  membershipRef
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
                !userSnapshot.exists
              ) {
                throw codedError(
                  "USER_PROFILE_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() ??
                {};

              assertGroupActive(group);

              if (
                membershipSnapshot.exists
              ) {
                const existingMembership =
                  membershipSnapshot
                    .data() ?? {};

                if (
                  existingMembership
                    .status ===
                  GroupMembershipStatus
                    .ACTIVE
                ) {
                  throw codedError(
                    "ALREADY_GROUP_MEMBER",
                    {
                      membershipId,
                    }
                  );
                }
              }

              const now = new Date();

              assertInviteUsable(
                invite,
                now,
                uid
              );

              const user =
                userSnapshot.data() ??
                {};

              const membership =
                buildMembershipFromAcceptedInvite({
                  invite,
                  userId: uid,
                  user,
                  now,
                });

              const inviteUpdate =
                buildInviteStatusUpdate({
                  invite,
                  nextStatus:
                    GroupInviteStatus
                      .ACCEPTED,
                  actorUid: uid,
                  now,
                });

              transaction.set(
                membershipRef,
                membership
              );

              transaction.update(
                inviteRef,
                inviteUpdate
              );

              transaction.update(
                groupRef,
                {
                  "stats.memberCount":
                    FieldValue.increment(1),
                  updatedAt: now,
                }
              );

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .INVITE_ACCEPTED,
                    actorUid: uid,
                    targetUserId: uid,
                    inviteId:
                      inviteRef.id,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,
                    actorPseudoSnapshot:
                      membership
                        .userPseudoSnapshot ??
                      "Joueur",
                    actorAvatarSnapshot:
                      membership
                        .userAvatarSnapshot,
                    targetPseudoSnapshot:
                      membership
                        .userPseudoSnapshot ??
                      "Joueur",
                    metadata: {
                      inviteType:
                        invite.type,
                      inviteSource:
                        invite.source,
                      membershipId,
                    },
                    deduplicationKey:
                      `invite_accepted:${inviteRef.id}:${uid}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                inviteId:
                  inviteRef.id,
                groupId,
                membershipId,
                activityId,
              };
            }
          );

        logger?.info?.(
          "acceptGroupInvite ok",
          {
            uid,
            inviteId:
              result.inviteId,
            groupId:
              result.groupId,
            membershipId:
              result.membershipId,
          }
        );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        logger?.error?.(
          "acceptGroupInvite failed",
          {
            uid,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            field:
              error?.field,
            message: String(
              error?.message ??
                error
            ),
          }
        );

        throw mapAcceptGroupInviteError(
          error,
          HttpsError
        );
      }
    }
  );
}
