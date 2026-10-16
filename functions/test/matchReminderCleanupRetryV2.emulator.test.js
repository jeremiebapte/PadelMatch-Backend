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

async function record(age) {
  const id = randomBytes(32).toString("hex");
  const ref = deliveries.doc(id);

  await ref.set({
    matchId: `match_${id}`,
    uid: "player_test",
    reminderType: "1h",
    scheduledAt: NOW - age * DAY,
    claimedAtMs: NOW - age * DAY,
    status: "failed",
  });

  return ref;
}

function services(cleanupStore) {
  const batch = buildMatchReminderCleanupBatchV2({
    db,
    cleanupStore,
    now: () => NOW,
  });

  return buildMatchReminderCleanupCoordinatorV2({
    db,
    batch,
    now: () => NOW,
  });
}

test("13AP-2B : erreur temporaire puis reprise", async () => {
  await progress.delete();

  const first = await record(12);
  const second = await record(11);

  const realStore = buildMatchReminderCleanupStoreV2({
    db,
    now: () => NOW,
  });

  let failurePending = true;
  let secondAttempts = 0;

  const coordinator = services({
    async deleteIfStale(id, guard) {
      if (id === second.id) {
        secondAttempts++;

        if (failurePending) {
          failurePending = false;
          throw new Error("SIMULATED_TRANSIENT_ERROR");
        }
      }

      return realStore.deleteIfStale(id, guard);
    },
  });

  await assert.rejects(
    coordinator.runOnce({ scanLimit: 2 }),
    /cleanup document failed/
  );

  assert.equal((await first.get()).exists, false);
  assert.equal((await second.get()).exists, true);

  let state = (await progress.get()).data();

  assert.equal(state.cursor ?? null, null);
  assert.equal(state.claimId, null);
  assert.equal(state.leaseUntilMs, 0);

  const retry = await coordinator.runOnce({ scanLimit: 2 });

  assert.equal(retry.skipped, false);
  assert.equal(retry.scanned, 1);
  assert.equal(retry.deleted, 1);
  assert.equal(retry.cursor, null);
  assert.equal(secondAttempts, 2);
  assert.equal((await second.get()).exists, false);
});

test("13AP-2B : erreur persistante sans progression", async () => {
  await progress.delete();

  const ref = await record(10);

  const coordinator = services({
    async deleteIfStale() {
      throw new Error("SIMULATED_PERSISTENT_ERROR");
    },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      coordinator.runOnce({ scanLimit: 2 }),
      /cleanup document failed/
    );

    const state = (await progress.get()).data();

    assert.equal(state.cursor ?? null, null);
    assert.equal(state.claimId, null);
    assert.equal(state.leaseUntilMs, 0);
    assert.equal((await ref.get()).exists, true);
  }
});

after(async () => {
  await deleteApp(app);
});
