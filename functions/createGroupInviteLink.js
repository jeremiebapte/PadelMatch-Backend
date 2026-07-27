import {
  buildReusableGroupInvite,
  createGroupActivityRecorder,
  GroupActivityType,
  GroupActivityVisibility,
  GroupInviteValidationError,
  GroupPermissionError,
  GroupValidationError,
  assertCanInvitePlayers,
  validateCreateLinkInviteInput,
} from "./domain/groups/index.js";

function mapError(error, HttpsError) {
  if (error instanceof HttpsError) return error;

  if (
    error instanceof GroupInviteValidationError ||
    error instanceof GroupValidationError
  ) {
    return new HttpsError("invalid-argument", error.code);
  }

  if (error instanceof GroupPermissionError) {
    return new HttpsError("permission-denied", error.code);
  }

  return new HttpsError(
    "internal",
    error.code || "CREATE_GROUP_INVITE_LINK_FAILED"
  );
}

export function buildCreateGroupInviteLink({
  onCall,
  HttpsError,
  runtime,
  db,
  logger,
}) {
  const recordActivity =
    createGroupActivityRecorder({ db, logger });

  return onCall(runtime, async (req) => {
    const uid = req.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "UNAUTHENTICATED"
      );
    }

    try {
      const input =
        validateCreateLinkInviteInput(req.data ?? {});

      const result =
        await db.runTransaction(async (tx) => {

          const groupRef =
            db.collection("groups").doc(input.groupId);

          const membershipRef =
            db.collection("groupMemberships").doc(
              `${input.groupId}_${uid}`
            );

          const [
            groupSnap,
            membershipSnap,
          ] = await Promise.all([
            tx.get(groupRef),
            tx.get(membershipRef),
          ]);

          assertCanInvitePlayers(
            groupSnap.data(),
            membershipSnap.data()
          );

          const now = new Date();

          const invite =
            buildReusableGroupInvite({
              ...input,
              inviterUid: uid,
              now,
            });

          const inviteRef =
            db.collection("groupInvites").doc(invite.id);

          tx.set(inviteRef, invite);

          await recordActivity({
            groupId: input.groupId,
            type:
              GroupActivityType.INVITE_LINK_CREATED,
            actorUid: uid,
            inviteId: invite.id,
            visibility:
              GroupActivityVisibility.MEMBERS,
            createdAt: now,
            deduplicationKey:
              `invite_created:${invite.id}`,
          }, { transaction: tx });

          return {
            inviteId: invite.id,
            inviteUrl: invite.inviteUrl,
            token: invite.token,
          };
        });

      logger?.info?.(
        "createGroupInviteLink ok",
        result
      );

      return result;

    } catch (e) {
      logger?.error?.(
        "createGroupInviteLink failed",
        e
      );

      throw mapError(
        e,
        HttpsError
      );
    }
  });
}
