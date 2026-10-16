import {
  MATCH_REMINDER_CLEANUP_AGE_MS,
} from "./MatchReminderCleanupPolicyV2.js";

const COLLECTION = "matchReminderDeliveriesV2";
const DEFAULT_SCAN_LIMIT = 20;
const MAX_SCAN_LIMIT = 100;

export function buildMatchReminderCleanupBatchV2({
  db,
  cleanupStore,
  now = () => Date.now(),
} = {}) {
  if (
    typeof db?.collection !== "function"
    || typeof cleanupStore?.deleteIfStale !== "function"
    || typeof now !== "function"
  ) {
    throw new TypeError("dépendances invalides");
  }

  const collection = db.collection(COLLECTION);

  async function runBatch({
    scanLimit = DEFAULT_SCAN_LIMIT,
    cursor = null,
    leaseGuard = null,
  } = {}) {
    if (
      !Number.isSafeInteger(scanLimit)
      || scanLimit < 1
      || scanLimit > MAX_SCAN_LIMIT
    ) {
      throw new TypeError("scanLimit invalide");
    }

    const nowMs = now();
    const cutoff = nowMs - MATCH_REMINDER_CLEANUP_AGE_MS;

    if (
      !Number.isSafeInteger(nowMs)
      || nowMs < 0
      || !Number.isSafeInteger(cutoff)
    ) {
      throw new TypeError("now invalide");
    }

    if (cursor !== null && (
      !Number.isSafeInteger(cursor?.scheduledAt)
      || cursor.scheduledAt <= 0
      || typeof cursor?.id !== "string"
      || !/^[a-f0-9]{64}$/.test(cursor.id)
      || cursor.scheduledAt > cutoff
    )) {
      throw new TypeError("cursor invalide");
    }

    // Une seule page par appel.
    // L'ordre secondaire garantit une pagination
    // stable en cas de scheduledAt identiques.
    let query = collection
      .where("scheduledAt", "<=", cutoff)
      .orderBy("scheduledAt")
      .orderBy("__name__")
      .limit(scanLimit);

    if (cursor) {
      query = query.startAfter(
        cursor.scheduledAt,
        cursor.id
      );
    }

    const snapshot = await query.get();

    const results = {
      scanned: snapshot.size,
      deleted: 0,
      retained: 0,
      failed: 0,
      cursor: null,
    };

    for (const doc of snapshot.docs) {
      const record = doc.data();

      // Une réservation confirmée appartient au TTL.
      // Les statuts inconnus restent protégés.
      if (!["failed", "sending"].includes(record.status)) {
        results.retained++;
        continue;
      }

      try {
        const outcome =
          await cleanupStore.deleteIfStale(
            doc.id,
            leaseGuard
          );

        if (outcome.reason === "lease_lost") {
          const error = new Error("cleanup lease lost");
          error.code = "CLEANUP_LEASE_LOST";
          throw error;
        }

        if (outcome.deleted === true) {
          results.deleted++;
        } else {
          results.retained++;
        }
      } catch (error) {
        // Un bail perdu arrête immédiatement le lot.
        // Le coordinateur conserve alors son curseur.
        if (error?.code === "CLEANUP_LEASE_LOST") {
          throw error;
        }

        // Une erreur individuelle interrompt le lot.
        // Le curseur précédent est conservé par le coordinateur.
        const failure = new Error(
          `cleanup document failed: ${doc.id}`,
          { cause: error }
        );
        failure.code = "CLEANUP_DOCUMENT_FAILED";
        throw failure;
      }
    }

    if (snapshot.size > 0) {
      const last = snapshot.docs[snapshot.docs.length - 1];
      const scheduledAt = last.get("scheduledAt");

      results.cursor = {
        scheduledAt,
        id: last.id,
      };
    }

    // null signifie fin des résultats.
    if (snapshot.size < scanLimit) {
      results.cursor = null;
    }

    return results;
  }

  return { runBatch };
}
