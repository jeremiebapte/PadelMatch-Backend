import {
  GroupDiscoverability,
  GroupJoinPolicy,
  GroupStatus,
  GroupType,
  PreferredTimeSlot,
  isEnumValue,
} from "./GroupEnums.js";
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_LEVEL_MAX,
  GROUP_LEVEL_MIN,
  GROUP_NAME_MAX_LENGTH,
  GROUP_NAME_MIN_LENGTH,
  GROUP_TAG_MAX_COUNT,
  GROUP_TAG_MAX_LENGTH,
} from "./GroupConstants.js";

export class GroupValidationError extends Error {
  constructor(code, field, message = code) {
    super(message);
    this.name = "GroupValidationError";
    this.code = code;
    this.field = field;
  }
}

export function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSearchText(value) {
  return asTrimmedString(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeTag(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9._ -]/g, "")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) {
    throw new GroupValidationError("INVALID_TAGS", "tags");
  }

  const normalized = [...new Set(value.map(normalizeTag).filter(Boolean))];

  if (normalized.length > GROUP_TAG_MAX_COUNT) {
    throw new GroupValidationError("TOO_MANY_TAGS", "tags");
  }

  if (normalized.some((tag) => tag.length > GROUP_TAG_MAX_LENGTH)) {
    throw new GroupValidationError("TAG_TOO_LONG", "tags");
  }

  return normalized;
}

function requireString(value, field, min, max) {
  const result = asTrimmedString(value);
  if (result.length < min) {
    throw new GroupValidationError("VALUE_TOO_SHORT", field);
  }
  if (result.length > max) {
    throw new GroupValidationError("VALUE_TOO_LONG", field);
  }
  return result;
}

function optionalString(value, field, max) {
  if (value === undefined || value === null) return undefined;
  const result = asTrimmedString(value);
  if (result.length > max) {
    throw new GroupValidationError("VALUE_TOO_LONG", field);
  }
  return result || undefined;
}

function requireEnum(value, field, enumObject) {
  if (!isEnumValue(enumObject, value)) {
    throw new GroupValidationError("INVALID_ENUM_VALUE", field);
  }
  return value;
}

function requireLevel(value, field) {
  if (!Number.isInteger(value) || value < GROUP_LEVEL_MIN || value > GROUP_LEVEL_MAX) {
    throw new GroupValidationError("INVALID_LEVEL", field);
  }
  return value;
}

function optionalCoordinate(value, field, min, max) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new GroupValidationError("INVALID_COORDINATE", field);
  }
  return value;
}

function validateWeekdays(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new GroupValidationError("INVALID_WEEKDAYS", "preferredWeekdays");
  }

  const result = [...new Set(value)];
  if (result.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new GroupValidationError("INVALID_WEEKDAYS", "preferredWeekdays");
  }
  return result.sort((a, b) => a - b);
}

function validateTimeSlots(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new GroupValidationError("INVALID_TIME_SLOTS", "preferredTimeSlots");
  }
  const result = [...new Set(value)];
  if (result.some((slot) => !isEnumValue(PreferredTimeSlot, slot))) {
    throw new GroupValidationError("INVALID_TIME_SLOTS", "preferredTimeSlots");
  }
  return result;
}

