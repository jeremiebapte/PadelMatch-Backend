import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupInviteError,
  GroupInviteStatus,
  GroupInviteValidationError,
  GroupValidationError,
  assertInviteUsable,
  buildInviteStatusUpdate,
  createGroupActivityRecorder,
  hashInviteToken,
  validateInviteId,
  validateInviteToken,
} from "./domain/groups/index.js";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
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
    throw codedError("INVITE_ID_OR_TOKEN_REQUIRED");
  }

  return hasInviteId
    ? {
        inviteId: validateInviteId(payload.inviteId),
      }
    : {
        token: validateInviteToken(payload.token),
      };
}

function mapError(error, HttpsError) {
  if (error instanceof HttpsError) return error;

  if (
    error instanceof GroupInviteValidationError ||
    error instanceof GroupValidationError
  ) {
    return new HttpsError(
      "invalid-argument",
      error.code,
      {
        field: error.field,
      }
    );
  }

  if (error instanceof GroupInviteError) {
    return new HttpsError(
      "failed-precondition",
      error.code
    );
  }

  switch (error?.code) {
    case "GROUP_INVITE_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    case "INVITE_ID_OR_TOKEN_REQUIRED":
      return new HttpsError(
        "invalid-argument",
        error.code
      );

    default:
      return new HttpsError(
        "internal",
        "DECLINE_GROUP_INVITE_INTERNAL"
      );
  }
}

export function buildDeclineGroupInvite({
  onCall,
  HttpsError,
  runtime,
  db,
  logger,
}) {
  const recordActivity =
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
          validateInput(req.data);

        const result =
          await db.runTransaction(
            async (transaction) => {
              let inviteSnapshot;

              if (input.inviteId) {
                inviteSnapshot =
                  await transaction.get(
                    db
                      .collection(
                        "groupInvites"
                      )
                      .doc(
                        input.inviteId
                      )
                  );
              } else {
                const query =
                  db
                    .collection(
                      "groupInvites"
                    )
                    .where(
                      "tokenHash",
                      "==",
                      hashInviteToken(
                        input.token
                      )
                    )
                    .limit(1);

                const qs =
                  await transaction.get(
                    query
                  );

                inviteSnapshot =
                  qs.empty
                    ? null
                    : qs.docs[0];
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
                inviteSnapshot.data();

              const now =
                new Date();

              assertInviteUsable(
                invite,
                now,
                uid
              );

              transaction.update(
                inviteSnapshot.ref,
                buildInviteStatusUpdate({
                  invite,
                  nextStatus:
                    GroupInviteStatus.DECLINED,
                  actorUid: uid,
                  now,
                })
              );

              await recordActivity(
                {
                  groupId:
                    invite.groupId,
                  type:
                    GroupActivityType.INVITE_DECLINED,
                  actorUid: uid,
                  targetUserId: uid,
                  inviteId:
                    inviteSnapshot.id,
                  visibility:
                    GroupActivityVisibility.MEMBERS,
                  createdAt: now,
                  deduplicationKey:
                    `invite_declined:${inviteSnapshot.id}:${uid}`,
                },
                {
                  transaction,
                }
              );

              return {
                ok: true,
                inviteId:
                  inviteSnapshot.id,
              };
            }
          );

        logger?.info?.(
          "declineGroupInvite ok",
          result
        );

        return result;
      } catch (error) {
        logger?.error?.(
          "declineGroupInvite failed",
          error
        );

        throw mapError(
          error,
          HttpsError
        );
      }
    }
  );
}
