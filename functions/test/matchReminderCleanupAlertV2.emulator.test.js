import test, { after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

const ref = db.collection("notificationMaintenanceV2")
  .doc("matchReminderCleanupCursorV2");

const events = [];
const logger = {
  error(...args) {
    events.push(args);
  },
};

function build(batch) {
  return buildMatchReminderCleanupCoordinatorV2({
    db,
    batch,
    logger,
    now: () => NOW,
  });
}

function failure() {
  const error = new Error("PRIVATE_MATCH_AND_USER_IDENTIFIERS");
  error.code = "CLEANUP_DOCUMENT_FAILED";
  return error;
}

test("13AR-1 : signal technique au troisième échec", async () => {
  await ref.delete();
  events.length = 0;

  const coordinator = build({
    async runBatch() {
      throw failure();
    },
  });

  for (let i = 1; i <= 3; i++) {
    await assert.rejects(
      coordinator.runOnce(),
      /PRIVATE_MATCH_AND_USER_IDENTIFIERS/
    );

    assert.equal(
      (await ref.get()).data().consecutiveFailures,
      i
    );

    assert.equal(events.length, i >= 3 ? 1 : 0);
  }

  assert.equal(
    events[0][0],
    "MATCH_REMINDER_CLEANUP_BLOCKED"
  );

  assert.deepEqual(events[0][1], {
    status: "blocked",
    consecutiveFailures: 3,
  });

  assert.equal(
    JSON.stringify(events).includes("PRIVATE_MATCH"),
    false
  );
});

test("13AR-1 : succès remet surveillance à zéro", async () => {
  events.length = 0;

  const coordinator = build({
    async runBatch() {
      return {
        scanned: 0,
        deleted: 0,
        retained: 0,
        failed: 0,
        cursor: null,
      };
    },
  });

  await coordinator.runOnce();

  const state = (await ref.get()).data();

  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.lastFailureCode, null);
  assert.equal(events.length, 0);
});

test("13AR-1 : perte du bail ne produit aucun signal", async () => {
  await ref.delete();
  events.length = 0;

  const coordinator = build({
    async runBatch() {
      await ref.update({
        claimId: "another_owner",
        leaseUntilMs: NOW + 60000,
      });

      throw failure();
    },
  });

  await assert.rejects(coordinator.runOnce());

  assert.equal(events.length, 0);
  assert.equal(
    (await ref.get()).data().claimId,
    "another_owner"
  );
});

after(async () => {
  await deleteApp(app);
});
