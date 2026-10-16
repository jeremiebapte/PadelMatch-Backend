import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchReminderDeliveryStoreV2,
} from "../domain/notifications/MatchReminderDeliveryStoreV2.js";

const BASE = {
  matchId: "match_123",
  uid: "player_123",
  reminderType: "1h",
  dateHeure: 1800000000000,
};

function environment() {
  const documents = new Map();
  let clock = 1000000;
  let nextClaim = 0;

  // Sérialise les transactions pour simuler l'atomicité
  // Firestore, y compris avec deux appels concurrents.
  let transactionQueue = Promise.resolve();

  function reference(path) {
    return { path };
  }

  function snapshot(ref) {
    const data = documents.get(ref.path);

    return {
      exists: data !== undefined,
      data: () => data,
    };
  }

  const db = {
    collection(name) {
      assert.equal(name, "matchReminderDeliveriesV2");

      return {
        doc(id) {
          return reference(`${name}/${id}`);
        },
      };
    },

    runTransaction(callback) {
      const execute = async () => {
        const staged = [];

        const tx = {
          async get(ref) {
            return snapshot(ref);
          },

          set(ref, data, options = {}) {
            staged.push({ ref, data, options });
          },
        };

        const result = await callback(tx);

        for (const write of staged) {
          const previous =
            documents.get(write.ref.path) || {};

          documents.set(
            write.ref.path,
            write.options.merge
              ? { ...previous, ...write.data }
              : write.data
          );
        }

        return result;
      };

      const result = transactionQueue.then(execute);

      transactionQueue = result.then(
        () => undefined,
        () => undefined
      );

      return result;
    },
  };

  const store = buildMatchReminderDeliveryStoreV2({
    db,
    FieldValue: {
      serverTimestamp: () => "SERVER_TIMESTAMP",
    },
    now: () => clock,
    newClaimId: () => `claim_${++nextClaim}`,
  });

  return {
    store,
    documents,
    advance(ms) {
      clock += ms;
    },
    record(id) {
      return documents.get(
        `matchReminderDeliveriesV2/${id}`
      );
    },
  };
}

test("13J : première réservation autorisée", async () => {
  const env = environment();

  const result = await env.store.claim(BASE);

  assert.equal(result.acquired, true);
  assert.ok(result.id);
  assert.equal(result.claimId, "claim_1");

  const record = env.record(result.id);

  assert.equal(record.status, "sending");
  assert.equal(record.matchId, BASE.matchId);
  assert.equal(record.uid, BASE.uid);
  assert.equal(record.reminderType, "1h");
  assert.equal(record.scheduledAt, BASE.dateHeure);
  assert.equal(record.attempts, 1);
});

test("13J : deux réservations simultanées, une seule gagnante", async () => {
  const env = environment();

  const [first, second] = await Promise.all([
    env.store.claim(BASE),
    env.store.claim(BASE),
  ]);

  assert.equal(
    [first, second].filter(item => item.acquired).length,
    1
  );

  assert.equal(
    [first, second].filter(
      item => item.reason === "in_progress"
    ).length,
    1
  );
});

test("13J : une réservation active bloque les doublons", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);
  env.advance(4 * 60 * 1000);

  const second = await env.store.claim(BASE);

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "in_progress");
});

test("13J : confirmation empêche définitivement le doublon", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  assert.equal(
    await env.store.markSent(first),
    true
  );

  assert.equal(env.record(first.id).status, "sent");

  const second = await env.store.claim(BASE);

  assert.equal(second.acquired, false);
  assert.equal(second.reason, "already_sent");
});

test("13J : un échec libère la réservation", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  assert.equal(
    await env.store.release({
      ...first,
      error: new Error("FCM_UNAVAILABLE"),
    }),
    true
  );

  assert.equal(env.record(first.id).status, "failed");
  assert.equal(
    env.record(first.id).lastError,
    "FCM_UNAVAILABLE"
  );

  const retry = await env.store.claim(BASE);

  assert.equal(retry.acquired, true);
  assert.equal(env.record(retry.id).attempts, 2);
});

