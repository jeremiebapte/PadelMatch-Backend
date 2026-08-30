import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreateMatch,
} from "../createMatch.js";

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function makeDb() {
  return {
    collection(name) {
      if (name === "users") {
        return {
          doc() {
            return {
              async get() {
                return {
                  exists: true,
                  get(field) {
                    if (field === "pseudo") return "Testeur";
                    if (field === "avatar") return "";
                    return null;
                  },
                };
              },
            };
          },
        };
      }

      if (name === "matches") {
        return {
          async add(document) {
            return {
              id: "match_test_123",
              document,
            };
          },
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

function buildCallable() {
  let handler = null;

  const callable = buildCreateMatch({
    onCall: (_runtime, fn) => {
      handler = fn;
      return fn;
    },
    HttpsError: FakeHttpsError,
    runtime: {},
    db: makeDb(),
    FieldValue: {
      serverTimestamp() {
        return "SERVER_TIMESTAMP";
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    hasTimeOverlap: async () => false,
    hasReservationOverlap: async () => false,
    recordClubActivity: async () => {},
    notifyGroupMatchCreated: async () => {},
    frDate: () => "30/08/2026",
    frTime: () => "18:00",
  });

  assert.equal(typeof callable, "function");
  assert.equal(typeof handler, "function");

  return handler;
}

function validData(overrides = {}) {
  return {
    createdByType: "player",
    placeId: "place_123",
    lieu: "Club Test",
    dateHeure: Date.now() + 3_600_000,
    lat: 48.8566,
    lng: 2.3522,
    niveau: 5,
    joueursManquants: 3,
    ...overrides,
  };
}

test("createMatch accepts joueursManquants=3", async () => {
  const handler = buildCallable();

  const result = await handler({
    auth: { uid: "user_123" },
    data: validData({
      joueursManquants: 3,
    }),
  });

  assert.deepEqual(result, {
    ok: true,
    matchId: "match_test_123",
  });
});

test("createMatch still accepts joueursManquants=1", async () => {
  const handler = buildCallable();

  const result = await handler({
    auth: { uid: "user_123" },
    data: validData({
      joueursManquants: 1,
    }),
  });

  assert.equal(result.ok, true);
});

test("createMatch still accepts joueursManquants=2", async () => {
  const handler = buildCallable();

  const result = await handler({
    auth: { uid: "user_123" },
    data: validData({
      joueursManquants: 2,
    }),
  });

  assert.equal(result.ok, true);
});

test("createMatch rejects joueursManquants=4", async () => {
  const handler = buildCallable();

  await assert.rejects(
    () =>
      handler({
        auth: { uid: "user_123" },
        data: validData({
          joueursManquants: 4,
        }),
      }),
    error =>
      error instanceof FakeHttpsError
      && error.code === "invalid-argument"
      && error.message ===
        "INVALID_ARGUMENT: joueursManquants must be 1, 2 or 3"
  );
});

test("createMatch rejects joueursManquants=0", async () => {
  const handler = buildCallable();

  await assert.rejects(
    () =>
      handler({
        auth: { uid: "user_123" },
        data: validData({
          joueursManquants: 0,
        }),
      }),
    error =>
      error instanceof FakeHttpsError
      && error.code === "invalid-argument"
  );
});
