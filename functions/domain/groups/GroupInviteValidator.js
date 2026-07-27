import {
  GroupInviteSource,
  GroupInviteStatus,
  GroupInviteType,
  isEnumValue,
} from "./GroupEnums.js";
import {
  GROUP_DEFAULT_LINK_MAX_USES,
} from "./GroupConstants.js";
import {
  asTrimmedString,
  validateGroupId,
  validateUserId,
} from "./GroupValidator.js";

export class GroupInviteValidationError extends Error {
  constructor(code, field, message = code) {
    super(message);
    this.name = "GroupInviteValidationError";
    this.code = code;
    this.field = field;
  }
}

function requireObject(value, field = "payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GroupInviteValidationError("INVALID_PAYLOAD", field);
  }
  return value;
}

function requireEnum(value, field, enumObject) {
  if (!isEnumValue(enumObject, value)) {
    throw new GroupInviteValidationError("INVALID_ENUM_VALUE", field);
  }
  return value;
}

function optionalTrimmedString(value, field, maxLength) {
  if (value === undefined || value === null) return undefined;

  const result = asTrimmedString(value);
  if (!result) return undefined;

  if (result.length > maxLength) {
    throw new GroupInviteValidationError("VALUE_TOO_LONG", field);
  }

  return result;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new GroupInviteValidationError("INVALID_POSITIVE_INTEGER", field);
  }
  return value;
}

export function validateInviteId(value) {
  const inviteId = asTrimmedString(value);

  if (!inviteId || inviteId.length > 128 || inviteId.includes("/")) {
    throw new GroupInviteValidationError("INVALID_INVITE_ID", "inviteId");
  }

  return inviteId;
}

export function validateInviteToken(value) {
  const token = asTrimmedString(value);

  if (
    token.length < 32 ||
    token.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new GroupInviteValidationError("INVALID_INVITE_TOKEN", "token");
  }

  return token;
}

export function validateCreateDirectInviteInput(input) {
  requireObject(input);

  const groupId = validateGroupId(input.groupId);
  const targetUserId = validateUserId(input.targetUserId, "targetUserId");
  const source = requireEnum(
    input.source ?? GroupInviteSource.INTERNAL_SEARCH,
    "source",
    GroupInviteSource
  );

  return {
    groupId,
    targetUserId,
    type: GroupInviteType.DIRECT_USER,
    source,
    ...(optionalTrimmedString(input.message, "message", 280)
      ? { message: optionalTrimmedString(input.message, "message", 280) }
      : {}),
  };
}

export function validateCreateLinkInviteInput(input) {
  requireObject(input);

  const groupId = validateGroupId(input.groupId);
  const type = requireEnum(
    input.type ?? GroupInviteType.LINK,
    "type",
    GroupInviteType
  );

  if (![GroupInviteType.LINK, GroupInviteType.QR].includes(type)) {
    throw new GroupInviteValidationError("INVALID_LINK_INVITE_TYPE", "type");
  }

  const source = requireEnum(
    input.source ??
      (type === GroupInviteType.QR
        ? GroupInviteSource.QR
        : GroupInviteSource.SHARE_SHEET),
    "source",
    GroupInviteSource
  );

  const maxUses = requirePositiveInteger(
    input.maxUses ?? GROUP_DEFAULT_LINK_MAX_USES,
    "maxUses"
  );

  if (maxUses > 10000) {
    throw new GroupInviteValidationError("MAX_USES_TOO_HIGH", "maxUses");
  }

  return {
    groupId,
    type,
    source,
    maxUses,
    ...(optionalTrimmedString(input.label, "label", 80)
      ? { label: optionalTrimmedString(input.label, "label", 80) }
      : {}),
  };
}

export function validateInviteStatus(value) {
  return requireEnum(value, "status", GroupInviteStatus);
}

export function validateInviteTransition(currentStatus, nextStatus) {
  validateInviteStatus(currentStatus);
  validateInviteStatus(nextStatus);

  const allowed = {
    [GroupInviteStatus.PENDING]: new Set([
      GroupInviteStatus.ACCEPTED,
      GroupInviteStatus.DECLINED,
      GroupInviteStatus.CANCELLED,
      GroupInviteStatus.REVOKED,
      GroupInviteStatus.EXPIRED,
    ]),
    [GroupInviteStatus.ACCEPTED]: new Set(),
    [GroupInviteStatus.DECLINED]: new Set(),
    [GroupInviteStatus.CANCELLED]: new Set(),
    [GroupInviteStatus.REVOKED]: new Set(),
    [GroupInviteStatus.EXPIRED]: new Set(),
  };

  if (!allowed[currentStatus]?.has(nextStatus)) {
    throw new GroupInviteValidationError(
      "INVALID_INVITE_STATUS_TRANSITION",
      "status"
    );
  }

  return nextStatus;
}
