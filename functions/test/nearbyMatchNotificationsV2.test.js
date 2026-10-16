import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(
  new URL("../index.js", import.meta.url)
);

const source = readFileSync(indexPath, "utf8");

const startMarker =
  "async function pushNearbyForMatchId(matchId) {";

const endMarker =
  "\n// ======================================================\n// CALLABLE — createMatch";

assert.equal(source.split(startMarker).length - 1, 1);

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.ok(end > start);

const functionSource = source.slice(start, end);

// Tester le véritable corps de la fonction interne,
// sans charger les Firebase Functions de production.
function setup({
  recipients = ["player_a", "player_b"],
  allowed = async () => true,
  tokens = async uid => [`token_${uid}`],
  matchExists = true,
} = {}) {
  const preferenceChecks = [];
  const tokenRequests = [];
  const sends = [];
  const warnings = [];

  const dependencies = {
    db: {
      collection(name) {
        assert.equal(name, "matches");
        return {
          doc(id) {
            assert.equal(id, "match_1");
            return {
              async get() {
                return {
                  exists: matchExists,
                  data: () => ({
                    lieu: "Club Padel",
                    dateHeure: Date.now() + 3600000,
                  }),
                };
              },
            };
          },
        };
      },
    },
    asString: value => String(value ?? ""),
    toMillis: value => value,
    findEligibleRecipients: async () => recipients,
    frTime: () => "19:00",
    tokensOf: async uid => {
      tokenRequests.push(uid);
      return tokens(uid);
    },
    copyFor: () => ({
      title: "Un match près de toi",
      body: "Une nouvelle partie",
    }),
    send: async (recipientTokens, payload) => {
      sends.push({ recipientTokens, payload });
    },
    isNotificationPushAllowedV2: async input => {
      preferenceChecks.push(input);
      return allowed(input);
    },
    logger: {
      warn: (...args) => warnings.push(args),
    },
  };

  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);

  const make = new Function(
    ...names,
    `"use strict";\n${functionSource}\nreturn pushNearbyForMatchId;`
  );

  const notify = make(...values);

  return {
    run: () => notify("match_1"),
    preferenceChecks,
    tokenRequests,
    sends,
    warnings,
  };
}

test("V2 : notifications autorisées pour deux joueurs", async () => {
  const app = setup();

  await app.run();

  assert.deepEqual(
    app.preferenceChecks.map(item => item.uid),
    ["player_a", "player_b"]
  );

  for (const item of app.preferenceChecks) {
    assert.equal(item.category, "discovery");
    assert.equal(item.event, "nearbyMatch");
  }

  assert.deepEqual(
    app.tokenRequests,
    ["player_a", "player_b"]
  );

  assert.equal(app.sends.length, 2);

  for (const send of app.sends) {
    assert.equal(send.payload.data.type, "match");
    assert.equal(send.payload.data.subtype, "new");
    assert.equal(send.payload.data.matchId, "match_1");
  }
});

test("V2 : préférence désactivée avant tokensOf", async () => {
  const app = setup({
    allowed: async ({ uid }) => uid !== "player_b",
  });

  await app.run();

  assert.deepEqual(app.tokenRequests, ["player_a"]);
  assert.equal(app.sends.length, 1);
  assert.deepEqual(app.warnings, []);
});

test("V2 : erreur Firestore d'un joueur isolée", async () => {
  const app = setup({
    allowed: async ({ uid }) => {
      if (uid === "player_a") {
        throw new Error("FIRESTORE_UNAVAILABLE");
      }
      return true;
    },
  });

  await app.run();

  assert.deepEqual(app.tokenRequests, ["player_b"]);
  assert.equal(app.sends.length, 1);
  assert.equal(app.warnings.length, 1);
});

test("V2 : aucun destinataire = aucun accès aux préférences", async () => {
  const app = setup({ recipients: [] });

  await app.run();

  assert.deepEqual(app.preferenceChecks, []);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
});

test("V2 : match inexistant = aucun envoi", async () => {
  const app = setup({ matchExists: false });

  await app.run();

  assert.deepEqual(app.preferenceChecks, []);
  assert.deepEqual(app.sends, []);
});
