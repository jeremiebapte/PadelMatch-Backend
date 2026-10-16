import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
const leaseRef = db.collection("notificationMaintenanceV2")
  .doc("matchReminderCleanupCursorV2");

const store = buildMatchReminderCleanupStoreV2({
  db,
  now: () => NOW,
});

async function staleRecord() {
  const id = randomBytes(32).toString("hex");
  const ref = db.collection("matchReminderDeliveriesV2").doc(id);

  await ref.set({
    matchId: `match_${id}`,
    uid: "player_test",
    reminderType: "1h",
    scheduledAt: NOW - 8 * DAY,
    claimedAtMs: NOW - 8 * DAY,
    status: "failed",
  });

  return ref;
}

function guard(claimId) {
  return { ref: leaseRef, claimId };
}

test("13AO-2 : bail valide autorise la suppression", async () => {
  const ref = await staleRecord();

  await leaseRef.set({
    claimId: "owner_valid",
    leaseUntilMs: NOW + 60000,
  });

  const result = await store.deleteIfStale(
    ref.id, guard("owner_valid")
  );

  assert.equal(result.deleted, true);
  assert.equal((await ref.get()).exists, false);
});

test("13AO-2 : bail repris bloque ancienne exécution", async () => {
  const ref = await staleRecord();

  await leaseRef.set({
    claimId: "new_owner",
    leaseUntilMs: NOW + 60000,
  });

  const result = await store.deleteIfStale(
    ref.id, guard("old_owner")
  );

  assert.deepEqual(result, {
    deleted: false,
    reason: "lease_lost",
  });
  assert.equal((await ref.get()).exists, true);
});

test("13AO-2 : bail expiré interdit suppression", async () => {
  const ref = await staleRecord();

  await leaseRef.set({
    claimId: "expired_owner",
    leaseUntilMs: NOW - 1,
  });

  const result = await store.deleteIfStale(
    ref.id, guard("expired_owner")
  );

  assert.equal(result.reason, "lease_lost");
  assert.equal((await ref.get()).exists, true);
});

test("13AO-2 : absence de bail interdit suppression", async () => {
  const ref = await staleRecord();
  await leaseRef.delete();

  const result = await store.deleteIfStale(
    ref.id, guard("missing_owner")
  );

  assert.equal(result.reason, "lease_lost");
  assert.equal((await ref.get()).exists, true);
});

test("13AO-2 : référence de bail invalide refusée", async () => {
  const ref = await staleRecord();

  await assert.rejects(
    store.deleteIfStale(ref.id, {
      ref: db.collection("users").doc("test"),
      claimId: "owner",
    }),
    /leaseGuard invalide/
  );

  assert.equal((await ref.get()).exists, true);
});

after(async () => {
  await deleteApp(app);
});
