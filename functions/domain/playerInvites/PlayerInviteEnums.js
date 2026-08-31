// Path: functions/domain/playerInvites/PlayerInviteEnums.js
// ======================================================
// Padima — Player Invite To Play V1
// Enums métier.
// ======================================================

export const PlayerInviteStatus = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

export const PlayerInviteScheduleKind = Object.freeze({
  EXACT_DATE: "exactDate",
  DATE_RANGE: "dateRange",
  FLEXIBLE: "flexible",
});

export const PlayerInviteTimePreference = Object.freeze({
  ANY: "any",
  MORNING: "morning",
  AFTERNOON: "afternoon",
  EVENING: "evening",
});

export const PlayerInviteSource = Object.freeze({
  EXPLORER: "explorer",
});
