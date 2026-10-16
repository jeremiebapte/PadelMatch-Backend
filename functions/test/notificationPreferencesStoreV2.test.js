import test from "node:test";
import assert from "node:assert/strict";

import {
  validateNotificationPreferencesV2 as validate,
  notificationPreferencesDocumentPath,
} from "../domain/notifications/NotificationPreferencesStoreV2.js";

test("document privé propre à chaque utilisateur", () => {
  assert.equal(
    notificationPreferencesDocumentPath("user123"),
    "users/user123/private/notificationPreferences"
  );
});

test("document minimal compatible V2", () => {
  assert.deepEqual(validate({}), {
    version: 2,
    categories: {},
    events: {},
  });
});

test("catégories et événements autorisés", () => {
  assert.deepEqual(
    validate({
      version: 2,
      categories: { messages: false, matches: true },
      events: { groupMessage: false },
    }),
    {
      version: 2,
      categories: { messages: false, matches: true },
      events: { groupMessage: false },
    }
  );
});

test("catégorie inconnue refusée", () => {
  assert.throws(
    () => validate({ categories: { unknown: false } }),
    /INVALID_CATEGORIES/
  );
});

test("événement inconnu refusé", () => {
  assert.throws(
    () => validate({ events: { unknown: true } }),
    /INVALID_EVENTS/
  );
});

test("valeurs non booléennes refusées", () => {
  assert.throws(
    () => validate({ categories: { messages: "false" } }),
    /INVALID_CATEGORIES/
  );
});

test("champs supplémentaires refusés", () => {
  assert.throws(
    () => validate({ admin: true }),
    /UNKNOWN_NOTIFICATION_PREFERENCES_FIELD/
  );
});

test("versions inconnues refusées", () => {
  assert.throws(
    () => validate({ version: 3 }),
    /INVALID_NOTIFICATION_PREFERENCES_VERSION/
  );
});

test("identifiants de document invalides refusés", () => {
  assert.throws(
    () => notificationPreferencesDocumentPath("other/user"),
    /INVALID_USER_ID/
  );
});
