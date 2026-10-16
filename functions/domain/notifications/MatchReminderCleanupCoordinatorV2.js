import { randomUUID } from "node:crypto";
import {
  evaluateMatchReminderCleanupHealthV2,
} from "./MatchReminderCleanupHealthV2.js";

const COLLECTION = "notificationMaintenanceV2";
const DOCUMENT = "matchReminderCleanupCursorV2";
const LEASE_MS = 15 * 60 * 1000;
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isValidCleanupCursor(cursor, nowMs) {
  if (
    !cursor
    || typeof cursor !== "object"
    || Array.isArray(cursor)
    || !Number.isSafeInteger(cursor.scheduledAt)
    || cursor.scheduledAt <= 0
    || typeof cursor.id !== "string"
    || !/^[a-f0-9]{64}$/.test(cursor.id)
  ) {
    return false;
  }

  const cutoff = nowMs - CLEANUP_AGE_MS;

  return (
    Number.isSafeInteger(cutoff)
    && cursor.scheduledAt <= cutoff
  );
}

export function buildMatchReminderCleanupCoordinatorV2({
  db,
  batch,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (
    typeof db?.collection !== "function"
    || typeof db?.runTransaction !== "function"
    || typeof batch?.runBatch !== "function"
    || typeof now !== "function"
    || typeof logger?.error !== "function"
  ) {
    throw new TypeError("dépendances invalides");
  }

  const ref = db.collection(COLLECTION).doc(DOCUMENT);

  async function releaseIfOwned(claimId, error = null) {
    const failures = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.claimId !== claimId) {
        return null;
      }

      const update = {
        claimId: null,
        leaseUntilMs: 0,
      };

      if (error?.code === "CLEANUP_DOCUMENT_FAILED") {
        const state = snap.data() || {};
        const previous = state.consecutiveFailures;

        update.consecutiveFailures = (
          Number.isSafeInteger(previous)
          && previous >= 0
          && previous < Number.MAX_SAFE_INTEGER
        ) ? previous + 1 : 1;

        update.lastFailureAtMs = now();
        update.lastFailureCode = "CLEANUP_DOCUMENT_FAILED";
      }

      tx.set(ref, update, { merge: true });

      return error?.code === "CLEANUP_DOCUMENT_FAILED"
        ? update.consecutiveFailures
        : null;
    });

    // 13AR-1 : journal après validation de la transaction.
    // Aucune information personnelle ni exception brute.
    if (failures !== null) {
      const health = evaluateMatchReminderCleanupHealthV2({
        consecutiveFailures: failures,
      });

      if (health.needsAttention) {
        try {
          logger.error("MATCH_REMINDER_CLEANUP_BLOCKED", {
            status: health.status,
            consecutiveFailures: health.consecutiveFailures,
          });
        } catch {
          // Un problème de journalisation n'empêche pas
          // la conservation de la cause initiale.
        }
      }
    }
  }

  async function runOnce({ scanLimit = 20 } = {}) {
    if (
      !Number.isSafeInteger(scanLimit)
      || scanLimit < 1
      || scanLimit > 100
    ) {
      throw new TypeError("scanLimit invalide");
    }

    const startedAtMs = now();

    if (
      !Number.isSafeInteger(startedAtMs)
      || startedAtMs < 0
      || !Number.isSafeInteger(startedAtMs + LEASE_MS)
    ) {
      throw new TypeError("horloge invalide");
    }

    const claimId = randomUUID();

    const lease = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const state = snap.exists ? snap.data() : {};

      if (
        Number.isSafeInteger(state.leaseUntilMs)
        && state.leaseUntilMs > startedAtMs
      ) {
        return { acquired: false };
      }

      const storedCursor = state.cursor ?? null;
      const cursor = storedCursor === null
        ? null
        : isValidCleanupCursor(storedCursor, startedAtMs)
          ? storedCursor
          : null;

      // Un curseur corrompu ne doit jamais bloquer
      // définitivement le nettoyage.
      // Repartir du début ne saute aucun document.
      tx.set(ref, {
        claimId,
        leaseUntilMs: startedAtMs + LEASE_MS,
        updatedAtMs: startedAtMs,
      }, { merge: true });

      return { acquired: true, cursor };
    });

    if (!lease.acquired) {
      return {
        skipped: true,
        reason: "active_lease",
      };
    }

    try {
      const result = await batch.runBatch({
        scanLimit,
        cursor: lease.cursor,
        leaseGuard: { ref, claimId },
      });

      if (
        !result
        || !Number.isSafeInteger(result.scanned)
        || result.scanned < 0
        || result.scanned > scanLimit
        || !Number.isSafeInteger(result.deleted)
        || result.deleted < 0
        || !Number.isSafeInteger(result.retained)
        || result.retained < 0
        || !Number.isSafeInteger(result.failed)
        || result.failed < 0
        || result.deleted + result.retained + result.failed !== result.scanned
      ) {
        throw new Error("résultat du lot invalide");
      }

      const saved = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);

        if (
          !snap.exists
          || snap.data()?.claimId !== claimId
        ) {
          return false;
        }

        tx.set(ref, {
          cursor: result.cursor ?? null,
          claimId: null,
          leaseUntilMs: 0,
          updatedAtMs: now(),
          consecutiveFailures: 0,
          lastFailureCode: null,
          lastFailureAtMs: null,
        }, { merge: true });

        return true;
      });

      if (!saved) {
        throw new Error("bail perdu avant confirmation");
      }

      return {
        skipped: false,
        ...result,
      };
    } catch (error) {
      try {
        await releaseIfOwned(claimId, error);
      } catch {
        // Le bail expirera naturellement.
        // La prochaine exécution pourra reprendre.
      }

      throw error;
    }
  }

  return { runOnce };
}
