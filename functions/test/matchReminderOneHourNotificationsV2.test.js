import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMatchReminderSenderV2,
} from "../domain/notifications/MatchReminderSenderV2.js";
import {
  buildMatchReminderConfirmationV2,
} from "../domain/notifications/MatchReminderConfirmationV2.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(
  new URL("../index.js", import.meta.url)
);

const source = readFileSync(path, "utf8");
const startMarker =
  "export const notifyOneHourBeforeMatchCron = onSchedule(";
const endMarker = "// CRON — REMINDERS (24h)";

assert.equal(source.split(startMarker).length - 1, 1);
assert.equal(source.split(endMarker).length - 1, 1);

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.ok(end > start);

const block = source.slice(start, end).replace(
  "export const notifyOneHourBeforeMatchCron =",
  "const notifyOneHourBeforeMatchCron ="
);

function setup({
  participants = ["player_a", "player_b"],
  allowed = async () => true,
  tokens = async uid => [`token_${uid}`],
  matches = true,
  sendFailsOnce = false,
  realFcmResponses = null,
  confirmationFailures = 0,
} = {}) {
  const checks = [];
  const tokenRequests = [];
  const sends = [];
  const fcmRequests = [];
  const warnings = [];
  const queries = [];

  // Même horaire Firestore aux passages successifs.
  const matchDateHeure = Date.now() + 3600000;
  const deliveryState = new Map();
  const deliveryClaims = [];
  let nextClaim = 0;
  let remainingSendFailures = sendFailsOnce ? 1 : 0;
  let remainingConfirmationFailures = confirmationFailures;
  const confirmationAttempts = [];

  const dependencies = {
    onSchedule: (options, handler) => {
      assert.equal(options.schedule, "every 5 minutes");
      assert.equal(options.timeZone, "Europe/Paris");
      return handler;
    },
    RUNTIME_SCHEDULE: {},
    db: {
      collection(name) {
        assert.equal(name, "matches");
        return {
          where(field, op, value) {
            queries.push({ field, op, value });
            return this;
          },
          async get() {
            const docs = matches ? [{
              id: "match_1",
              data: () => ({
                participants,
                lieu: "Club Padel",
                dateHeure: matchDateHeure,
              }),
            }] : [];

            return { size: docs.length, docs };
          },
        };
      },
    },
    cleanUids: values => values ?? [],
    asString: value => String(value ?? ""),
    normalizeDateMs: value => value,
    frTime: () => "19:00",
    copyFor: () => ({
      title: "Ton match approche",
      body: "Début dans une heure",
    }),
    isNotificationPushAllowedV2: async input => {
      checks.push(input);
      return allowed(input);
    },
    matchReminderDeliveryStoreV2: {
      async claim(input) {
        deliveryClaims.push(input);
        const id = JSON.stringify([
          input.matchId,
          input.uid,
          input.reminderType,
          input.dateHeure,
        ]);
        if (deliveryState.has(id)) {
          return {
            acquired: false,
            reason: "already_sent",
            id,
          };
        }
        const claimId = `claim_${++nextClaim}`;
        deliveryState.set(id, {
          status: "sending",
          claimId,
        });
        return { acquired: true, id, claimId };
      },
      async markSent({ id, claimId }) {
        confirmationAttempts.push({ id, claimId });

        if (remainingConfirmationFailures > 0) {
          remainingConfirmationFailures--;
          throw new Error("FIRESTORE_UNAVAILABLE");
        }

        const current = deliveryState.get(id);
        if (
          current?.status !== "sending"
          || current.claimId !== claimId
        ) {
          return false;
        }
        deliveryState.set(id, { status: "sent", claimId });
        return true;
      },
      async release({ id, claimId }) {
        const current = deliveryState.get(id);
        if (
          current?.status !== "sending"
          || current.claimId !== claimId
        ) {
          return false;
        }
        deliveryState.delete(id);
        return true;
      },
    },
    tokensOf: async uid => {
      tokenRequests.push(uid);
      return tokens(uid);
    },
    send: async (recipientTokens, payload) => {
      if (remainingSendFailures > 0) {
        remainingSendFailures--;
        throw new Error("FCM_UNAVAILABLE");
      }
      sends.push({ recipientTokens, payload });
    },
    logger: {
      info() {},
      warn: (...args) => warnings.push(args),
    },
  };

  if (realFcmResponses !== null) {
    const remainingResponses = [...realFcmResponses];

    dependencies.matchReminderSenderV2 =
      buildMatchReminderSenderV2({
        messaging: {
          async sendEachForMulticast(message) {
            fcmRequests.push(message);

            if (remainingResponses.length === 0) {
              throw new Error("UNEXPECTED_FCM_CALL");
            }

            return {
              responses: remainingResponses.shift(),
            };
          },
        },
        logger: dependencies.logger,
      });
  } else {
    dependencies.matchReminderSenderV2 = {
      sendReminder: (tokens, payload) =>
        dependencies.send(tokens, payload),
    };
  }

  dependencies.matchReminderConfirmationV2 =
    buildMatchReminderConfirmationV2({
      deliveryStore: dependencies.matchReminderDeliveryStoreV2,
      logger: dependencies.logger,
      sleep: async () => {},
    });

  const compile = new Function(
    ...Object.keys(dependencies),
    `"use strict";\n${block}\nreturn notifyOneHourBeforeMatchCron;`
  );

  return {
    run: compile(...Object.values(dependencies)),
    checks,
    tokenRequests,
    sends,
    fcmRequests,
    warnings,
    queries,
    deliveryState,
    deliveryClaims,
    confirmationAttempts,
  };
}

