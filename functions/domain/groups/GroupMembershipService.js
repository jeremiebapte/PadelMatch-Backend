import {
  GroupMembershipSource,
  GroupMembershipStatus,
  GroupRole,
  isEnumValue,
} from "./GroupEnums.js";
import { buildMembershipUserSnapshot } from "./GroupSnapshotBuilder.js";
import { validateGroupId, validateUserId } from "./GroupValidator.js";

export class GroupMembershipError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GroupMembershipError";
    this.code = code;
  }
}

export function membershipDocumentId(groupId, userId) {
  return `${validateGroupId(groupId)}_${validateUserId(userId)}`;
}

export function buildActiveMembership({
  groupId,
  userId,
  role,
  source,
  now,
  user,
  invitedByUid,
  approvedByUid,
}) {
  if (!isEnumValue(GroupRole, role)) {
    throw new GroupMembershipError("INVALID_MEMBERSHIP_ROLE");
  }
  if (!isEnumValue(GroupMembershipSource, source)) {
    throw new GroupMembershipError("INVALID_MEMBERSHIP_SOURCE");
  }
  if (!now) {
    throw new GroupMembershipError("MEMBERSHIP_TIMESTAMP_REQUIRED");
  }

  const validatedGroupId = validateGroupId(groupId);
  const validatedUserId = validateUserId(userId);
  const membershipId = membershipDocumentId(validatedGroupId, validatedUserId);

  return {
    membershipId,
    groupId: validatedGroupId,
    userId: validatedUserId,
    role,
    status: GroupMembershipStatus.ACTIVE,
    source,
    notificationsEnabled: true,
    matchNotificationsEnabled: true,
    messageNotificationsEnabled: true,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    lastActiveAt: now,
    ...buildMembershipUserSnapshot(user, validatedUserId),
    ...(invitedByUid
      ? { invitedByUid: validateUserId(invitedByUid, "invitedByUid") }
      : {}),
    ...(approvedByUid
      ? { approvedByUid: validateUserId(approvedByUid, "approvedByUid") }
      : {}),
  };
}

export function buildOwnerMembership(payload) {
  return buildActiveMembership({
    ...payload,
    role: GroupRole.OWNER,
    source: GroupMembershipSource.GROUP_CREATOR,
  });
}

export function assertSingleOwnerTransition({
  actorMembership,
  targetMembership,
  nextRole,
}) {
  if (!isEnumValue(GroupRole, nextRole)) {
    throw new GroupMembershipError("INVALID_MEMBERSHIP_ROLE");
  }

  if (
    targetMembership?.role === GroupRole.OWNER &&
    nextRole !== GroupRole.OWNER
  ) {
    throw new GroupMembershipError("OWNER_TRANSFER_REQUIRED");
  }

  if (
    nextRole === GroupRole.OWNER &&
    actorMembership?.role !== GroupRole.OWNER
  ) {
    throw new GroupMembershipError("OWNER_REQUIRED_FOR_TRANSFER");
  }
}
