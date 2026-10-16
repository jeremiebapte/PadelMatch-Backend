import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";

import {
  buildMatchReminderDeliveryStoreV2,
} from "../domain/notifications/MatchReminderDeliveryStoreV2.js";

const PROJECT = "demo-padima-notifications-v2";
const host = process.env.FIRESTORE_EMULATOR_HOST;

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  !["127.0.0.1:8080", "localhost:8080"].includes(host)
) {
  throw new Error("STOP : émulateur local obligatoire");
}

const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);

const nowMs = Date.now();
const retentionMs = 90 * 24 * 60 * 60 * 1000;

let sequence = 0;

const store = buildMatchReminderDeliveryStoreV2({
  db,
  FieldValue,
  now: () => nowMs,
  newClaimId: () => `claim_${++sequence}_${randomUUID()}`,
});

const prefix = `ttl_13AD_${randomUUID()}`;

function input(label) {
  return {
    matchId: `${prefix}_${label}`,
    uid: "test_player",
    reminderType: "1h",
    dateHeure: nowMs + 3600000,
  };
}

async function read(claim) {
  const snapshot = await db
    .collection("matchReminderDeliveriesV2")
    .doc(claim.id)
    .get();

  assert.equal(snapshot.exists, true);
  return snapshot.data();
}

test("13AD : statut sent écrit un Timestamp expireAt à J+90", async () => {
  const claim = await store.claim(input("sent"));

  assert.equal(claim.acquired, true);
  assert.equal(await store.markSent(claim), true);

  const data = await read(claim);

  assert.equal(data.status, "sent");
  assert.ok(data.expireAt instanceof Timestamp);
  assert.equal(data.expireAt.toMillis(), nowMs + retentionMs);
  assert.ok(data.sentAt instanceof Timestamp);
});

test("13AD : statut sending sans expireAt", async () => {
  const claim = await store.claim(input("sending"));

  assert.equal(claim.acquired, true);

  const data = await read(claim);

  assert.equal(data.status, "sending");
  assert.equal(
    Object.prototype.hasOwnProperty.call(data, "expireAt"),
    false
  );
});

test("13AD : statut failed récupérable sans expireAt", async () => {
  const claim = await store.claim(input("failed"));

  assert.equal(claim.acquired, true);

  const released = await store.release({
    ...claim,
    error: new Error("FCM_UNAVAILABLE"),
  });

  assert.equal(released, true);

  const data = await read(claim);

  assert.equal(data.status, "failed");
  assert.equal(
    Object.prototype.hasOwnProperty.call(data, "expireAt"),
    false
  );

  const retry = await store.claim(input("failed"));
  assert.equal(retry.acquired, true);
});

after(async () => {
  await deleteApp(app);
});
