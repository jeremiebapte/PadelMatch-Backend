const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_AGE_MS = 7 * DAY_MS;
const LEASE_MS = 5 * 60 * 1000;

export function evaluateMatchReminderCleanupV2(
  record,
  nowMs
) {
  if (!record || typeof record !== "object") {
    return { eligible: false, reason: "invalid_record" };
  }

  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { eligible: false, reason: "invalid_now" };
  }

  if (record.status === "sent") {
    return { eligible: false, reason: "sent_uses_ttl" };
  }

  if (!["failed", "sending"].includes(record.status)) {
    return { eligible: false, reason: "unsupported_status" };
  }

  if (
    !["1h", "24h"].includes(record.reminderType)
    || typeof record.matchId !== "string"
    || !record.matchId.trim()
    || typeof record.uid !== "string"
    || !record.uid.trim()
    || !Number.isSafeInteger(record.scheduledAt)
    || record.scheduledAt <= 0
  ) {
    return { eligible: false, reason: "invalid_identity" };
  }

  const ageMs = nowMs - record.scheduledAt;

  if (!Number.isSafeInteger(ageMs) || ageMs < CLEANUP_AGE_MS) {
    return { eligible: false, reason: "retention_window" };
  }

  if (record.status === "sending") {
    const claimedAtMs = record.claimedAtMs;

    // Une réservation mal formée n'est jamais
    // supprimée automatiquement.
    if (
      !Number.isSafeInteger(claimedAtMs)
      || claimedAtMs < 0
    ) {
      return { eligible: false, reason: "invalid_lease" };
    }

    const leaseAgeMs = nowMs - claimedAtMs;

    // Inclut les réservations datées dans le futur.
    if (
      !Number.isSafeInteger(leaseAgeMs)
      || leaseAgeMs < LEASE_MS
    ) {
      return { eligible: false, reason: "active_lease" };
    }
  }

  return { eligible: true, reason: "stale_delivery" };
}

export const MATCH_REMINDER_CLEANUP_AGE_MS =
  CLEANUP_AGE_MS;
