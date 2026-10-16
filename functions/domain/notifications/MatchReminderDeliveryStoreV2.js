import {
  createHash,
  randomUUID,
} from "node:crypto";

const COLLECTION = "matchReminderDeliveriesV2";
const LEASE_MS = 5 * 60 * 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function requiredString(value, name) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.includes("/")
  ) {
    throw new TypeError(`${name} invalide`);
  }
  return value.trim();
}

function reminderIdentity({
  matchId,
  uid,
  reminderType,
  dateHeure,
}) {
  const normalizedMatchId =
    requiredString(matchId, "matchId");

  const normalizedUid =
    requiredString(uid, "uid");

  if (!["1h", "24h"].includes(reminderType)) {
    throw new TypeError("reminderType invalide");
  }

  const scheduledAt = Number(dateHeure);

  if (
    !Number.isSafeInteger(scheduledAt)
    || scheduledAt <= 0
  ) {
    throw new TypeError("dateHeure invalide");
  }

  const payload = JSON.stringify([
    "match_reminder_v2",
    normalizedMatchId,
    normalizedUid,
    reminderType,
    scheduledAt,
  ]);

  return {
    id: createHash("sha256")
      .update(payload)
      .digest("hex"),
    matchId: normalizedMatchId,
    uid: normalizedUid,
    reminderType,
    scheduledAt,
  };
}

export function buildMatchReminderDeliveryStoreV2({
  db,
  FieldValue,
  now = () => Date.now(),
  newClaimId = () => randomUUID(),
} = {}) {
  if (
    typeof db?.runTransaction !== "function"
    || typeof db?.collection !== "function"
  ) {
    throw new TypeError("Firestore db invalide");
  }

  if (
    typeof FieldValue?.serverTimestamp !== "function"
  ) {
    throw new TypeError("FieldValue invalide");
  }

  const collection = db.collection(COLLECTION);

  const timestamp = () =>
    FieldValue.serverTimestamp();

  function refFor(identity) {
    return collection.doc(identity.id);
  }

  async function claim(input) {
    const identity = reminderIdentity(input);
    const ref = refFor(identity);
    const claimId = requiredString(
      newClaimId(),
      "claimId"
    );
    const currentMs = now();

    if (!Number.isSafeInteger(currentMs)) {
      throw new TypeError("now invalide");
    }

    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const previous = snap.exists
        ? (snap.data() || {})
        : {};

      if (previous.status === "sent") {
        return {
          acquired: false,
          reason: "already_sent",
          id: identity.id,
        };
      }

      if (previous.status === "sending") {
        const claimedMs = previous.claimedAtMs;
        const ageMs = currentMs - claimedMs;

        // Tant que la réservation n'est pas
        // expirée, aucune autre instance n'envoie.
        // Une date future est également protégée.
        if (
          !Number.isSafeInteger(claimedMs)
          || ageMs < LEASE_MS
        ) {
          return {
            acquired: false,
            reason: "in_progress",
            id: identity.id,
          };
        }
      }

      tx.set(ref, {
        ...identity,
        status: "sending",
        claimId,
        claimedAtMs: currentMs,
        attempts: (Number(previous.attempts) || 0) + 1,
        updatedAt: timestamp(),
        ...(snap.exists
          ? {}
          : { createdAt: timestamp() }),
      }, { merge: true });

      return {
        acquired: true,
        id: identity.id,
        claimId,
      };
    });
  }

  async function markSent({ id, claimId }) {
    requiredString(id, "id");
    requiredString(claimId, "claimId");

    return db.runTransaction(async tx => {
      const ref = collection.doc(id);
      const snap = await tx.get(ref);
      const record = snap.exists
        ? (snap.data() || {})
        : {};

      if (
        record.status !== "sending"
        || record.claimId !== claimId
      ) {
        return false;
      }

      // Le TTL concerne uniquement les rappels confirmés.
      // Un échec récupérable doit rester disponible.
      const confirmedAtMs = now();

      if (
        !Number.isSafeInteger(confirmedAtMs)
        || !Number.isSafeInteger(confirmedAtMs + RETENTION_MS)
      ) {
        throw new TypeError("now invalide");
      }

      tx.set(ref, {
        status: "sent",
        sentAt: timestamp(),
        expireAt: new Date(confirmedAtMs + RETENTION_MS),
        updatedAt: timestamp(),
      }, { merge: true });

      return true;
    });
  }

  async function release({
    id,
    claimId,
    error,
  }) {
    requiredString(id, "id");
    requiredString(claimId, "claimId");

    return db.runTransaction(async tx => {
      const ref = collection.doc(id);
      const snap = await tx.get(ref);
      const record = snap.exists
        ? (snap.data() || {})
        : {};

      if (
        record.status !== "sending"
        || record.claimId !== claimId
      ) {
        return false;
      }

      tx.set(ref, {
        status: "failed",
        lastError: String(
          error?.message ?? error ?? "unknown"
        ).slice(0, 500),
        updatedAt: timestamp(),
      }, { merge: true });

      return true;
    });
  }

  return {
    claim,
    markSent,
    release,
  };
}
