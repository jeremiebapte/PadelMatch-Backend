// Reconcile stale direct invitations and their Activity Center projections.
// Source of truth is groupInvites; userActivities are only projections.
export function staleInviteReason(invite, membership, now = new Date()) {
  if (!invite || invite.status !== "pending" || !invite.targetUserId) return null;
  const expiresAt = invite.expiresAt instanceof Date
    ? invite.expiresAt
    : invite.expiresAt?.toDate?.();
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) return "expired";
  if (membership?.status === "active"
      && membership.userId === invite.targetUserId
      && membership.groupId === invite.groupId) return "already_member";
  return null;
}

export function buildCleanupStaleGroupInvites({ db, logger = console, now = () => new Date() }) {
  return async function cleanupStaleGroupInvites() {
    let scanned = 0;
    let cleaned = 0;
    let lastDocument = null;
    // Bounded traversal; use a cursor so a long-lived valid invite cannot block others.
    for (let page = 0; page < 10; page++) {
      let query = db.collection("groupInvites")
        .where("status", "==", "pending")
        .orderBy("__name__")
        .limit(150);
      if (lastDocument) query = query.startAfter(lastDocument);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      lastDocument = snapshot.docs[snapshot.docs.length - 1];
      for (const invitation of snapshot.docs) {
        const data = invitation.data() || {};
        if (!data.targetUserId || !data.groupId) continue; // Reusable links are not user notifications.
        scanned++;
        try {
          const changed = await db.runTransaction(async (tx) => {
            const membershipRef = db.collection("groupMemberships")
              .doc(data.groupId + "_" + data.targetUserId);
            const [fresh, membership] = await Promise.all([
              tx.get(invitation.ref),
              tx.get(membershipRef),
            ]);
            const current = fresh.data() || {};
            const reason = staleInviteReason(current,
              membership.exists ? membership.data() : null, now());
            if (!reason) return false;
            // Single-field inviteId query avoids a new composite-index requirement.
            const activityQuery = db.collection("userActivities")
              .where("inviteId", "==", invitation.id).limit(100);
            const activities = await tx.get(activityQuery);
            tx.update(invitation.ref, {
              status: reason === "expired" ? "expired" : "cancelled",
              updatedAt: now(),
              ...(reason === "expired" ? { expiredAt: now() } : {}),
              resolutionReason: reason,
              statusChangedByUid: "system",
            });
            for (const item of activities.docs) {
              const activity = item.data() || {};
              if (activity.userId === current.targetUserId
                  && activity.type === "group_invite_received") {
                tx.delete(item.ref);
              }
            }
            return true;
          });
          if (changed) cleaned++;
        } catch (error) {
          logger.warn("cleanupStaleGroupInvites failed for invite", {
            inviteId: invitation.id, error: error?.message ?? String(error),
          });
        }
      }
      if (snapshot.size < 150) break;
    }
    logger.info("cleanupStaleGroupInvites complete", { scanned, cleaned });
    return { scanned, cleaned };
  };
}
