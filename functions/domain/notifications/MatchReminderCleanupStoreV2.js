import {
  evaluateMatchReminderCleanupV2,
} from "./MatchReminderCleanupPolicyV2.js";

export function buildMatchReminderCleanupStoreV2({
  db,
  now = () => Date.now(),
} = {}) {
  if (
    typeof db?.runTransaction !== "function" ||
    typeof db?.collection !== "function"
  ) {
    throw new TypeError("db invalide");
  }

  const collection = db.collection("matchReminderDeliveriesV2");

  async function deleteIfStale(id, leaseGuard = null) {
    if (
      typeof id !== "string" ||
      !/^[a-f0-9]{64}$/.test(id)
    ) {
      throw new TypeError("id invalide");
    }

    if (leaseGuard !== null && (
      typeof leaseGuard !== "object"
      || leaseGuard.ref?.path !==
        "notificationMaintenanceV2/matchReminderCleanupCursorV2"
      || typeof leaseGuard.claimId !== "string"
      || !leaseGuard.claimId
    )) {
      throw new TypeError("leaseGuard invalide");
    }

    return db.runTransaction(async tx => {
      const ref = collection.doc(id);
      const snap = await tx.get(ref);

      if (leaseGuard !== null) {
        const ownership = await tx.get(leaseGuard.ref);
        const state = ownership.exists ? ownership.data() : {};
        const checkedAtMs = now();

        if (
          state.claimId !== leaseGuard.claimId
          || !Number.isSafeInteger(state.leaseUntilMs)
          || state.leaseUntilMs <= checkedAtMs
        ) {
          return { deleted: false, reason: "lease_lost" };
        }
      }

      if (!snap.exists) {
        return { deleted: false, reason: "not_found" };
      }

      const evaluation =
        evaluateMatchReminderCleanupV2(
          snap.data(),
          now()
        );

      if (!evaluation.eligible) {
        return {
          deleted: false,
          reason: evaluation.reason,
        };
      }

      // Décision et suppression appartiennent
      // à la même transaction Firestore.
      tx.delete(ref);

      return {
        deleted: true,
        reason: "stale_delivery",
      };
    });
  }

  return { deleteIfStale };
}
