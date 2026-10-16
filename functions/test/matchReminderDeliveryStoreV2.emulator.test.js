import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
} from "firebase-admin/firestore";

import {
  buildMatchReminderDeliveryStoreV2,
} from "../domain/notifications/MatchReminderDeliveryStoreV2.js";

const PROJECT = "demo-padima-notifications-v2";

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  !process.env.FIRESTORE_EMULATOR_HOST
) {
  throw new Error("STOP : émulateur isolé obligatoire");
}

const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);

const base = {
  matchId: "emulator_" + randomUUID(),
  uid: "player_test",
  reminderType: "1h",
  dateHeure: 1800000000000,
};

let clock = 1800000000000;

let claimCounter = 0;

const store = buildMatchReminderDeliveryStoreV2({
  db,
  FieldValue,
  now: () => clock,
  newClaimId: () => "claim_" + (++claimCounter),
});

function identity(suffix, overrides = {}) {
  return {
    ...base,
    matchId: base.matchId + "_" + suffix,
    ...overrides,
  };
}

function document(id) {
  return db.collection("matchReminderDeliveriesV2").doc(id);
}

test("13X : concurrence, un seul claim gagnant", async () => {
  const input = identity("concurrent");

  const [a, b] = await Promise.all([
    store.claim(input),
    store.claim(input),
  ]);

  assert.equal(
    [a.acquired, b.acquired].filter(Boolean).length,
    1
  );

  const winner = a.acquired ? a : b;
  const snap = await document(winner.id).get();

  assert.equal(snap.data().status, "sending");
  assert.equal(snap.data().attempts, 1);
});

test("13X : confirmation empêche un nouvel envoi", async () => {
  const input = identity("sent");
  const first = await store.claim(input);

  assert.equal(first.acquired, true);

  assert.equal(await store.markSent(first), true);

  const again = await store.claim(input);

  assert.equal(again.acquired, false);
  assert.equal(again.reason, "already_sent");

  const snap = await document(first.id).get();

  assert.equal(snap.data().status, "sent");
  assert.equal(snap.data().attempts, 1);
});

test("13X : échec libère la réservation", async () => {
  const input = identity("release");
  const first = await store.claim(input);

  assert.equal(
    await store.release({
      ...first,
      error: new Error("FCM_REJECTED"),
    }),
    true
  );

  const failed = await document(first.id).get();
  assert.equal(failed.data().status, "failed");

  const second = await store.claim(input);

  assert.equal(second.acquired, true);
  assert.equal(second.id, first.id);
  assert.notEqual(second.claimId, first.claimId);

  const snap = await document(first.id).get();

  assert.equal(snap.data().attempts, 2);
});

test("13X : réservation active bloque le doublon", async () => {
  const input = identity("active");
  const first = await store.claim(input);

  const second = await store.claim(input);

  assert.equal(second.acquired, false);
  assert.equal(second.reason, "in_progress");

  const snap = await document(first.id).get();

  assert.equal(snap.data().attempts, 1);
});

test("13X : expiration et protection contre l'ancien claim", async () => {
  const input = identity("expired");

  clock = 1800001000000;
  const first = await store.claim(input);

  clock += 300001;
  const second = await store.claim(input);

  assert.equal(second.acquired, true);
  assert.notEqual(second.claimId, first.claimId);

  assert.equal(await store.markSent(first), false);

  assert.equal(
    await store.release({
      ...first,
      error: "ancien worker",
    }),
    false
  );

  assert.equal(await store.markSent(second), true);

  const snap = await document(second.id).get();

  assert.equal(snap.data().status, "sent");
  assert.equal(snap.data().attempts, 2);
});

test("13X : H-1 et H-24 restent distincts", async () => {
  const input = identity("types");

  const h1 = await store.claim(input);
  const h24 = await store.claim({
    ...input,
    reminderType: "24h",
  });

  assert.equal(h1.acquired, true);
  assert.equal(h24.acquired, true);
  assert.notEqual(h1.id, h24.id);
});

test("13X : reprogrammation crée une nouvelle identité", async () => {
  const input = identity("rescheduled");

  const oldDate = await store.claim(input);

  assert.equal(await store.markSent(oldDate), true);

  const newDate = await store.claim({
    ...input,
    dateHeure: input.dateHeure + 3600000,
  });

  assert.equal(newDate.acquired, true);
  assert.notEqual(oldDate.id, newDate.id);
});

test.after(async () => {
  await deleteApp(app);
});
