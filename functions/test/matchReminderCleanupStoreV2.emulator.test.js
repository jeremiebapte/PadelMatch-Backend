import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import {
  getFirestore,
} from "firebase-admin/firestore";

import {
  buildMatchReminderCleanupStoreV2,
} from "../domain/notifications/MatchReminderCleanupStoreV2.js";

const PROJECT = "demo-padima-notifications-v2";

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  !["127.0.0.1:8080", "localhost:8080"].includes(
    process.env.FIRESTORE_EMULATOR_HOST
  )
) {
  throw new Error("STOP : émulateur local obligatoire");
}

const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const NOW = 2000000000000;
const DAY = 86400000;

const cleanup = buildMatchReminderCleanupStoreV2({
  db,
  now: () => NOW,
});

const collection = db.collection("matchReminderDeliveriesV2");

async function createRecord(status, overrides = {}) {
  const id = randomUUID().replaceAll("-", "") +
    randomUUID().replaceAll("-", "");

  const ref = collection.doc(id);

  await ref.set({
    matchId: `match_${id}`,
    uid: "player_test",
    reminderType: "1h",
    scheduledAt: NOW - 8 * DAY,
    status,
    claimId: `claim_${id}`,
    claimedAtMs: NOW - 8 * DAY,
    ...overrides,
  });

  return ref;
}

test("13AI-2 : failed ancien supprimé", async () => {
  const ref = await createRecord("failed");

  assert.equal(
    (await cleanup.deleteIfStale(ref.id)).deleted,
    true
  );

  assert.equal((await ref.get()).exists, false);
});

test("13AI-2 : sending ancien supprimé", async () => {
  const ref = await createRecord("sending");

  assert.equal(
    (await cleanup.deleteIfStale(ref.id)).deleted,
    true
  );

  assert.equal((await ref.get()).exists, false);
});

test("13AI-2 : sent conservé pour TTL", async () => {
  const ref = await createRecord("sent");

  assert.equal(
    (await cleanup.deleteIfStale(ref.id)).deleted,
    false
  );

  assert.equal((await ref.get()).exists, true);
});

test("13AI-2 : document récent conservé", async () => {
  const ref = await createRecord("failed", {
    scheduledAt: NOW - 6 * DAY,
  });

  assert.equal(
    (await cleanup.deleteIfStale(ref.id)).deleted,
    false
  );

  assert.equal((await ref.get()).exists, true);
});

test("13AI-2 : bail actif conservé", async () => {
  const ref = await createRecord("sending", {
    claimedAtMs: NOW - 60000,
  });

  assert.equal(
    (await cleanup.deleteIfStale(ref.id)).deleted,
    false
  );

  assert.equal((await ref.get()).exists, true);
});

test("13AI-2 : état actualisé relu avant suppression", async () => {
  const ref = await createRecord("failed");

  // Le document est devenu confirmé avant
  // le début de la transaction de nettoyage.
  await ref.update({ status: "sent" });

  assert.equal(
    (await cleanup.deleteIfStale(ref.id)).deleted,
    false
  );

  assert.equal((await ref.get()).exists, true);
});

test("13AI-2 : suppression concurrente idempotente", async () => {
  const ref = await createRecord("failed");

  const results = await Promise.all([
    cleanup.deleteIfStale(ref.id),
    cleanup.deleteIfStale(ref.id),
  ]);

  assert.equal(
    results.filter(item => item.deleted).length,
    1
  );

  assert.equal((await ref.get()).exists, false);
});

test("13AI-2 : document absent sans erreur", async () => {
  const id = randomUUID().replaceAll("-", "") +
    randomUUID().replaceAll("-", "");

  assert.deepEqual(
    await cleanup.deleteIfStale(id),
    { deleted: false, reason: "not_found" }
  );
});

test("13AI-2 : identifiant invalide refusé", async () => {
  await assert.rejects(
    cleanup.deleteIfStale("../users"),
    /id invalide/
  );
});

after(async () => {
  await deleteApp(app);
});
