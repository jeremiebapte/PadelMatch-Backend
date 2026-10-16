import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_PREFERENCES_VERSION,
} from "./NotificationPreferencesV2.js";

export const NOTIFICATION_PREFERENCES_PATH = Object.freeze({
  collection: "private",
  document: "notificationPreferences",
});

const categories = new Set(Object.values(NOTIFICATION_CATEGORIES));
const events = new Set(Object.keys(NOTIFICATION_EVENTS));

function validateFlags(value, allowed, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`INVALID_${label}`);
  }

  const result = {};

  for (const [key, enabled] of Object.entries(value)) {
    if (!allowed.has(key) || typeof enabled !== "boolean") {
      throw new TypeError(`INVALID_${label}`);
    }
    result[key] = enabled;
  }

  return result;
}

export function validateNotificationPreferencesV2(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new TypeError("INVALID_NOTIFICATION_PREFERENCES");
  }

  const keys = Object.keys(input);

  if (keys.some(key => !["version", "categories", "events"].includes(key))) {
    throw new TypeError("UNKNOWN_NOTIFICATION_PREFERENCES_FIELD");
  }

  if (
    input.version !== undefined &&
    input.version !== NOTIFICATION_PREFERENCES_VERSION
  ) {
    throw new TypeError("INVALID_NOTIFICATION_PREFERENCES_VERSION");
  }

  return {
    version: NOTIFICATION_PREFERENCES_VERSION,
    categories: validateFlags(
      input.categories ?? {}, categories, "CATEGORIES"
    ),
    events: validateFlags(
      input.events ?? {}, events, "EVENTS"
    ),
  };
}

export function notificationPreferencesDocumentPath(uid) {
  if (
    typeof uid !== "string" ||
    !uid.trim() ||
    uid.includes("/")
  ) {
    throw new TypeError("INVALID_USER_ID");
  }

  return `users/${uid}/private/notificationPreferences`;
}