export function validateCreateGroupInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GroupValidationError("INVALID_PAYLOAD", "payload");
  }

  const name = requireString(
    input.name,
    "name",
    GROUP_NAME_MIN_LENGTH,
    GROUP_NAME_MAX_LENGTH
  );

  const description =
    optionalString(input.description, "description", GROUP_DESCRIPTION_MAX_LENGTH) ?? "";

  const type = requireEnum(input.type, "type", GroupType);
  const discoverability = requireEnum(
    input.discoverability,
    "discoverability",
    GroupDiscoverability
  );
  const joinPolicy = requireEnum(input.joinPolicy, "joinPolicy", GroupJoinPolicy);

  const city = optionalString(input.city, "city", 80) ?? "";
  const countryCode = requireString(input.countryCode, "countryCode", 2, 2).toUpperCase();
  const levelMin = requireLevel(input.levelMin, "levelMin");
  const levelMax = requireLevel(input.levelMax, "levelMax");

  if (levelMax < levelMin) {
    throw new GroupValidationError("INVALID_LEVEL_RANGE", "levelMax");
  }

  const latitude = optionalCoordinate(input.latitude, "latitude", -90, 90);
  const longitude = optionalCoordinate(input.longitude, "longitude", -180, 180);

  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new GroupValidationError("INCOMPLETE_LOCATION", "location");
  }

  if (
    discoverability === GroupDiscoverability.SEARCHABLE &&
    !city &&
    (latitude === undefined || longitude === undefined)
  ) {
    throw new GroupValidationError("SEARCHABLE_GROUP_REQUIRES_LOCATION", "discoverability");
  }

  const defaultClubId = optionalString(input.defaultClubId, "defaultClubId", 128);
  if (type === GroupType.CLUB_COMMUNITY && !defaultClubId) {
    throw new GroupValidationError("CLUB_COMMUNITY_REQUIRES_CLUB", "defaultClubId");
  }

  return {
    name,
    nameNormalized: normalizeSearchText(name),
    description,
    type,
    status: GroupStatus.ACTIVE,
    discoverability,
    joinPolicy,
    city,
    countryCode,
    tags: normalizeTags(input.tags ?? []),
    levelMin,
    levelMax,
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(defaultClubId ? { defaultClubId } : {}),
    ...(optionalString(input.defaultClubNameSnapshot, "defaultClubNameSnapshot", 120)
      ? { defaultClubNameSnapshot: optionalString(input.defaultClubNameSnapshot, "defaultClubNameSnapshot", 120) }
      : {}),
    ...(validateWeekdays(input.preferredWeekdays)
      ? { preferredWeekdays: validateWeekdays(input.preferredWeekdays) }
      : {}),
    ...(validateTimeSlots(input.preferredTimeSlots)
      ? { preferredTimeSlots: validateTimeSlots(input.preferredTimeSlots) }
      : {}),
  };
}


const GROUP_UPDATE_ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "type",
  "discoverability",
  "joinPolicy",
  "city",
  "countryCode",
  "tags",
  "levelMin",
  "levelMax",
  "latitude",
  "longitude",
  "defaultClubId",
  "defaultClubNameSnapshot",
  "preferredWeekdays",
  "preferredTimeSlots",
  "imageUrl",
]);

const GROUP_UPDATE_IMMUTABLE_FIELDS = new Set([
  "groupId",
  "ownerUid",
  "status",
  "settings",
  "stats",
  "health",
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "createdBySource",
  "linkJoinEnabled",
  "inviteCodeVersion",
  "archivedAt",
  "deletedAt",
  "deletedByUid",
]);

function assertValidUpdateFields(input) {
  for (const field of Object.keys(input)) {
    if (field === "groupId") continue;

    if (GROUP_UPDATE_IMMUTABLE_FIELDS.has(field)) {
      throw new GroupValidationError("IMMUTABLE_FIELD", field);
    }

    if (!GROUP_UPDATE_ALLOWED_FIELDS.has(field)) {
      throw new GroupValidationError("UNKNOWN_FIELD", field);
    }
  }
}

