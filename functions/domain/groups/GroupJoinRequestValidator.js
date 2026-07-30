import {
  GroupJoinRequestStatus,
} from "./GroupEnums.js";
import {
  validateGroupId,
  validateUserId,
} from "./GroupValidator.js";

export class GroupJoinRequestValidationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GroupJoinRequestValidationError";
    this.code = code;
  }
}

function requireObject(value, fieldName = "input") {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new GroupJoinRequestValidationError(
      "INVALID_INPUT",
      `${fieldName} must be an object`
    );
  }

  return value;
}

function validateStrictKeys(input, allowedKeys) {
  const unknownKeys = Object
    .keys(input)
    .filter((key) => !allowedKeys.includes(key));

  if (unknownKeys.length > 0) {
    throw new GroupJoinRequestValidationError(
      "UNKNOWN_INPUT_FIELDS",
      `Unknown fields: ${unknownKeys.join(", ")}`
    );
  }
}

export function validateCreateGroupJoinRequestInput(rawInput) {
  const input = requireObject(rawInput);

  validateStrictKeys(input, [
    "groupId",
  ]);

  return {
    groupId: validateGroupId(input.groupId),
  };
}

export function validateResolveGroupJoinRequestInput(rawInput) {
  const input = requireObject(rawInput);

  validateStrictKeys(input, [
    "requestId",
  ]);

  const requestId =
    typeof input.requestId === "string"
      ? input.requestId.trim()
      : "";

  if (!requestId) {
    throw new GroupJoinRequestValidationError(
      "INVALID_JOIN_REQUEST_ID"
    );
  }

  if (requestId.length > 200) {
    throw new GroupJoinRequestValidationError(
      "INVALID_JOIN_REQUEST_ID"
    );
  }

  return {
    requestId,
  };
}

export function validateGroupJoinRequestTransition({
  currentStatus,
  nextStatus,
}) {
  const transitions = {
    [GroupJoinRequestStatus.PENDING]: new Set([
      GroupJoinRequestStatus.APPROVED,
      GroupJoinRequestStatus.REJECTED,
      GroupJoinRequestStatus.CANCELLED,
      GroupJoinRequestStatus.EXPIRED,
    ]),
    [GroupJoinRequestStatus.APPROVED]: new Set(),
    [GroupJoinRequestStatus.REJECTED]: new Set(),
    [GroupJoinRequestStatus.CANCELLED]: new Set(),
    [GroupJoinRequestStatus.EXPIRED]: new Set(),
  };

  const allowed = transitions[currentStatus];

  if (!allowed || !allowed.has(nextStatus)) {
    throw new GroupJoinRequestValidationError(
      "INVALID_JOIN_REQUEST_TRANSITION"
    );
  }

  return true;
}

export function validateJoinRequestOwner({
  requesterUid,
  authenticatedUid,
}) {
  const requester =
    validateUserId(
      requesterUid,
      "requesterUid"
    );

  const authenticated =
    validateUserId(
      authenticatedUid,
      "authenticatedUid"
    );

  if (requester !== authenticated) {
    throw new GroupJoinRequestValidationError(
      "JOIN_REQUEST_NOT_OWNED_BY_USER"
    );
  }

  return true;
}
