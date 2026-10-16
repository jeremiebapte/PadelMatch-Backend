import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildMatchReminderCleanupBatchV2,
} from "../domain/notifications/MatchReminderCleanupBatchV2.js";

import {
  buildMatchReminderCleanupStoreV2,
} from "../domain/notifications/MatchReminderCleanupStoreV2.js";

const PROJECT = "demo-padima-notifications-v2";
const HOSTS = ["127.0.0.1:8080", "localhost:8080"];

if (
  process.env.GCLOUD_PROJECT !== PROJECT
  || !HOSTS.includes(process.env.FIRESTORE_EMULATOR_HOST)
) {
  throw new Error("STOP : émulateur local obligatoire");
}

const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);

const NOW = 2000000000000;
const DAY = 86400000;
const collection = db.collection("matchReminderDeliveriesV2");

const cleanupStore = buildMatchReminderCleanupStoreV2({
  db,
  now: () => NOW,
});

const batch = buildMatchReminderCleanupBatchV2({
  db,
  cleanupStore,
  now: () => NOW,
});

// Préfixe d'identité aléatoire dans les ID,
// tout en respectant le format SHA-256.
function id() {
  return randomUUID().replaceAll("-", "")
    + randomUUID().replaceAll("-", "");
}

async function createRecord(status, scheduledAt, extras = {}) {
  const documentId = id();
  const ref = collection.doc(documentId);

  await ref.set({
    matchId: `match_${documentId}`,
    uid: "player_test",
    reminderType: "1h",
    scheduledAt,
    status,
    claimId: `claim_${documentId}`,
    claimedAtMs: NOW - 8 * DAY,
    ...extras,
  });

  return ref;
}

// Les tests utilisent chacun une bande de dates
// isolée pour éviter toute interférence.
const testDay = i => NOW - (20 + i) * DAY;

test("13AK : sélection et suppression bornées", async () => {
  const refs = [
    await createRecord("failed", testDay(1)),
    await createRecord("sending", testDay(2)),
  ];

  const result = await batch.runBatch({ scanLimit: 100 });

  assert.ok(result.scanned >= 2);
  assert.equal(result.failed, 0);

  for (const ref of refs) {
    assert.equal((await ref.get()).exists, false);
  }
});

test("13AK : sent et documents récents conservés", async () => {
  const sent = await createRecord("sent", testDay(3));
  const recent = await createRecord(
    "failed",
    NOW - 2 * DAY
  );

  await batch.runBatch({ scanLimit: 100 });

  assert.equal((await sent.get()).exists, true);
  assert.equal((await recent.get()).exists, true);
});

test("13AK : pagination avec dates identiques", async () => {
  const timestamp = testDay(4);
  const refs = [
    await createRecord("failed", timestamp),
    await createRecord("failed", timestamp),
    await createRecord("failed", timestamp),
  ];

  let cursor = null;
  let pages = 0;
  let removed = 0;

  do {
    const result = await batch.runBatch({
      scanLimit: 2,
      cursor,
    });

    removed += result.deleted;
    cursor = result.cursor;
    pages++;

    assert.ok(result.scanned <= 2);
    assert.ok(pages <= 100);
  } while (cursor);

  assert.ok(pages >= 2);
  assert.ok(removed >= 3);

  for (const ref of refs) {
    assert.equal((await ref.get()).exists, false);
  }
});

test("13AK : aucune suppression de bail actif", async () => {
  const active = await createRecord(
    "sending",
    testDay(5),
    { claimedAtMs: NOW - 60000 }
  );

  const result = await batch.runBatch({ scanLimit: 100 });

  assert.equal(result.failed, 0);
  assert.equal((await active.get()).exists, true);
});

test("13AK : limites invalides refusées", async () => {
  await assert.rejects(
    batch.runBatch({ scanLimit: 0 }),
    /scanLimit invalide/
  );

  await assert.rejects(
    batch.runBatch({ scanLimit: 101 }),
    /scanLimit invalide/
  );

  await assert.rejects(
    batch.runBatch({
      cursor: { scheduledAt: NOW, id: "../users" },
    }),
    /cursor invalide/
  );
});

after(async () => {
  await deleteApp(app);
});
