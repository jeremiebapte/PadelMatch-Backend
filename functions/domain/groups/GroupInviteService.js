import {
  GroupInviteStatus,
  GroupInviteType,
  GroupMembershipSource,
  GroupRole,
} from "./GroupEnums.js";
import {
  GROUP_INVITE_EXPIRATION_DAYS,
  GROUP_INVITE_SCHEMA_VERSION,
  daysFrom,
} from "./GroupConstants.js";
import {
  validateCreateDirectInviteInput,
  validateCreateLinkInviteInput,
  validateInviteId,
  validateInviteTransition,
} from "./GroupInviteValidator.js";
import {
  generateInviteToken,
  hashInviteToken,
} from "./GroupInviteToken.js";
import { buildGroupInviteSnapshots } from "./GroupInviteSnapshotBuilder.js";
import {
  buildActiveMembership,
} from "./GroupMembershipService.js";
import {
  validateUserId,
} from "./GroupValidator.js";

export class GroupInviteError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GroupInviteError";
    this.code = code;
  }
}

function requireTimestamp(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new GroupInviteError("INVITE_TIMESTAMP_REQUIRED");
  }
  return now;
}

function baseInviteDocument({
  inviteId,
  groupId,
  inviterUid,
  type,
  source,
  now,
  expiresAt,
  snapshots,
}) {
  return {
    inviteId: validateInviteId(inviteId),
    groupId,
    inviterUid: validateUserId(inviterUid, "inviterUid"),
    type,
    source,
    status: GroupInviteStatus.PENDING,
    schemaVersion: GROUP_INVITE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    useCount: 0,
    ...snapshots,
  };
}

export function buildDirectGroupInvite({
  inviteId,
  input,
  inviterUid,
  group,
  inviterUser,
  targetUser,
  now,
}) {
  const validated = validateCreateDirectInviteInput(input);
  const timestamp = requireTimestamp(now);

  if (validated.targetUserId === inviterUid) {
    throw new GroupInviteError("CANNOT_INVITE_SELF");
  }

  return {
    ...baseInviteDocument({
      inviteId,
      groupId: validated.groupId,
      inviterUid,
      type: GroupInviteType.DIRECT_USER,
      source: validated.source,
      now: timestamp,
      expiresAt: daysFrom(timestamp, GROUP_INVITE_EXPIRATION_DAYS),
      snapshots: buildGroupInviteSnapshots({
        group,
        inviterUser,
        targetUser,
        targetUserId: validated.targetUserId,
      }),
    }),
    targetUserId: validated.targetUserId,
    maxUses: 1,
    ...(validated.message ? { message: validated.message } : {}),
  };
}

export function buildReusableGroupInvite({
  inviteId,
  input,
  inviterUid,
  group,
  inviterUser,
  now,
  token = generateInviteToken(),
}) {
  const validated = validateCreateLinkInviteInput(input);
  const timestamp = requireTimestamp(now);

  return {
    ...baseInviteDocument({
      inviteId,
      groupId: validated.groupId,
      inviterUid,
      type: validated.type,
      source: validated.source,
      now: timestamp,
      expiresAt: daysFrom(timestamp, GROUP_INVITE_EXPIRATION_DAYS),
      snapshots: buildGroupInviteSnapshots({
        group,
        inviterUser,
      }),
    }),
    tokenHash: hashInviteToken(token),
    maxUses: validated.maxUses,
    ...(validated.label ? { label: validated.label } : {}),
  };
}

export function assertInviteUsable(invite, now, acceptingUserId) {
  const timestamp = requireTimestamp(now);

  if (!invite || invite.status !== GroupInviteStatus.PENDING) {
    throw new GroupInviteError("INVITE_NOT_PENDING");
  }

  const expirationDate =
    invite.expiresAt instanceof Date
      ? invite.expiresAt
      : invite.expiresAt?.toDate?.();

  if (!expirationDate) {
    throw new GroupInviteError("INVALID_INVITE_EXPIRATION");
  }

  if (expirationDate.getTime() <= timestamp.getTime()) {
    throw new GroupInviteError("INVITE_EXPIRED");
  }

  if (
    invite.targetUserId &&
    invite.targetUserId !== validateUserId(acceptingUserId, "acceptingUserId")
  ) {
    throw new GroupInviteError("INVITE_NOT_FOR_USER");
  }

  if (
    Number.isInteger(invite.maxUses) &&
    Number.isInteger(invite.useCount) &&
    invite.useCount >= invite.maxUses
  ) {
    throw new GroupInviteError("INVITE_USAGE_LIMIT_REACHED");
  }
}

export function buildInviteStatusUpdate({
  invite,
  nextStatus,
  actorUid,
  now,
}) {
  const timestamp = requireTimestamp(now);
  validateInviteTransition(invite?.status, nextStatus);

  const update = {
    status: nextStatus,
    updatedAt: timestamp,
    statusChangedByUid: validateUserId(actorUid, "actorUid"),
  };

  if (nextStatus === GroupInviteStatus.ACCEPTED) {
    const currentUseCount =
      Number.isInteger(invite.useCount)
        ? invite.useCount
        : 0;

    const nextUseCount =
      currentUseCount + 1;

    const isReusableInvite =
      invite.type === GroupInviteType.LINK ||
      invite.type === GroupInviteType.QR;

    const usageLimitReached =
      Number.isInteger(invite.maxUses) &&
      nextUseCount >= invite.maxUses;

    update.useCount = nextUseCount;
    update.lastAcceptedAt = timestamp;

    if (
      isReusableInvite &&
      !usageLimitReached
    ) {
      update.status =
        GroupInviteStatus.PENDING;
      update.lastAcceptedByUid =
        validateUserId(
          actorUid,
          "actorUid"
        );
    } else {
      update.status =
        GroupInviteStatus.ACCEPTED;
      update.acceptedAt = timestamp;
    }
  }

  if (nextStatus === GroupInviteStatus.DECLINED) {
    update.declinedAt = timestamp;
  }

  if (
    nextStatus === GroupInviteStatus.REVOKED ||
    nextStatus === GroupInviteStatus.CANCELLED
  ) {
    update.revokedAt = timestamp;
  }

  if (nextStatus === GroupInviteStatus.EXPIRED) {
    update.expiredAt = timestamp;
  }

  return update;
}

export function buildMembershipFromAcceptedInvite({
  invite,
  userId,
  user,
  now,
}) {
  if (!invite || invite.status !== GroupInviteStatus.PENDING) {
    throw new GroupInviteError("INVITE_NOT_PENDING");
  }

  return buildActiveMembership({
    groupId: invite.groupId,
    userId,
    role: GroupRole.MEMBER,
    source:
      invite.type === GroupInviteType.DIRECT_USER
        ? GroupMembershipSource.INVITE
        : GroupMembershipSource.LINK_JOIN,
    now: requireTimestamp(now),
    user,
    invitedByUid: invite.inviterUid,
  });
}
