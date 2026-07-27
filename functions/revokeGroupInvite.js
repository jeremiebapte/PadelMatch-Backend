import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupInviteStatus,
  GroupInviteValidationError,
  GroupPermissionError,
  GroupValidationError,
  assertCanInvitePlayers,
  buildInviteStatusUpdate,
  createGroupActivityRecorder,
  validateInviteId,
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

  return new HttpsError("internal", error.code || "REVOKE_GROUP_INVITE_FAILED");
}

export function buildRevokeGroupInvite({
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
      const inviteId =
        validateInviteId(req.data?.inviteId);

      const result =
        await db.runTransaction(async (tx) => {

          const inviteRef =
            db.collection("groupInvites").doc(inviteId);

          const inviteSnap =
            await tx.get(inviteRef);

          if (!inviteSnap.exists) {
            throw new Error("GROUP_INVITE_NOT_FOUND");
          }

          const invite =
            inviteSnap.data();

          const membershipRef =
            db.collection("groupMemberships").doc(
              `${invite.groupId}_${uid}`
            );

          const groupRef =
            db.collection("groups").doc(invite.groupId);

          const [
            membershipSnap,
            groupSnap,
          ] = await Promise.all([
            tx.get(membershipRef),
            tx.get(groupRef),
          ]);

          assertCanInvitePlayers(
            groupSnap.data(),
            membershipSnap.data()
          );

          const now = new Date();

          tx.update(
            inviteRef,
            buildInviteStatusUpdate({
              invite,
              nextStatus:
                GroupInviteStatus.REVOKED,
              actorUid: uid,
              now,
            })
          );

          await recordActivity({
            groupId: invite.groupId,
            type:
              GroupActivityType.INVITE_LINK_REVOKED,
            actorUid: uid,
            inviteId,
            visibility:
              GroupActivityVisibility.MEMBERS,
            createdAt: now,
            deduplicationKey:
              `invite_revoked:${inviteId}`,
          }, { transaction: tx });

          return { ok:true };
        });

      logger?.info?.(
        "revokeGroupInvite ok",
        result
      );

      return result;

    } catch (e) {
      logger?.error?.(
        "revokeGroupInvite failed",
        e
      );

      throw mapError(
        e,
        HttpsError
      );
    }
  });
}