test("13J : réservation expirée récupérable après cinq minutes", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  env.advance(5 * 60 * 1000);

  const second = await env.store.claim(BASE);

  assert.equal(second.acquired, true);
  assert.equal(second.id, first.id);
  assert.notEqual(second.claimId, first.claimId);
  assert.equal(env.record(second.id).attempts, 2);
});

test("13J : ancienne réservation ne peut confirmer la nouvelle", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  env.advance(5 * 60 * 1000);

  const second = await env.store.claim(BASE);

  assert.equal(
    await env.store.markSent(first),
    false
  );

  assert.equal(env.record(second.id).status, "sending");
  assert.equal(
    env.record(second.id).claimId,
    second.claimId
  );

  assert.equal(
    await env.store.markSent(second),
    true
  );
});

test("13J : ancienne réservation ne peut libérer la nouvelle", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  env.advance(5 * 60 * 1000);

  const second = await env.store.claim(BASE);

  assert.equal(
    await env.store.release({
      ...first,
      error: "OLD_WORKER_FAILED",
    }),
    false
  );

  assert.equal(env.record(second.id).status, "sending");

  assert.equal(
    await env.store.release({
      ...second,
      error: "CURRENT_WORKER_FAILED",
    }),
    true
  );
});

test("13J : H-1 et H-24 ont des identités distinctes", async () => {
  const env = environment();

  const h1 = await env.store.claim(BASE);

  const h24 = await env.store.claim({
    ...BASE,
    reminderType: "24h",
  });

  assert.equal(h1.acquired, true);
  assert.equal(h24.acquired, true);
  assert.notEqual(h1.id, h24.id);
});

test("13J : match reprogrammé reçoit une nouvelle identité", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  await env.store.markSent(first);

  const rescheduled = await env.store.claim({
    ...BASE,
    dateHeure: BASE.dateHeure + 3600000,
  });

  assert.equal(rescheduled.acquired, true);
  assert.notEqual(first.id, rescheduled.id);
});

test("13J : joueurs différents ont des réservations distinctes", async () => {
  const env = environment();

  const first = await env.store.claim(BASE);

  const second = await env.store.claim({
    ...BASE,
    uid: "player_456",
  });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, true);
  assert.notEqual(first.id, second.id);
});

test("13J : saisies invalides rejetées", async () => {
  const env = environment();

  await assert.rejects(
    env.store.claim({
      ...BASE,
      reminderType: "12h",
    }),
    TypeError
  );

  await assert.rejects(
    env.store.claim({
      ...BASE,
      uid: "",
    }),
    TypeError
  );

  await assert.rejects(
    env.store.claim({
      ...BASE,
      dateHeure: 0,
    }),
    TypeError
  );
});


test("13AA : un rappel confirmé expire après 90 jours", async () => {
  const env = environment();
  const claim = await env.store.claim(BASE);

  assert.equal(await env.store.markSent(claim), true);

  const record = env.record(claim.id);
  assert.equal(record.status, "sent");
  assert.ok(record.expireAt instanceof Date);
  assert.equal(
    record.expireAt.getTime(),
    1000000 + 90 * 24 * 60 * 60 * 1000
  );
});

test("13AA : un rappel en cours n'a pas de TTL", async () => {
  const env = environment();
  const claim = await env.store.claim(BASE);

  assert.equal(env.record(claim.id).status, "sending");
  assert.equal(
    Object.hasOwn(env.record(claim.id), "expireAt"),
    false
  );
});

test("13AA : un échec récupérable n'a pas de TTL", async () => {
  const env = environment();
  const claim = await env.store.claim(BASE);

  assert.equal(
    await env.store.release({
      ...claim,
      error: new Error("FCM_UNAVAILABLE"),
    }),
    true
  );

  const record = env.record(claim.id);
  assert.equal(record.status, "failed");
  assert.equal(
    Object.hasOwn(record, "expireAt"),
    false
  );

  const retry = await env.store.claim(BASE);
  assert.equal(retry.acquired, true);
  assert.equal(
    Object.hasOwn(env.record(retry.id), "expireAt"),
    false
  );
});
