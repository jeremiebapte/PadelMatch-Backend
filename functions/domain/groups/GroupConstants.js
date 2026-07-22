export const GROUP_SCHEMA_VERSION = 1;
export const GROUP_ACTIVITY_SCHEMA_VERSION = 1;
export const GROUP_HEALTH_VERSION = 1;

export const GROUP_NAME_MIN_LENGTH = 3;
export const GROUP_NAME_MAX_LENGTH = 60;
export const GROUP_DESCRIPTION_MAX_LENGTH = 500;
export const GROUP_TAG_MAX_COUNT = 12;
export const GROUP_TAG_MAX_LENGTH = 32;
export const GROUP_LEVEL_MIN = 1;
export const GROUP_LEVEL_MAX = 10;

export const GROUP_INVITE_EXPIRATION_DAYS = 30;
export const GROUP_JOIN_REQUEST_EXPIRATION_DAYS = 30;

export const GROUP_DEFAULT_SETTINGS = Object.freeze({
  canMembersCreateMatches: true,
  canMembersInvitePlayers: true,
  canMembersPostMessages: true,
  canMembersSeeMemberList: true,
  requiresProfileCompletion: true,
});

export const GROUP_INITIAL_STATS = Object.freeze({
  memberCount: 1,
  activeMemberCount30d: 1,
  pendingRequestCount: 0,
  upcomingMatchCount: 0,
  openMatchCount: 0,
  matchesCreated30d: 0,
  matchesCompleted30d: 0,
  lastActivityAt: null,
});

export const GROUP_INITIAL_HEALTH_COMPONENTS = Object.freeze({
  activity: 0,
  matchFrequency: 0,
  fillRate: 0,
  activeMembers: 0,
  retention: 0,
  reliability: 0,
});

export function daysFrom(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("INVALID_DATE");
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new TypeError("INVALID_DAY_COUNT");
  }
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