test("V2 H-1 : deux participants autorisés", async () => {
  const app = setup();
  await app.run();

  assert.equal(app.queries.length, 2);
  assert.deepEqual(
    app.checks.map(item => item.uid),
    ["player_a", "player_b"]
  );

  for (const check of app.checks) {
    assert.equal(check.category, "matches");
    assert.equal(check.event, "matchReminder");
  }

  assert.deepEqual(
    app.tokenRequests,
    ["player_a", "player_b"]
  );
  assert.equal(app.sends.length, 2);

  for (const sent of app.sends) {
    assert.equal(sent.payload.data.type, "match");
    assert.equal(sent.payload.data.subtype, "reminder_1h");
    assert.equal(sent.payload.data.matchId, "match_1");
  }
});

test("V2 H-1 : préférence désactivée avant tokensOf", async () => {
  const app = setup({
    allowed: async ({ uid }) => uid !== "player_b",
  });

  await app.run();

  assert.equal(app.checks.length, 2);
  assert.deepEqual(app.tokenRequests, ["player_a"]);
  assert.equal(app.sends.length, 1);
  assert.equal(app.warnings.length, 0);
});

test("V2 H-1 : erreur de préférence isolée", async () => {
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

test("V2 H-1 : aucun participant = aucun push", async () => {
  const app = setup({ participants: [] });
  await app.run();

  assert.deepEqual(app.checks, []);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
});

test("V2 H-1 : aucun token = aucun push", async () => {
  const app = setup({
    tokens: async () => [],
  });

  await app.run();

  assert.equal(app.checks.length, 2);
  assert.equal(app.tokenRequests.length, 2);
  assert.deepEqual(app.sends, []);
});

test("V2 H-1 : aucun match = aucun push", async () => {
  const app = setup({ matches: false });
  await app.run();

  assert.deepEqual(app.checks, []);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
});


test("13L : seconde exécution H-1 sans doublon", async () => {
  const app = setup();

  await app.run();
  await app.run();

  assert.equal(app.sends.length, 2);
  assert.equal(app.deliveryClaims.length, 4);
  assert.equal(app.deliveryState.size, 2);

  for (const record of app.deliveryState.values()) {
    assert.equal(record.status, "sent");
  }
});

test("13L : échec FCM puis reprise au passage suivant", async () => {
  const app = setup({
    participants: ["player_a"],
    sendFailsOnce: true,
  });

  await app.run();

  assert.equal(app.sends.length, 0);
  assert.equal(app.warnings.length, 1);
  assert.equal(app.deliveryState.size, 0);

  await app.run();

  assert.equal(app.sends.length, 1);
  assert.equal(app.deliveryClaims.length, 2);
  assert.equal(app.deliveryState.size, 1);
});

test("13L : une préférence coupée ne réserve aucun envoi", async () => {
  const app = setup({
    allowed: async ({ uid }) => uid !== "player_b",
  });

  await app.run();
  await app.run();

  assert.deepEqual(
    app.deliveryClaims.map(item => item.uid),
    ["player_a", "player_a"]
  );
  assert.equal(app.sends.length, 1);
  assert.equal(app.deliveryState.size, 1);
});

test("13L : chaque participant possède sa propre livraison", async () => {
  const app = setup();

  await app.run();

  assert.equal(app.deliveryState.size, 2);
  assert.equal(app.deliveryClaims.length, 2);

  const identities = app.deliveryClaims.map(item =>
    `${item.matchId}/${item.uid}/${item.reminderType}`
  );

  assert.equal(new Set(identities).size, 2);
});


test("13S : FCM refuse tous les tokens, puis reprise", async () => {
  const app = setup({
    participants: ["player_a"],
    realFcmResponses: [
      [{ success: false, error: { code: "unavailable" } }],
      [{ success: true, messageId: "fcm_accepted" }],
    ],
  });

  await app.run();

  assert.equal(app.fcmRequests.length, 1);
  assert.equal(app.deliveryClaims.length, 1);
  assert.equal(app.deliveryState.size, 0);

  // Deux avertissements distincts :
  // 1. échec FCM ; 2. échec du destinataire dans le cron.
  assert.equal(app.warnings.length, 2);
  assert.match(
    String(app.warnings[0][0]),
    /match reminder multicast partial failure/
  );
  assert.match(
    String(app.warnings[1][0]),
    /cron H-1 recipient failed/
  );

  await app.run();

  assert.equal(app.fcmRequests.length, 2);
  assert.equal(app.deliveryClaims.length, 2);
  assert.equal(app.deliveryState.size, 1);

  const record = [...app.deliveryState.values()][0];
  assert.equal(record.status, "sent");

  await app.run();

  assert.equal(app.fcmRequests.length, 2);
  assert.equal(app.deliveryClaims.length, 3);
});

test("13S : succès FCM partiel confirme le rappel", async () => {
  const app = setup({
    participants: ["player_a"],
    tokens: async () => ["token_a1", "token_a2"],
    realFcmResponses: [
      [
        { success: true, messageId: "accepted_1" },
        { success: false, error: { code: "unavailable" } },
      ],
    ],
  });

  await app.run();

  assert.equal(app.fcmRequests.length, 1);
  assert.deepEqual(
    app.fcmRequests[0].tokens,
    ["token_a1", "token_a2"]
  );

  assert.equal(app.deliveryState.size, 1);

  const record = [...app.deliveryState.values()][0];
  assert.equal(record.status, "sent");

  await app.run();

  assert.equal(app.fcmRequests.length, 1);
});


test("13AB-2 : H-1 confirme après deux erreurs sans renvoyer FCM", async () => {
  const app = setup({
    participants: ["player_a"],
    confirmationFailures: 2,
  });

  await app.run();

  assert.equal(app.sends.length, 1);
  assert.equal(app.confirmationAttempts.length, 3);
  assert.equal(app.deliveryState.size, 1);
  assert.equal(
    [...app.deliveryState.values()][0].status,
    "sent"
  );

  await app.run();

  assert.equal(app.sends.length, 1);
  assert.equal(app.confirmationAttempts.length, 3);
});

test("13AB-2 : H-1 conserve le bail après trois erreurs de confirmation", async () => {
  const app = setup({
    participants: ["player_a"],
    confirmationFailures: 3,
  });

  await app.run();

  assert.equal(app.sends.length, 1);
  assert.equal(app.confirmationAttempts.length, 3);

  assert.equal(
    [...app.deliveryState.values()][0].status,
    "sending"
  );

  assert.ok(
    app.warnings.some(entry =>
      String(entry[0]).includes("cron H-1 recipient failed")
    )
  );

  // Le bail encore actif bloque un second envoi.
  await app.run();

  assert.equal(app.sends.length, 1);
});
