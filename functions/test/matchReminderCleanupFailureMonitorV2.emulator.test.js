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

function build(batch) {
  return buildMatchReminderCleanupCoordinatorV2({
    db,
    batch,
    now: () => NOW,
  });
}

function documentFailure() {
  const error = new Error("PRIVATE_INTERNAL_ERROR");
  error.code = "CLEANUP_DOCUMENT_FAILED";
  return error;
}

test("13AQ : deux échecs successifs incrémentent le compteur", async () => {
  await ref.delete();

  const coordinator = build({
    async runBatch() {
      throw documentFailure();
    },
  });

  for (let expected = 1; expected <= 2; expected++) {
    await assert.rejects(
      coordinator.runOnce(),
      /PRIVATE_INTERNAL_ERROR/
    );

    const state = (await ref.get()).data();

    assert.equal(state.consecutiveFailures, expected);
    assert.equal(state.lastFailureAtMs, NOW);
    assert.equal(
      state.lastFailureCode,
      "CLEANUP_DOCUMENT_FAILED"
    );
    assert.equal(state.claimId, null);
    assert.equal(state.leaseUntilMs, 0);

    // Aucun détail interne brut n'est enregistré.
    assert.equal(
      JSON.stringify(state).includes("PRIVATE_INTERNAL_ERROR"),
      false
    );
  }
});

test("13AQ : exécution réussie remet compteur à zéro", async () => {
  await ref.set({
    consecutiveFailures: 4,
    lastFailureAtMs: NOW - 1000,
    lastFailureCode: "CLEANUP_DOCUMENT_FAILED",
    claimId: null,
    leaseUntilMs: 0,
    cursor: null,
  });

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
  assert.equal(state.lastFailureAtMs, null);
  assert.equal(state.lastFailureCode, null);
});

test("13AQ : erreur non documentaire ne gonfle pas compteur", async () => {
  await ref.set({
    consecutiveFailures: 3,
    lastFailureCode: "CLEANUP_DOCUMENT_FAILED",
    lastFailureAtMs: NOW - 1000,
    claimId: null,
    leaseUntilMs: 0,
    cursor: null,
  });

  const coordinator = build({
    async runBatch() {
      throw new Error("QUERY_FAILURE");
    },
  });

  await assert.rejects(
    coordinator.runOnce(),
    /QUERY_FAILURE/
  );

  const state = (await ref.get()).data();

  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.claimId, null);
});

test("13AQ : ancien propriétaire ne modifie pas surveillance", async () => {
  await ref.delete();

  let started;
  let unblock;

  const entered = new Promise(resolve => {
    started = resolve;
  });

  const gate = new Promise(resolve => {
    unblock = resolve;
  });

  const coordinator = build({
    async runBatch() {
      started();
      await gate;
      throw documentFailure();
    },
  });

  const running = coordinator.runOnce();

  await entered;

  await ref.update({
    claimId: "new_owner",
    leaseUntilMs: NOW + 60000,
    consecutiveFailures: 7,
  });

  unblock();

  await assert.rejects(
    running,
    /PRIVATE_INTERNAL_ERROR/
  );

  const state = (await ref.get()).data();

  assert.equal(state.claimId, "new_owner");
  assert.equal(state.consecutiveFailures, 7);
});

after(async () => {
  await deleteApp(app);
});
