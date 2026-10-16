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
const HOSTS = ["127.0.0.1:8080", "localhost:8080"];

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  !HOSTS.includes(process.env.FIRESTORE_EMULATOR_HOST)
) {
  throw new Error("STOP : émulateur local obligatoire");
}

const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);

const NOW = 2000000000000;
const DAY = 86400000;

const progress = db.collection("notificationMaintenanceV2")
  .doc("matchReminderCleanupCursorV2");

const deliveries = db.collection("matchReminderDeliveriesV2");

function makeStore() {
  return buildMatchReminderCleanupStoreV2({
    db,
    now: () => NOW,
  });
}

function makeBatch(cleanupStore) {
  return buildMatchReminderCleanupBatchV2({
    db,
    cleanupStore,
    now: () => NOW,
  });
}

function makeCoordinator(batch) {
  return buildMatchReminderCleanupCoordinatorV2({
    db,
    batch,
    now: () => NOW,
  });
}

async function createStale() {
  const id = randomBytes(32).toString("hex");
  const ref = deliveries.doc(id);

  await ref.set({
    matchId: `match_${id}`,
    uid: "player_test",
    reminderType: "1h",
    scheduledAt: NOW - 8 * DAY,
    status: "failed",
    claimId: `claim_${id}`,
    claimedAtMs: NOW - 8 * DAY,
  });

  return ref;
}

test("13AO-3 : bail transmis jusqu'à la suppression", async () => {
  await progress.delete();
  const ref = await createStale();

  const actualStore = makeStore();
  const guards = [];

  const guardedStore = {
    async deleteIfStale(id, guard) {
      guards.push(guard);
      assert.equal(guard.ref.path, progress.path);
      assert.equal(typeof guard.claimId, "string");
      assert.ok(guard.claimId);

      return actualStore.deleteIfStale(id, guard);
    },
  };

  const coordinator = makeCoordinator(
    makeBatch(guardedStore)
  );

  const result = await coordinator.runOnce({
    scanLimit: 20,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(guards.length, 1);
  assert.equal((await ref.get()).exists, false);
});

test("13AO-3 : bail repris bloque suppression et curseur", async () => {
  await progress.delete();
  const ref = await createStale();

  const actualStore = makeStore();
  let takeoverCount = 0;

  const interceptedStore = {
    async deleteIfStale(id, guard) {
      takeoverCount++;

      // Simule une autre exécution qui reprend
      // le bail juste avant la transaction.
      await progress.update({
        claimId: "new_owner",
        leaseUntilMs: NOW + 60000,
      });

      return actualStore.deleteIfStale(id, guard);
    },
  };

  const coordinator = makeCoordinator(
    makeBatch(interceptedStore)
  );

  await assert.rejects(
    coordinator.runOnce({ scanLimit: 20 }),
    /cleanup lease lost/
  );

  assert.equal(takeoverCount, 1);
  assert.equal((await ref.get()).exists, true);

  const state = (await progress.get()).data();

  assert.equal(state.claimId, "new_owner");
  assert.equal(state.cursor ?? null, null);
});

test("13AO-3 : après reprise, nouveau propriétaire peut nettoyer", async () => {
  // Simule la fin du bail de l'autre exécution.
  await progress.update({
    claimId: null,
    leaseUntilMs: 0,
  });

  const remaining = await deliveries
    .where("status", "==", "failed")
    .where("scheduledAt", "==", NOW - 8 * DAY)
    .get();

  assert.ok(remaining.size >= 1);

  const coordinator = makeCoordinator(
    makeBatch(makeStore())
  );

  const result = await coordinator.runOnce({
    scanLimit: 20,
  });

  assert.equal(result.skipped, false);
  assert.ok(result.deleted >= 1);
  assert.equal(result.failed, 0);

  for (const doc of remaining.docs) {
    assert.equal(
      (await deliveries.doc(doc.id).get()).exists,
      false
    );
  }
});

after(async () => {
  await deleteApp(app);
});
