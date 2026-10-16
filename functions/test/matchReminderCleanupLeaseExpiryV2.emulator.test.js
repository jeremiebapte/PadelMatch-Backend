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

const ref = db.collection("notificationMaintenanceV2")
  .doc("matchReminderCleanupCursorV2");

let nowMs = 2000000000000;

function makeCoordinator(batch) {
  return buildMatchReminderCleanupCoordinatorV2({
    db,
    batch,
    now: () => nowMs,
  });
}

function result(cursor) {
  return {
    scanned: 1,
    deleted: 0,
    retained: 1,
    failed: 0,
    cursor,
  };
}

test("13AO : bail expiré, ancienne exécution ne confirme pas", async () => {
  await ref.delete();

  let unblockFirst;
  let firstStarted;

  const entered = new Promise(resolve => {
    firstStarted = resolve;
  });

  const gate = new Promise(resolve => {
    unblockFirst = resolve;
  });

  const oldCursor = {
    scheduledAt: nowMs - 10 * 86400000,
    id: "a".repeat(64),
  };

  const newCursor = {
    scheduledAt: nowMs - 9 * 86400000,
    id: "b".repeat(64),
  };

  const first = makeCoordinator({
    async runBatch() {
      firstStarted();
      await gate;
      return result(oldCursor);
    },
  });

  const running = first.runOnce();

  try {
    await entered;

    // Le bail de quinze minutes est dépassé.
    nowMs += 16 * 60 * 1000;

    const second = makeCoordinator({
      async runBatch() {
        return result(newCursor);
      },
    });

    const takeover = await second.runOnce();

    assert.equal(takeover.skipped, false);
    assert.deepEqual(
      (await ref.get()).data().cursor,
      newCursor
    );
  } finally {
    unblockFirst();
  }

  await assert.rejects(
    running,
    /bail perdu avant confirmation/
  );

  assert.deepEqual(
    (await ref.get()).data().cursor,
    newCursor
  );
});

after(async () => {
  await deleteApp(app);
});
