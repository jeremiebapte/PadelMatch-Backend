import {
  GroupJoinPolicy,
  GroupJoinRequestStatus,
  GroupMembershipSource,
  GroupMembershipStatus,
  GroupRole,
} from "./GroupEnums.js";
import {
  GROUP_JOIN_REQUEST_EXPIRATION_DAYS,
  GROUP_JOIN_REQUEST_SCHEMA_VERSION,
  daysFrom,
} from "./GroupConstants.js";
import {
  validateCreateGroupJoinRequestInput,
  validateGroupJoinRequestTransition,
  validateResolveGroupJoinRequestInput,
} from "./GroupJoinRequestValidator.js";
import {
  validateGroupId,
  validateUserId,
} from "./GroupValidator.js";

export class GroupJoinRequestError extends Error {
  constructor(code, message = code, metadata = {}) {
    super(message);
    this.name = "GroupJoinRequestError";
    this.code = code;
    Object.assign(this, metadata);
  }
}

function trimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function optionalTrimmedString(value) {
  const result = trimmedString(value);
  return result || undefined;
}

function integerOrUndefined(value) {
  return Number.isInteger(value)
    ? value
    : undefined;
}

function ensureActiveGroup(group) {
  if (
    !group ||
    typeof group !== "object" ||
    group.status !== "active"
  ) {
    throw new GroupJoinRequestError(
      "GROUP_NOT_ACTIVE"
    );
  }
}

function ensureApprovalRequired(group) {
  if (
    group.joinPolicy !==
    GroupJoinPolicy.APPROVAL_REQUIRED
  ) {
    throw new GroupJoinRequestError(
      "GROUP_DOES_NOT_REQUIRE_APPROVAL"
    );
  }
}

export function deterministicJoinRequestId({
  groupId,
  requesterUid,
}) {
  return [
    validateGroupId(groupId),
    validateUserId(
      requesterUid,
      "requesterUid"
    ),
  ].join("_");
}

export function buildPendingGroupJoinRequest({
  requestId,
  groupId,
  requesterUid,
  group,
  requesterUser,
  now = new Date(),
}) {
  const validatedInput =
    validateCreateGroupJoinRequestInput({
      groupId,
    });

  const validatedRequester =
    validateUserId(
      requesterUid,
      "requesterUid"
    );

  ensureActiveGroup(group);
  ensureApprovalRequired(group);

  if (
    !(now instanceof Date) ||
    Number.isNaN(now.getTime())
  ) {
    throw new GroupJoinRequestError(
      "INVALID_TIMESTAMP"
    );
  }

  const requesterPseudo =
    optionalTrimmedString(
      requesterUser?.pseudo
    ) || "Joueur Padima";

  const requesterAvatar =
    optionalTrimmedString(
      requesterUser?.avatar ??
      requesterUser?.photoUrl ??
      requesterUser?.photoURL
    );

  const requesterLevel =
    integerOrUndefined(
      requesterUser?.level ??
      requesterUser?.niveau
    );

  const groupName =
    optionalTrimmedString(group.name) ||
    "Groupe Padima";

  const groupImage =
    optionalTrimmedString(
      group.imageUrl ??
      group.avatarUrl
    );

  return {
    requestId:
      trimmedString(requestId) ||
      deterministicJoinRequestId({
        groupId:
          validatedInput.groupId,
        requesterUid:
          validatedRequester,
      }),

    groupId:
      validatedInput.groupId,

    requesterUid:
      validatedRequester,

    status:
      GroupJoinRequestStatus.PENDING,

    requesterPseudoSnapshot:
      requesterPseudo,

    ...(requesterAvatar
      ? {
          requesterAvatarSnapshot:
            requesterAvatar,
        }
      : {}),

    ...(requesterLevel !== undefined
      ? {
          requesterLevelSnapshot:
            requesterLevel,
        }
      : {}),

    groupNameSnapshot:
      groupName,

    ...(groupImage
      ? {
          groupImageSnapshot:
            groupImage,
        }
      : {}),

    createdAt: now,
    updatedAt: now,

    expiresAt:
      daysFrom(
        now,
        GROUP_JOIN_REQUEST_EXPIRATION_DAYS
      ),

    resolvedAt: null,
    resolvedByUid: null,

    schemaVersion:
      GROUP_JOIN_REQUEST_SCHEMA_VERSION,
  };
}

export function resolveGroupJoinRequest({
  request,
  nextStatus,
  resolvedByUid,
  now = new Date(),
}) {
  if (
    !request ||
    typeof request !== "object"
  ) {
    throw new GroupJoinRequestError(
      "JOIN_REQUEST_NOT_FOUND"
    );
  }

  validateResolveGroupJoinRequestInput({
    requestId: request.requestId,
  });

  validateGroupJoinRequestTransition({
    currentStatus: request.status,
    nextStatus,
  });

  const resolver =
    validateUserId(
      resolvedByUid,
      "resolvedByUid"
    );

  return {
    ...request,
    status: nextStatus,
    updatedAt: now,
    resolvedAt: now,
    resolvedByUid: resolver,
  };
}

