import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNotificationPushGateV2,
} from "../domain/notifications/NotificationPushGateV2.js";

function setup({
  user = { notificationsEnabled: true },
  preferences = null,
} = {}) {
  const reads = [];

  const db = {
    doc(path) {
      reads.push(path);

      const value =
        path.endsWith("/private/notificationPreferences")
          ? preferences
          : user;

      return {
        async get() {
          return {
            exists: value !== null,
            data: () => value,
          };
        },
      };
    },
  };

  return {
    allowed: buildNotificationPushGateV2({ db }),
    reads,
  };
}

const availability = {
  uid: "alice",
  category: "availability",
  event: "availabilityOverlap",
};

test("ancien profil : autorisation conservée", async () => {
  const app = setup();
  assert.equal(await app.allowed(availability), true);
});

test("utilisateur inexistant : push refusé", async () => {
  const app = setup({ user: null });
  assert.equal(await app.allowed(availability), false);
});

test("désactivation globale prioritaire", async () => {
  const app = setup({
    user: { notificationsEnabled: false },
  });

  assert.equal(await app.allowed(availability), false);
  assert.deepEqual(app.reads, ["users/alice"]);
});

test("catégorie désactivée : push refusé", async () => {
  const app = setup({
    preferences: {
      version: 2,
      categories: { availability: false },
      events: {},
    },
  });

  assert.equal(await app.allowed(availability), false);
});

test("événement désactivé : push refusé", async () => {
  const app = setup({
    preferences: {
      version: 2,
      categories: {},
      events: { availabilityOverlap: false },
    },
  });

  assert.equal(await app.allowed(availability), false);
});

test("rappel autorisé si seul Ça matche est coupé", async () => {
  const app = setup({
    preferences: {
      version: 2,
      categories: {},
      events: { availabilityOverlap: false },
    },
  });

  assert.equal(await app.allowed({
    uid: "alice",
    category: "availability",
    event: "availabilityReminder",
  }), true);
});

test("désactivation historique de groupe respectée", async () => {
  const app = setup();

  assert.equal(await app.allowed({
    uid: "alice",
    category: "messages",
    event: "groupMessage",
    membership: {
      messageNotificationsEnabled: false,
    },
  }), false);
});

test("document privé lu pour le bon utilisateur", async () => {
  const app = setup();

  await app.allowed(availability);

  assert.deepEqual(app.reads, [
    "users/alice",
    "users/alice/private/notificationPreferences",
  ]);
});

test("identifiant invalide rejeté", async () => {
  const app = setup();

  await assert.rejects(
    app.allowed({
      ...availability,
      uid: "bob/alice",
    }),
    /INVALID_USER_ID/
  );
});

test("préférences invalides non ignorées", async () => {
  const app = setup({
    preferences: {
      version: 2,
      categories: { availability: "false" },
      events: {},
    },
  });

  await assert.rejects(
    app.allowed(availability),
    /INVALID_CATEGORIES/
  );
});
