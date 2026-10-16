import test, { after } from "node:test";
import assert from "node:assert/strict";

import {
  initializeApp,
  deleteApp,
} from "firebase-admin/app";

import {
  getFirestore,
} from "firebase-admin/firestore";

import {
  buildMatchReminderCleanupCoordinatorV2,
} from "../domain/notifications/MatchReminderCleanupCoordinatorV2.js";

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

const REF = db.collection("notificationMaintenanceV2")
  .doc("matchReminderCleanupCursorV2");

let NOW = 2000000000000;

function build(batch) {
  return buildMatchReminderCleanupCoordinatorV2({
    db,
    batch,
    now: () => NOW,
  });
}

function result(cursor = null) {
  return {
    scanned: 1,
    deleted: 1,
    retained: 0,
    failed: 0,
    cursor,
  };
}

test("13AK-2 : le curseur persiste entre deux exécutions", async () => {
  await REF.delete();

  const next = {
    scheduledAt: NOW - 10 * 86400000,
    id: "a".repeat(64),
  };

  const cursors = [];

  const coordinator = build({
    async runBatch({ cursor }) {
      cursors.push(cursor);
      return result(cursors.length === 1 ? next : null);
    },
  });

  await coordinator.runOnce();
  await coordinator.runOnce();

  assert.deepEqual(cursors, [null, next]);

  const data = (await REF.get()).data();
  assert.equal(data.cursor, null);
  assert.equal(data.claimId, null);
});

test("13AK-2 : un bail actif bloque une seconde exécution", async () => {
  await REF.delete();

  let release;
  let started;
  const startedPromise = new Promise(resolve => {
    started = resolve;
  });

  const gate = new Promise(resolve => {
    release = resolve;
  });

  let executions = 0;

  const coordinator = build({
    async runBatch() {
      executions++;
      started();
      await gate;
      return result();
    },
  });

  const first = coordinator.runOnce();

  try {
    await startedPromise;

    const second = await coordinator.runOnce();

    assert.deepEqual(second, {
      skipped: true,
      reason: "active_lease",
    });

    assert.equal(executions, 1);
  } finally {
    release();
    await first;
  }
});

test("13AK-2 : une erreur conserve le curseur", async () => {
  await REF.delete();

  const cursor = {
    scheduledAt: NOW - 10 * 86400000,
    id: "b".repeat(64),
  };

  await REF.set({
    cursor,
    claimId: null,
    leaseUntilMs: 0,
  });

  const coordinator = build({
    async runBatch() {
      throw new Error("BATCH_FAILURE");
    },
  });

  await assert.rejects(
    coordinator.runOnce(),
    /BATCH_FAILURE/
  );

  const data = (await REF.get()).data();

  assert.deepEqual(data.cursor, cursor);
  assert.equal(data.claimId, null);
  assert.equal(data.leaseUntilMs, 0);
});

test("13AK-2 : un ancien bail expiré est récupérable", async () => {
  await REF.delete();

  await REF.set({
    cursor: null,
    claimId: "old_claim",
    leaseUntilMs: NOW - 1000,
  });

  const coordinator = build({
    async runBatch() {
      return result();
    },
  });

  const response = await coordinator.runOnce();

  assert.equal(response.skipped, false);
  assert.equal(
    (await REF.get()).data().claimId,
    null
  );
});

test("13AK-2 : une ancienne exécution ne remplace pas le curseur", async () => {
  await REF.delete();

  let release;
  let started;

  const startedPromise = new Promise(resolve => {
    started = resolve;
  });

  const gate = new Promise(resolve => {
    release = resolve;
  });

  const coordinator = build({
    async runBatch() {
      started();
      await gate;
      return result({
        scheduledAt: NOW - 10 * 86400000,
        id: "c".repeat(64),
      });
    },
  });

  const running = coordinator.runOnce();

  await startedPromise;

  await REF.update({
    claimId: "new_owner",
    leaseUntilMs: NOW + 60000,
  });

  release();

  await assert.rejects(
    running,
    /bail perdu/
  );

  const data = (await REF.get()).data();

  assert.equal(data.claimId, "new_owner");
  assert.equal(data.cursor ?? null, null);
});

test("13AK-2 : limites de lot invalides refusées", async () => {
  const coordinator = build({
    async runBatch() {
      throw new Error("NEVER");
    },
  });

  await assert.rejects(
    coordinator.runOnce({ scanLimit: 0 }),
    /scanLimit invalide/
  );

  await assert.rejects(
    coordinator.runOnce({ scanLimit: 101 }),
    /scanLimit invalide/
  );
});

after(async () => {
  await deleteApp(app);
});


test("13AP-1 : identifiant de curseur corrompu réinitialisé", async () => {
  await REF.delete();

  await REF.set({
    cursor: {
      scheduledAt: NOW - 10 * 86400000,
      id: "../users",
    },
    claimId: null,
    leaseUntilMs: 0,
  });

  const seen = [];

  const coordinator = build({
    async runBatch({ cursor }) {
      seen.push(cursor);
      return result(null);
    },
  });

  const response = await coordinator.runOnce();

  assert.equal(response.skipped, false);
  assert.deepEqual(seen, [null]);
  assert.equal((await REF.get()).data().cursor, null);
});

test("13AP-1 : curseur avec date future réinitialisé", async () => {
  await REF.delete();

  await REF.set({
    cursor: {
      scheduledAt: NOW + 86400000,
      id: "a".repeat(64),
    },
    claimId: null,
    leaseUntilMs: 0,
  });

  const seen = [];

  const coordinator = build({
    async runBatch({ cursor }) {
      seen.push(cursor);
      return result(null);
    },
  });

  await coordinator.runOnce();

  assert.deepEqual(seen, [null]);
  assert.equal((await REF.get()).data().cursor, null);
});

test("13AP-1 : curseur avec date non numérique réinitialisé", async () => {
  await REF.delete();

  await REF.set({
    cursor: {
      scheduledAt: "invalid",
      id: "b".repeat(64),
    },
    claimId: null,
    leaseUntilMs: 0,
  });

  const seen = [];

  const coordinator = build({
    async runBatch({ cursor }) {
      seen.push(cursor);
      return result(null);
    },
  });

  await coordinator.runOnce();

  assert.deepEqual(seen, [null]);
  assert.equal((await REF.get()).data().cursor, null);
});

test("13AP-1 : curseur correct conserve sa progression", async () => {
  await REF.delete();

  const previous = {
    scheduledAt: NOW - 10 * 86400000,
    id: "c".repeat(64),
  };

  await REF.set({
    cursor: previous,
    claimId: null,
    leaseUntilMs: 0,
  });

  const seen = [];

  const coordinator = build({
    async runBatch({ cursor }) {
      seen.push(cursor);
      return result(null);
    },
  });

  await coordinator.runOnce();

  assert.deepEqual(seen, [previous]);
  assert.equal((await REF.get()).data().cursor, null);
});