export function cancelGroupJoinRequest({
  request,
  requesterUid,
  now = new Date(),
}) {
  if (
    request?.requesterUid !== requesterUid
  ) {
    throw new GroupJoinRequestError(
      "JOIN_REQUEST_NOT_OWNED_BY_USER"
    );
  }

  return resolveGroupJoinRequest({
    request,
    nextStatus:
      GroupJoinRequestStatus.CANCELLED,
    resolvedByUid: requesterUid,
    now,
  });
}

export function approveGroupJoinRequest({
  request,
  approverUid,
  now = new Date(),
}) {
  return resolveGroupJoinRequest({
    request,
    nextStatus:
      GroupJoinRequestStatus.APPROVED,
    resolvedByUid: approverUid,
    now,
  });
}

export function rejectGroupJoinRequest({
  request,
  rejectedByUid,
  now = new Date(),
}) {
  return resolveGroupJoinRequest({
    request,
    nextStatus:
      GroupJoinRequestStatus.REJECTED,
    resolvedByUid: rejectedByUid,
    now,
  });
}

export function buildMembershipFromApprovedJoinRequest({
  request,
  approvedByUid,
  now = new Date(),
  previousMembership,
}) {
  if (
    request?.status !==
    GroupJoinRequestStatus.APPROVED
  ) {
    throw new GroupJoinRequestError(
      "JOIN_REQUEST_NOT_APPROVED"
    );
  }

  const groupId =
    validateGroupId(request.groupId);

  const userId =
    validateUserId(
      request.requesterUid,
      "requesterUid"
    );

  const approver =
    validateUserId(
      approvedByUid,
      "approvedByUid"
    );

  const membershipId =
    `${groupId}_${userId}`;

  const createdAt =
    previousMembership?.createdAt ??
    now;

  return {
    membershipId,
    groupId,
    userId,

    role: GroupRole.MEMBER,
    status:
      GroupMembershipStatus.ACTIVE,
    source:
      GroupMembershipSource.JOIN_REQUEST,

    notificationsEnabled: true,
    matchNotificationsEnabled: true,
    messageNotificationsEnabled: true,

    joinedAt: now,
    createdAt,
    updatedAt: now,

    lastOpenedAt:
      previousMembership?.lastOpenedAt ??
      null,

    lastActiveAt:
      previousMembership?.lastActiveAt ??
      null,

    invitedByUid: null,
    approvedByUid: approver,

    leftAt: null,
    removedAt: null,
    removedByUid: null,

    bannedAt: null,
    bannedByUid: null,
    banReason: null,

    roleUpdatedAt: null,
    roleUpdatedByUid: null,

    userPseudoSnapshot:
      request.requesterPseudoSnapshot ??
      "Joueur Padima",

    ...(request.requesterAvatarSnapshot
      ? {
          userAvatarSnapshot:
            request.requesterAvatarSnapshot,
        }
      : {}),

    ...(Number.isInteger(
      request.requesterLevelSnapshot
    )
      ? {
          userLevelSnapshot:
            request.requesterLevelSnapshot,
        }
      : {}),
  };
}

export function assertRequestCanBeCreated({
  group,
  existingMembership,
  existingRequest,
}) {
  ensureActiveGroup(group);
  ensureApprovalRequired(group);

  if (
    existingMembership?.status ===
    GroupMembershipStatus.ACTIVE
  ) {
    throw new GroupJoinRequestError(
      "ALREADY_GROUP_MEMBER"
    );
  }

  if (
    existingMembership?.status ===
    GroupMembershipStatus.BANNED
  ) {
    throw new GroupJoinRequestError(
      "USER_BANNED_FROM_GROUP"
    );
  }

  if (
    existingRequest?.status ===
    GroupJoinRequestStatus.PENDING
  ) {
    throw new GroupJoinRequestError(
      "JOIN_REQUEST_ALREADY_PENDING"
    );
  }

  return true;
}

export function assertCanManageJoinRequests({
  membership,
}) {
  const canManage =
    membership?.status ===
      GroupMembershipStatus.ACTIVE &&
    (
      membership.role ===
        GroupRole.OWNER ||
      membership.role ===
        GroupRole.ADMIN
    );

  if (!canManage) {
    throw new GroupJoinRequestError(
      "JOIN_REQUEST_MANAGEMENT_FORBIDDEN"
    );
  }

  return true;
}
