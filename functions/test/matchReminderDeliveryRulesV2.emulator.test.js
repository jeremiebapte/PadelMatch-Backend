import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";

const PROJECT = "demo-padima-notifications-v2";

const host = process.env.FIRESTORE_EMULATOR_HOST;

if (
  !["127.0.0.1:8080", "localhost:8080"].includes(host) ||
  !process.env.FIREBASE_EMULATOR_HUB
) {
  throw new Error(
    "STOP : exécution autorisée uniquement dans l'émulateur local"
  );
}

const rules = readFileSync(
  new URL("../../firestore.rules", import.meta.url),
  "utf8"
);

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules,
  },
});

const path = "matchReminderDeliveriesV2/test_security_13Z";

await env.withSecurityRulesDisabled(async context => {
  await context.firestore().doc(path).set({
    status: "sent",
    matchId: "test_match",
    uid: "test_player",
    reminderType: "1h",
    attempts: 1,
  });
});

after(async () => {
  await env.cleanup();
});

const profiles = [
  {
    name: "non connecté",
    context: () => env.unauthenticatedContext(),
  },
  {
    name: "joueur connecté",
    context: () => env.authenticatedContext(
      "test_player",
      { role: "player" }
    ),
  },
  {
    name: "administrateur de club",
    context: () => env.authenticatedContext(
      "test_club_admin",
      { role: "club_admin" }
    ),
  },
];

for (const profile of profiles) {
  test(`13Z : ${profile.name} ne peut pas accéder au registre`, async () => {
    const db = profile.context().firestore();
    const doc = db.doc(path);
    const collection = db.collection(
      "matchReminderDeliveriesV2"
    );

    const operations = [
      ["lecture", () => doc.get()],
      ["liste", () => collection.get()],
      [
        "création",
        () => collection.doc(
          "new_" + profile.name.replaceAll(" ", "_")
        ).set({ status: "sent" }),
      ],
      [
        "modification",
        () => doc.update({ status: "failed" }),
      ],
      ["suppression", () => doc.delete()],
    ];

    for (const [operation, execute] of operations) {
      await assertFails(execute());
    }

    assert.equal(operations.length, 5);
  });
}

test("13Z : SDK Admin simulé peut gérer le registre", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const doc = context.firestore().doc(path);
    const snapshot = await doc.get();

    assert.equal(snapshot.exists, true);
    assert.equal(snapshot.data().status, "sent");
  });
});
