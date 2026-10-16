import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(
  new URL("../index.js", import.meta.url)
);

const source = readFileSync(indexPath, "utf8");

const startMarker = "    if (becameOnePlayerAway) {";
const endMarker = "\n    await Promise.all(ops);";

assert.equal(source.split(startMarker).length - 1, 1);

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.ok(end > start);

const block = source.slice(start, end);

assert.ok(block.includes('event: "matchAlmostFull"'));

const AsyncFunction =
  Object.getPrototypeOf(async function () {}).constructor;

function setup({
  recipients = ["player_a", "player_b"],
  allowed = async () => true,
  becameOnePlayerAway = true,
  tokens = async uid => [`token_${uid}`],
} = {}) {
  const preferenceChecks = [];
  const tokenRequests = [];
  const sends = [];
  const warnings = [];
  const searches = [];
  const ops = [];

  const dependencies = {
    becameOnePlayerAway,
    findEligibleRecipients: async (match, options) => {
      searches.push({ match, options });
      return recipients;
    },
    m: {
      dateHeure: Date.now() + 3600000,
    },
    isNotificationPushAllowedV2: async input => {
      preferenceChecks.push(input);
      return allowed(input);
    },
    tokensOf: async uid => {
      tokenRequests.push(uid);
      return tokens(uid);
    },
    copyFor: () => ({
      title: "Plus qu'un joueur",
      body: "Un match cherche son quatrième joueur",
    }),
    toMillis: value => value,
    frTime: () => "19:00",
    lieu: "Club Padel",
    matchId: "match_1",
    ops,
    send: async (recipientTokens, payload) => {
      sends.push({ recipientTokens, payload });
    },
    logger: {
      warn: (...args) => warnings.push(args),
    },
  };

  const execute = new AsyncFunction(
    ...Object.keys(dependencies),
    `"use strict";\n${block}`
  );

  return {
    run: async () => {
      await execute(...Object.values(dependencies));
      await Promise.all(ops);
    },
    preferenceChecks,
    tokenRequests,
    sends,
    warnings,
    searches,
  };
}

test("V2 : alerte autorisée pour deux joueurs", async () => {
  const app = setup();

  await app.run();

  assert.equal(app.searches.length, 1);
  assert.deepEqual(
    app.searches[0].options,
    { maxHoursAhead: 12 }
  );

  assert.deepEqual(
    app.preferenceChecks.map(item => item.uid),
    ["player_a", "player_b"]
  );

  for (const check of app.preferenceChecks) {
    assert.equal(check.category, "discovery");
    assert.equal(check.event, "matchAlmostFull");
  }

  assert.deepEqual(
    app.tokenRequests,
    ["player_a", "player_b"]
  );
  assert.equal(app.sends.length, 2);

  for (const sent of app.sends) {
    assert.equal(
      sent.payload.data.type,
      "nearby_match_urgent"
    );
    assert.equal(sent.payload.data.urgency, "plus_one");
    assert.equal(sent.payload.data.matchId, "match_1");
  }
});

test("V2 : préférence désactivée avant tokensOf", async () => {
  const app = setup({
    allowed: async ({ uid }) => uid !== "player_b",
  });

  await app.run();

  assert.equal(app.preferenceChecks.length, 2);
  assert.deepEqual(app.tokenRequests, ["player_a"]);
  assert.equal(app.sends.length, 1);
  assert.equal(app.warnings.length, 0);
});

test("V2 : erreur Firestore isolée par joueur", async () => {
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

test("V2 : aucun destinataire = aucun push", async () => {
  const app = setup({ recipients: [] });

  await app.run();

  assert.equal(app.searches.length, 1);
  assert.deepEqual(app.preferenceChecks, []);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
});

test("V2 : pas de transition à 3 joueurs = aucune alerte", async () => {
  const app = setup({
    becameOnePlayerAway: false,
  });

  await app.run();

  assert.deepEqual(app.searches, []);
  assert.deepEqual(app.preferenceChecks, []);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
});
