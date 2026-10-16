import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";

const PROJECT = "demo-padima-notifications-v2";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  !["127.0.0.1:8080", "localhost:8080"].includes(HOST)
) {
  throw new Error("STOP : émulateur local obligatoire");
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(
      new URL("../../firestore.rules", import.meta.url),
      "utf8"
    ),
  },
});

const PATH =
  "notificationMaintenanceV2/matchReminderCleanupCursorV2";

const RECORD = {
  claimId: null,
  leaseUntilMs: 0,
  cursor: null,
};

async function forbidden(context) {
  const db = context.firestore();
  const doc = db.doc(PATH);

  await assertFails(doc.get());

  await assertFails(
    db.collection("notificationMaintenanceV2").get()
  );

  await assertFails(doc.set(RECORD));

  await assertFails(doc.update({
    leaseUntilMs: 123,
  }));

  await assertFails(doc.delete());
}

test("13AN : visiteur sans accès", async () => {
  await forbidden(env.unauthenticatedContext());
});

test("13AN : joueur sans accès", async () => {
  await forbidden(env.authenticatedContext(
    "player_test",
    { role: "player" }
  ));
});

test("13AN : administrateur club sans accès", async () => {
  await forbidden(env.authenticatedContext(
    "club_admin_test",
    { role: "club_admin" }
  ));
});

test("13AN : backend privilégié peut gérer le curseur", async () => {
  await assertSucceeds(
    env.withSecurityRulesDisabled(async context => {
      const doc = context.firestore().doc(PATH);

      await doc.set(RECORD);

      const snapshot = await doc.get();
      assert.equal(snapshot.exists, true);

      await doc.update({ leaseUntilMs: 456 });
      await doc.delete();
    })
  );
});

after(async () => {
  await env.cleanup();
});
