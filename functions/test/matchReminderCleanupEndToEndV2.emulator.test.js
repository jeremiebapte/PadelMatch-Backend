import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildMatchReminderCleanupStoreV2,
} from "../domain/notifications/MatchReminderCleanupStoreV2.js";

import {
  buildMatchReminderCleanupBatchV2,
} from "../domain/notifications/MatchReminderCleanupBatchV2.js";

import {
  buildMatchReminderCleanupCoordinatorV2,
} from "../domain/notifications/MatchReminderCleanupCoordinatorV2.js";

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

const deliveries = db.collection("matchReminderDeliveriesV2");
const progress = db.collection("notificationMaintenanceV2")
  .doc("matchReminderCleanupCursorV2");

const cleanupStore = buildMatchReminderCleanupStoreV2({
  db,
  now: () => NOW,
});

const batch = buildMatchReminderCleanupBatchV2({
  db,
  cleanupStore,
  now: () => NOW,
});

const coordinator = buildMatchReminderCleanupCoordinatorV2({
  db,
  batch,
  now: () => NOW,
});

async function createRecord(status, ageDays, extras = {}) {
  const id = randomBytes(32).toString("hex");
  const ref = deliveries.doc(id);

  await ref.set({
    matchId: `match_${id}`,
    uid: "player_test",
    reminderType: "1h",
    scheduledAt: NOW - ageDays * DAY,
    status,
    claimId: `claim_${id}`,
    claimedAtMs: NOW - 15 * DAY,
    ...extras,
  });

  return ref;
}

test("13AL : progression complète, protections et second cycle", async () => {
  await progress.delete();

  const sent = await createRecord("sent", 12);
  const failed = await createRecord("failed", 11);
  const active = await createRecord("sending", 10, {
    claimedAtMs: NOW - 60000,
  });
  const staleSending = await createRecord("sending", 9);
  const recent = await createRecord("failed", 2);

  // PAGE 1 : sent protégé + failed supprimé.
  const first = await coordinator.runOnce({ scanLimit: 2 });

  assert.equal(first.skipped, false);
  assert.equal(first.scanned, 2);
  assert.equal(first.deleted, 1);
  assert.equal(first.retained, 1);
  assert.equal(first.failed, 0);
  assert.ok(first.cursor);

  assert.equal((await sent.get()).exists, true);
  assert.equal((await failed.get()).exists, false);

  // PAGE 2 : bail actif protégé + sending supprimé.
  const second = await coordinator.runOnce({ scanLimit: 2 });

  assert.equal(second.skipped, false);
  assert.equal(second.scanned, 2);
  assert.equal(second.deleted, 1);
  assert.equal(second.retained, 1);
  assert.equal(second.failed, 0);

  // Une page pleine conserve un curseur.
  assert.ok(second.cursor);

  assert.equal((await active.get()).exists, true);
  assert.equal((await staleSending.get()).exists, false);
  assert.equal((await recent.get()).exists, true);

  // PAGE 3 : fin réelle du parcours.
  const third = await coordinator.runOnce({ scanLimit: 2 });

  assert.equal(third.skipped, false);
  assert.equal(third.scanned, 0);
  assert.equal(third.cursor, null);

  const completed = (await progress.get()).data();

  assert.equal(completed.cursor, null);
  assert.equal(completed.claimId, null);
  assert.equal(completed.leaseUntilMs, 0);

  // NOUVEAU CYCLE : les documents protégés sont relus.
  const fourth = await coordinator.runOnce({ scanLimit: 2 });

  assert.equal(fourth.scanned, 2);
  assert.equal(fourth.deleted, 0);
  assert.equal(fourth.retained, 2);
  assert.ok(fourth.cursor);

  const fifth = await coordinator.runOnce({ scanLimit: 2 });

  assert.equal(fifth.scanned, 0);
  assert.equal(fifth.cursor, null);

  for (const ref of [sent, active, recent]) {
    assert.equal((await ref.get()).exists, true);
  }
});

after(async () => {
  await deleteApp(app);
});
