export const GroupType = Object.freeze({
  FRIENDS: "friends",
  LOCAL_COMMUNITY: "local_community",
  CLUB_COMMUNITY: "club_community",
  COMPANY: "company",
  TEAM: "team",
  OTHER: "other",
});

export const GroupStatus = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted",
});

export const GroupDiscoverability = Object.freeze({
  HIDDEN: "hidden",
  SEARCHABLE: "searchable",
});

export const GroupJoinPolicy = Object.freeze({
  INVITE_ONLY: "invite_only",
  APPROVAL_REQUIRED: "approval_required",
  OPEN: "open",
  LINK_ONLY: "link_only",
});

export const GroupRole = Object.freeze({
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
});

export const GroupMembershipStatus = Object.freeze({
  ACTIVE: "active",
  LEFT: "left",
  REMOVED: "removed",
  BANNED: "banned",
});

export const GroupMembershipSource = Object.freeze({
  GROUP_CREATOR: "group_creator",
  INVITE: "invite",
  JOIN_REQUEST: "join_request",
  OPEN_JOIN: "open_join",
  LINK_JOIN: "link_join",
  ADMIN_ADD: "admin_add",
  MIGRATION: "migration",
});

export const GroupInviteStatus = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

export const GroupJoinRequestStatus = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

export const GroupActivityVisibility = Object.freeze({
  MEMBERS: "members",
  ADMINS: "admins",
  PRIVATE: "private",
});

export const GroupActivityType = Object.freeze({
  GROUP_CREATED: "group_created",
  GROUP_UPDATED: "group_updated",
  GROUP_ARCHIVED: "group_archived",
  MEMBER_INVITED: "member_invited",
  MEMBER_JOIN_REQUESTED: "member_join_requested",
  MEMBER_REQUEST_APPROVED: "member_request_approved",
  MEMBER_REQUEST_REJECTED: "member_request_rejected",
  MEMBER_JOINED: "member_joined",
  MEMBER_LEFT: "member_left",
  MEMBER_REMOVED: "member_removed",
  MEMBER_BANNED: "member_banned",
  MEMBER_ROLE_CHANGED: "member_role_changed",
  MATCH_CREATED: "match_created",
  MATCH_UPDATED: "match_updated",
  MATCH_JOINED: "match_joined",
  MATCH_LEFT: "match_left",
  MATCH_COMPLETED: "match_completed",
  MATCH_CANCELLED: "match_cancelled",
  SPOT_REOPENED: "spot_reopened",
});

export const GroupHealthStatus = Object.freeze({
  NEW: "new",
  HEALTHY: "healthy",
  MODERATE: "moderate",
  LOW_ACTIVITY: "low_activity",
  DORMANT: "dormant",
});

export const PreferredTimeSlot = Object.freeze({
  EARLY_MORNING: "early_morning",
  MORNING: "morning",
  LUNCH: "lunch",
  AFTERNOON: "afternoon",
  EVENING: "evening",
  LATE_EVENING: "late_evening",
});

export function enumValues(enumObject) {
  return Object.freeze(Object.values(enumObject));
}

export function isEnumValue(enumObject, value) {
  return typeof value === "string" && Object.values(enumObject).includes(value);
}
