import {
  GroupMembershipStatus,
  GroupRole,
  GroupStatus,
} from "./GroupEnums.js";

export class GroupPermissionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GroupPermissionError";
    this.code = code;
  }
}

export function isActiveMembership(membership) {
  return Boolean(
    membership &&
    membership.status === GroupMembershipStatus.ACTIVE
  );
}

export function hasRole(membership, roles) {
  return isActiveMembership(membership) && roles.includes(membership.role);
}

export function assertGroupActive(group) {
  if (!group || group.status !== GroupStatus.ACTIVE) {
    throw new GroupPermissionError("GROUP_NOT_ACTIVE");
  }
}

export function assertActiveMember(membership) {
  if (!isActiveMembership(membership)) {
    throw new GroupPermissionError("ACTIVE_MEMBERSHIP_REQUIRED");
  }
}

export function assertOwner(membership) {
  if (!hasRole(membership, [GroupRole.OWNER])) {
    throw new GroupPermissionError("OWNER_REQUIRED");
  }
}

export function assertAdminOrOwner(membership) {
  if (!hasRole(membership, [GroupRole.OWNER, GroupRole.ADMIN])) {
    throw new GroupPermissionError("ADMIN_REQUIRED");
  }
}

export function canCreateMatch(group, membership) {
  if (!isActiveMembership(membership)) return false;
  if ([GroupRole.OWNER, GroupRole.ADMIN].includes(membership.role)) return true;
  return group?.settings?.canMembersCreateMatches === true;
}

export function canInvitePlayers(group, membership) {
  if (!isActiveMembership(membership)) return false;
  if ([GroupRole.OWNER, GroupRole.ADMIN].includes(membership.role)) return true;
  return group?.settings?.canMembersInvitePlayers === true;
}

export function canPostMessages(group, membership) {
  if (!isActiveMembership(membership)) return false;
  if ([GroupRole.OWNER, GroupRole.ADMIN].includes(membership.role)) return true;
  return group?.settings?.canMembersPostMessages === true;
}

export function assertCanCreateMatch(group, membership) {
  assertGroupActive(group);
  if (!canCreateMatch(group, membership)) {
    throw new GroupPermissionError("MATCH_CREATION_NOT_ALLOWED");
  }
}

export function assertCanInvitePlayers(group, membership) {
  assertGroupActive(group);
  if (!canInvitePlayers(group, membership)) {
    throw new GroupPermissionError("INVITATION_NOT_ALLOWED");
  }
}

export function assertCanManageTarget(actorMembership, targetMembership) {
  assertAdminOrOwner(actorMembership);

  if (!targetMembership) {
    throw new GroupPermissionError("TARGET_MEMBERSHIP_NOT_FOUND");
  }

  if (targetMembership.role === GroupRole.OWNER) {
    throw new GroupPermissionError("OWNER_CANNOT_BE_MANAGED");
  }

  if (
    actorMembership.role === GroupRole.ADMIN &&
    targetMembership.role === GroupRole.ADMIN
  ) {
    throw new GroupPermissionError("OWNER_REQUIRED_FOR_ADMIN_TARGET");
  }
}
