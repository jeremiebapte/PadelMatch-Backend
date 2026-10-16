import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGetNotificationPreferencesV2,
  buildSetNotificationPreferencesV2,
} from "../notificationPreferencesCallablesV2.js";

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function setup(initial = null) {
  let stored = initial;
  const writes = [];
  const paths = [];

  const db = {
    doc(path) {
      paths.push(path);

      return {
        async get() {
          return {
            exists: stored !== null,
            data: () => stored,
          };
        },

        async set(data) {
          writes.push(data);
          stored = data;
        },
      };
    },
  };

  const onCall = (_runtime, handler) => handler;

  const deps = {
    onCall,
    HttpsError,
    runtime: {},
    db,
  };

  return {
    get: buildGetNotificationPreferencesV2(deps),
    set: buildSetNotificationPreferencesV2(deps),
    writes,
    paths,
  };
}

test("lecture sans compte authentifié refusée", async () => {
  const app = setup();

  await assert.rejects(
    app.get({ data: {} }),
    { code: "unauthenticated" }
  );
});

test("écriture sans compte authentifié refusée", async () => {
  const app = setup();

  await assert.rejects(
    app.set({ data: { preferences: {} } }),
    { code: "unauthenticated" }
  );

  assert.equal(app.writes.length, 0);
});

test("ancien compte : préférences V2 par défaut", async () => {
  const app = setup();

  const result = await app.get({
    auth: { uid: "alice" },
  });

  assert.deepEqual(result.preferences, {
    version: 2,
    categories: {},
    events: {},
  });

  assert.deepEqual(app.paths, [
    "users/alice/private/notificationPreferences",
  ]);
});

test("lecture des préférences existantes", async () => {
  const existing = {
    version: 2,
    categories: { messages: false },
    events: { marketing: false },
  };

  const app = setup(existing);

  const result = await app.get({
    auth: { uid: "alice" },
  });

  assert.deepEqual(result.preferences, existing);
});

test("écriture valide dans le document du propriétaire", async () => {
  const app = setup();

  const result = await app.set({
    auth: { uid: "alice" },
    data: {
      preferences: {
        categories: { availability: false },
        events: { marketing: false },
      },
    },
  });

  assert.equal(result.ok, true);

  assert.deepEqual(app.paths, [
    "users/alice/private/notificationPreferences",
  ]);

  assert.deepEqual(app.writes, [result.preferences]);
});

test("un uid client ne peut pas détourner l'écriture", async () => {
  const app = setup();

  await app.set({
    auth: { uid: "alice" },
    data: {
      uid: "bob",
      preferences: {
        categories: { messages: false },
      },
    },
  });

  assert.deepEqual(app.paths, [
    "users/alice/private/notificationPreferences",
  ]);
});

test("catégorie inconnue refusée sans écriture", async () => {
  const app = setup();

  await assert.rejects(
    app.set({
      auth: { uid: "alice" },
      data: {
        preferences: {
          categories: { unknown: false },
        },
      },
    }),
    { code: "invalid-argument" }
  );

  assert.equal(app.writes.length, 0);
});

test("événement mal typé refusé sans écriture", async () => {
  const app = setup();

  await assert.rejects(
    app.set({
      auth: { uid: "alice" },
      data: {
        preferences: {
          events: { marketing: "false" },
        },
      },
    }),
    { code: "invalid-argument" }
  );

  assert.equal(app.writes.length, 0);
});

test("lecture après écriture conserve les réglages", async () => {
  const app = setup();
  const req = { auth: { uid: "alice" } };

  await app.set({
    ...req,
    data: {
      preferences: {
        categories: { groups: false },
      },
    },
  });

  const result = await app.get(req);

  assert.equal(
    result.preferences.categories.groups,
    false
  );
});
