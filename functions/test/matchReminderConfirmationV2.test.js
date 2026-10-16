import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchReminderConfirmationV2,
} from "../domain/notifications/MatchReminderConfirmationV2.js";

const DELIVERY = {
  id: "delivery_test",
  claimId: "claim_test",
};

function environment(outcomes) {
  const calls = [];
  const delays = [];
  const warnings = [];
  const remaining = [...outcomes];

  const confirmation = buildMatchReminderConfirmationV2({
    deliveryStore: {
      async markSent(delivery) {
        calls.push(delivery);

        if (!remaining.length) {
          throw new Error("UNEXPECTED_CONFIRMATION");
        }

        const outcome = remaining.shift();

        if (outcome instanceof Error) {
          throw outcome;
        }

        return outcome;
      },
    },
    sleep: async ms => {
      delays.push(ms);
    },
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
  });

  return { confirmation, calls, delays, warnings };
}

test("13AB : confirmation immédiate", async () => {
  const env = environment([true]);

  assert.equal(
    await env.confirmation.confirm(DELIVERY),
    true
  );
  assert.equal(env.calls.length, 1);
  assert.equal(env.delays.length, 0);
});

test("13AB : erreur temporaire puis confirmation", async () => {
  const env = environment([
    new Error("FIRESTORE_UNAVAILABLE"),
    true,
  ]);

  assert.equal(
    await env.confirmation.confirm(DELIVERY),
    true
  );
  assert.equal(env.calls.length, 2);
  assert.deepEqual(env.delays, [200]);
  assert.equal(env.warnings.length, 1);
});

test("13AB : deux erreurs puis succès", async () => {
  const env = environment([
    new Error("FAIL_1"),
    new Error("FAIL_2"),
    true,
  ]);

  assert.equal(
    await env.confirmation.confirm(DELIVERY),
    true
  );
  assert.equal(env.calls.length, 3);
  assert.deepEqual(env.delays, [200, 200]);
});

test("13AB : false arrête immédiatement", async () => {
  const env = environment([false]);

  assert.equal(
    await env.confirmation.confirm(DELIVERY),
    false
  );
  assert.equal(env.calls.length, 1);
  assert.equal(env.delays.length, 0);
});

test("13AB : trois erreurs remontent au cron", async () => {
  const env = environment([
    new Error("FAIL_1"),
    new Error("FAIL_2"),
    new Error("FAIL_3"),
  ]);

  await assert.rejects(
    env.confirmation.confirm(DELIVERY),
    /FAIL_3/
  );

  assert.equal(env.calls.length, 3);
  assert.deepEqual(env.delays, [200, 200]);
});

test("13AB : la confirmation ne renvoie jamais FCM", async () => {
  let fcmSends = 0;

  const confirmation = buildMatchReminderConfirmationV2({
    deliveryStore: {
      async markSent() {
        throw new Error("FIRESTORE_UNAVAILABLE");
      },
    },
    sleep: async () => {},
  });

  await assert.rejects(
    confirmation.confirm(DELIVERY),
    /FIRESTORE_UNAVAILABLE/
  );

  assert.equal(fcmSends, 0);
});

test("13AB : réservation invalide refusée", async () => {
  const env = environment([true]);

  await assert.rejects(
    env.confirmation.confirm({ id: "delivery_test" }),
    /delivery invalide/
  );

  assert.equal(env.calls.length, 0);
});
