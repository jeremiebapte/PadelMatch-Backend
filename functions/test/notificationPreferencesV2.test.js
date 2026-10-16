import test from "node:test";
import assert from "node:assert/strict";

import {
  isNotificationPushAllowed as allowed,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_PREFERENCES_VERSION,
} from "../domain/notifications/NotificationPreferencesV2.js";

test("contrat V2 expose huit catégories", () => {
  assert.equal(
    Object.keys(NOTIFICATION_CATEGORIES).length,
    8
  );
  assert.equal(NOTIFICATION_PREFERENCES_VERSION, 2);
});

test("tous les événements ont une catégorie valide", () => {
  const categories = new Set(
    Object.values(NOTIFICATION_CATEGORIES)
  );
  for (const category of Object.values(NOTIFICATION_EVENTS)) {
    assert.ok(categories.has(category));
  }
});

test("ancien profil : comportement autorisé par défaut", () => {
  assert.equal(allowed({
    user: { notificationsEnabled: true },
    category: "matches",
    event: "matchPlayerJoined",
  }), true);
});

test("désactivation globale prioritaire", () => {
  assert.equal(allowed({
    user: { notificationsEnabled: false },
    category: "messages",
    event: "groupMessage",
  }), false);
});

test("catégorie désactivée bloque son événement", () => {
  assert.equal(allowed({
    user: {
      notificationsEnabled: true,
      notificationPreferencesV2: {
        categories: { availability: false },
      },
    },
    category: "availability",
    event: "availabilityOverlap",
  }), false);
});

test("événement désactivé sans bloquer sa catégorie", () => {
  const user = {
    notificationsEnabled: true,
    notificationPreferencesV2: {
      events: { marketing: false },
    },
  };
  assert.equal(allowed({
    user, category: "news", event: "marketing",
  }), false);
  assert.equal(allowed({
    user, category: "news", event: "productNews",
  }), true);
});

test("préférences de groupe héritées respectées", () => {
  assert.equal(allowed({
    user: { notificationsEnabled: true },
    category: "messages",
    event: "groupMessage",
    membership: {
      notificationsEnabled: true,
      messageNotificationsEnabled: false,
    },
  }), false);
});

test("catégorie inconnue refusée", () => {
  assert.throws(() => allowed({
    user: {},
    category: "unknown",
  }), /UNKNOWN_NOTIFICATION_CATEGORY/);
});

test("événement incohérent refusé", () => {
  assert.throws(() => allowed({
    user: {},
    category: "matches",
    event: "marketing",
  }), /UNKNOWN_NOTIFICATION_EVENT/);
});

test("événements de matchs de groupe classés par destinataire", () => {
  assert.equal(NOTIFICATION_EVENTS.groupMatchCreated, "groups");

  for (const event of [
    "groupMatchUpdated",
    "groupMatchCancelled",
    "groupMatchPlayerJoined",
    "groupMatchPlayerLeft",
    "groupMatchFull",
    "groupMatchSpotAvailable",
  ]) {
    assert.equal(NOTIFICATION_EVENTS[event], "matches");
  }
});
