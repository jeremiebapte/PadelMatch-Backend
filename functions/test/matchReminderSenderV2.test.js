import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchReminderSenderV2,
  MatchReminderSendError,
} from "../domain/notifications/MatchReminderSenderV2.js";

const COPY = {
  title: "Ton match approche",
  body: "Rappel de ton match",
  data: {
    type: "match",
    subtype: "reminder_1h",
    matchId: "match_1",
    count: 2,
  },
};

function environment({
  responses,
  sendError,
  cleanupError,
} = {}) {
  const requests = [];
  const cleanups = [];
  const warnings = [];

  const messaging = {
    async sendEachForMulticast(payload) {
      requests.push(payload);

      if (sendError) {
        throw sendError;
      }

      return {
        responses: responses ?? [
          { success: true },
          { success: true },
        ],
      };
    },
  };

  const sender = buildMatchReminderSenderV2({
    messaging,
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
    async cleanupInvalidTokensFromResponse(
      tokens,
      response,
      context
    ) {
      cleanups.push({ tokens, response, context });

      if (cleanupError) {
        throw cleanupError;
      }
    },
  });

  return {
    sender,
    requests,
    cleanups,
    warnings,
  };
}

test("13P : deux tokens acceptés par FCM", async () => {
  const env = environment();

  const result = await env.sender.sendReminder(
    ["token_a", "token_b"],
    COPY
  );

  assert.equal(result.accepted, true);
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 0);
  assert.equal(env.cleanups.length, 0);
  assert.equal(env.requests.length, 1);
});

test("13P : format iOS Android et data conservés", async () => {
  const env = environment();

  await env.sender.sendReminder(
    ["token_a", "token_b"],
    COPY
  );

  const payload = env.requests[0];

  assert.equal(payload.android.priority, "high");
  assert.equal(
    payload.android.notification.channelId,
    "matches"
  );
  assert.equal(
    payload.apns.headers["apns-priority"],
    "10"
  );
  assert.equal(payload.data.count, "2");
  assert.equal(payload.data.subtype, "reminder_1h");
  assert.equal(payload.notification.title, COPY.title);
});

test("13P : succès partiel autorise confirmation", async () => {
  const env = environment({
    responses: [
      { success: true },
      { success: false, error: { code: "invalid-token" } },
    ],
  });

  const result = await env.sender.sendReminder(
    ["token_a", "token_b"],
    COPY
  );

  assert.equal(result.accepted, true);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(env.cleanups.length, 1);
});

test("13P : échec total interdit confirmation", async () => {
  const env = environment({
    responses: [
      { success: false },
      { success: false },
    ],
  });

  await assert.rejects(
    env.sender.sendReminder(
      ["token_a", "token_b"],
      COPY
    ),
    error =>
      error instanceof MatchReminderSendError
      && error.message === "REMINDER_FCM_ALL_TOKENS_FAILED"
  );

  assert.equal(env.cleanups.length, 1);
});

test("13P : exception FCM propagée", async () => {
  const env = environment({
    sendError: new Error("FCM_UNAVAILABLE"),
  });

  await assert.rejects(
    env.sender.sendReminder(
      ["token_a", "token_b"],
      COPY
    ),
    /FCM_UNAVAILABLE/
  );
});

test("13P : réponse FCM incohérente rejetée", async () => {
  const env = environment({
    responses: [{ success: true }],
  });

  await assert.rejects(
    env.sender.sendReminder(
      ["token_a", "token_b"],
      COPY
    ),
    /REMINDER_INVALID_FCM_RESPONSE/
  );
});

test("13P : aucun token interdit envoi", async () => {
  const env = environment();

  await assert.rejects(
    env.sender.sendReminder([], COPY),
    /REMINDER_NO_VALID_TOKENS/
  );

  assert.equal(env.requests.length, 0);
});

test("13P : erreur de nettoyage ne masque pas succès partiel", async () => {
  const env = environment({
    responses: [
      { success: true },
      { success: false },
    ],
    cleanupError: new Error("CLEANUP_FAILED"),
  });

  const result = await env.sender.sendReminder(
    ["token_a", "token_b"],
    COPY
  );

  assert.equal(result.accepted, true);
  assert.equal(result.successCount, 1);
  assert.equal(env.warnings.length, 2);
});