export function validateUpdateGroupInput(input, currentGroup) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GroupValidationError("INVALID_PAYLOAD", "payload");
  }

  if (!currentGroup || typeof currentGroup !== "object" || Array.isArray(currentGroup)) {
    throw new GroupValidationError("INVALID_CURRENT_GROUP", "currentGroup");
  }

  assertValidUpdateFields(input);

  const suppliedFields = Object.keys(input).filter((field) => field !== "groupId");
  if (suppliedFields.length === 0) {
    throw new GroupValidationError("EMPTY_UPDATE", "payload");
  }

  const result = {};

  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = requireString(
      input.name,
      "name",
      GROUP_NAME_MIN_LENGTH,
      GROUP_NAME_MAX_LENGTH
    );

    result.name = name;
    result.nameNormalized = normalizeSearchText(name);
  }

  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    result.description =
      optionalString(
        input.description,
        "description",
        GROUP_DESCRIPTION_MAX_LENGTH
      ) ?? "";
  }

  if (Object.prototype.hasOwnProperty.call(input, "imageUrl")) {
    const imageUrl = optionalString(
      input.imageUrl,
      "imageUrl",
      2048
    );

    if (!imageUrl) {
      throw new GroupValidationError(
        "INVALID_IMAGE_URL",
        "imageUrl"
      );
    }

    try {
      const parsedImageUrl = new URL(imageUrl);

      if (parsedImageUrl.protocol !== "https:") {
        throw new Error("INVALID_PROTOCOL");
      }
    } catch {
      throw new GroupValidationError(
        "INVALID_IMAGE_URL",
        "imageUrl"
      );
    }

    result.imageUrl = imageUrl;
  }

  if (Object.prototype.hasOwnProperty.call(input, "type")) {
    result.type = requireEnum(input.type, "type", GroupType);
  }

  if (Object.prototype.hasOwnProperty.call(input, "discoverability")) {
    result.discoverability = requireEnum(
      input.discoverability,
      "discoverability",
      GroupDiscoverability
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "joinPolicy")) {
    result.joinPolicy = requireEnum(
      input.joinPolicy,
      "joinPolicy",
      GroupJoinPolicy
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "city")) {
    result.city = optionalString(input.city, "city", 80) ?? "";
  }

  if (Object.prototype.hasOwnProperty.call(input, "countryCode")) {
    result.countryCode = requireString(
      input.countryCode,
      "countryCode",
      2,
      2
    ).toUpperCase();
  }

  if (Object.prototype.hasOwnProperty.call(input, "tags")) {
    result.tags = normalizeTags(input.tags);
  }

  if (Object.prototype.hasOwnProperty.call(input, "levelMin")) {
    result.levelMin = requireLevel(input.levelMin, "levelMin");
  }

  if (Object.prototype.hasOwnProperty.call(input, "levelMax")) {
    result.levelMax = requireLevel(input.levelMax, "levelMax");
  }

  const hasLatitude = Object.prototype.hasOwnProperty.call(input, "latitude");
  const hasLongitude = Object.prototype.hasOwnProperty.call(input, "longitude");

  if (hasLatitude !== hasLongitude) {
    throw new GroupValidationError("INCOMPLETE_LOCATION", "location");
  }

  if (hasLatitude && hasLongitude) {
    if (
      input.latitude === null &&
      input.longitude === null
    ) {
      result.latitude = null;
      result.longitude = null;
    } else {
      result.latitude = optionalCoordinate(
        input.latitude,
        "latitude",
        -90,
        90
      );
      result.longitude = optionalCoordinate(
        input.longitude,
        "longitude",
        -180,
        180
      );

      if (
        result.latitude === undefined ||
        result.longitude === undefined
      ) {
        throw new GroupValidationError("INCOMPLETE_LOCATION", "location");
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "defaultClubId")) {
    const defaultClubId = optionalString(
      input.defaultClubId,
      "defaultClubId",
      128
    );

    result.defaultClubId = defaultClubId ?? null;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "defaultClubNameSnapshot"
    )
  ) {
    const snapshot = optionalString(
      input.defaultClubNameSnapshot,
      "defaultClubNameSnapshot",
      120
    );

    result.defaultClubNameSnapshot = snapshot ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "preferredWeekdays")) {
    result.preferredWeekdays =
      validateWeekdays(input.preferredWeekdays) ?? [];
  }

  if (Object.prototype.hasOwnProperty.call(input, "preferredTimeSlots")) {
    result.preferredTimeSlots =
      validateTimeSlots(input.preferredTimeSlots) ?? [];
  }

  const mergedGroup = {
    ...currentGroup,
    ...result,
  };

  const finalLevelMin = mergedGroup.levelMin;
  const finalLevelMax = mergedGroup.levelMax;

  if (
    !Number.isInteger(finalLevelMin) ||
    !Number.isInteger(finalLevelMax) ||
    finalLevelMax < finalLevelMin
  ) {
    throw new GroupValidationError("INVALID_LEVEL_RANGE", "levelMax");
  }

  const finalLatitude =
    result.latitude === null ? undefined : mergedGroup.latitude;
  const finalLongitude =
    result.longitude === null ? undefined : mergedGroup.longitude;

  if ((finalLatitude === undefined) !== (finalLongitude === undefined)) {
    throw new GroupValidationError("INCOMPLETE_LOCATION", "location");
  }

  if (
    mergedGroup.discoverability === GroupDiscoverability.SEARCHABLE &&
    !asTrimmedString(mergedGroup.city) &&
    (finalLatitude === undefined || finalLongitude === undefined)
  ) {
    throw new GroupValidationError(
      "SEARCHABLE_GROUP_REQUIRES_LOCATION",
      "discoverability"
    );
  }

  if (
    mergedGroup.type === GroupType.CLUB_COMMUNITY &&
    !asTrimmedString(mergedGroup.defaultClubId)
  ) {
    throw new GroupValidationError(
      "CLUB_COMMUNITY_REQUIRES_CLUB",
      "defaultClubId"
    );
  }

  return result;
}

export function validateGroupId(value) {
  const groupId = asTrimmedString(value);
  if (!groupId || groupId.length > 128 || groupId.includes("/")) {
    throw new GroupValidationError("INVALID_GROUP_ID", "groupId");
  }
  return groupId;
}

export function validateUserId(value, field = "userId") {
  const userId = asTrimmedString(value);
  if (!userId || userId.length > 128 || userId.includes("/")) {
    throw new GroupValidationError("INVALID_USER_ID", field);
  }
  return userId;
}
