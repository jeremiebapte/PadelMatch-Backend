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
    // The invitation itself may have been accepted/deleted long ago.
    // Reconcile orphaned Activity Center projections independently.
    let activityScanned = 0;
    let activityRemoved = 0;
    let lastActivity = null;
    for (let page = 0; page < 10; page++) {
      let query = db.collection("userActivities")
        .where("type", "==", "group_invite_received")
        .orderBy("__name__").limit(100);
      if (lastActivity) query = query.startAfter(lastActivity);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      lastActivity = snapshot.docs[snapshot.docs.length - 1];
      for (const doc of snapshot.docs) {
        activityScanned++;
        try {
          const removed = await db.runTransaction(async (tx) => {
            const freshActivity = await tx.get(doc.ref);
            if (!freshActivity.exists) return false;
            const activity = freshActivity.data() || {};
            if (activity.type !== "group_invite_received" || !activity.userId) return false;
            const inviteId = activity.inviteId ||
              (activity.entityType === "invitation" ? activity.entityId : null);
            if (!inviteId) return false; // Do not guess which invitation is involved.
            const inviteRef = db.collection("groupInvites").doc(inviteId);
            const inviteSnap = await tx.get(inviteRef);
            if (!inviteSnap.exists) {
              tx.delete(doc.ref); // Source invitation no longer exists.
              return true;
            }
            const invite = inviteSnap.data() || {};
            if (invite.targetUserId && invite.targetUserId !== activity.userId) return false;
            let membership = null;
            if (invite.groupId) {
              const membershipRef = db.collection("groupMemberships")
                .doc(invite.groupId + "_" + activity.userId);
              const snap = await tx.get(membershipRef);
              membership = snap.exists ? snap.data() : null;
            }
            const stale = invite.status !== "pending"
              || staleInviteReason(invite, membership, now()) !== null;
            if (!stale) return false;
            tx.delete(doc.ref);
            return true;
          });
          if (removed) activityRemoved++;
        } catch (error) {
          logger.warn("cleanupStaleGroupInvites activity reconciliation failed", {
            activityId: doc.id, error: error?.message ?? String(error),
          });
        }
      }
      if (snapshot.size < 100) break;
    }
    logger.info("cleanupStaleGroupInvites activity reconciliation", {
      activityScanned, activityRemoved,
    });
    logger.info("cleanupStaleGroupInvites complete", { scanned, cleaned });
    return { scanned, cleaned };
  };
}
