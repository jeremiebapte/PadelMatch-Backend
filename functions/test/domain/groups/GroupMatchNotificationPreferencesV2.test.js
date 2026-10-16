import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNotifyGroupMatchEvent,
  GroupMatchNotificationEvent,
} from "../../../domain/groups/GroupMatchNotificationService.js";

const events = [
  [GroupMatchNotificationEvent.CREATED, "groups", "groupMatchCreated"],
  [GroupMatchNotificationEvent.UPDATED, "matches", "groupMatchUpdated"],
  [GroupMatchNotificationEvent.CANCELLED, "matches", "groupMatchCancelled"],
  [GroupMatchNotificationEvent.PLAYER_JOINED, "matches", "groupMatchPlayerJoined"],
  [GroupMatchNotificationEvent.PLAYER_LEFT, "matches", "groupMatchPlayerLeft"],
  [GroupMatchNotificationEvent.MATCH_FULL, "matches", "groupMatchFull"],
  [GroupMatchNotificationEvent.SPOT_AVAILABLE, "matches", "groupMatchSpotAvailable"],
];

function setup(event, isAllowed) {
  const checked = [];
  const tokenRequests = [];
  const sends = [];
  const audiences = [];

  const recipients = [
    { userId: "player_a", notificationsEnabled: true },
    { userId: "player_b", notificationsEnabled: true },
  ];

  const notify = buildNotifyGroupMatchEvent({
    getEligibleGroupRecipients: async (args) => {
      audiences.push({ type: "group", args });
      return recipients;
    },
    getEligibleMatchRecipients: async (args) => {
      audiences.push({ type: "match", args });
      return recipients;
    },
    tokensOf: async (uid) => {
      tokenRequests.push(uid);
      return [`token_${uid}`];
    },
    sendVisibleHybrid: async (tokens) => {
      sends.push(tokens);
    },
    isPushAllowed: async (input) => {
      checked.push(input);
      return isAllowed(input);
    },
    frDate: () => "14 octobre",
    frTime: () => "19:00",
    logger: {
      info() {},
      warn() {},
    },
  });

  return {
    notify,
    checked,
    tokenRequests,
    sends,
    audiences,
    request: {
      event,
      groupId: "group_1",
      matchId: "match_1",
      actorUid: "creator",
      group: { name: "Groupe Padel" },
      match: {
        groupId: "group_1",
        dateHeure: 1791997200000,
        lieu: "Club Padel",
        participants: ["creator", "player_a", "player_b"],
      },
      previousMatch: {
        groupId: "group_1",
        dateHeure: 1791997200000,
      },
      actorProfile: { pseudo: "Créateur" },
      changedKeys: ["dateHeure"],
    },
  };
}

for (const [event, category, preferenceEvent] of events) {
  test(`V2 ${event} : bloque un joueur avant tokensOf`, async () => {
    const app = setup(
      event,
      ({ uid }) => uid !== "player_b"
    );

    const result = await app.notify(app.request);

    assert.equal(result.skipped, false);
    assert.equal(result.sentUserCount, 1);
    assert.equal(app.sends.length, 1);
    assert.deepEqual(app.tokenRequests, ["player_a"]);
    assert.deepEqual(app.checked, [
      { uid: "player_a", category, event: preferenceEvent },
      { uid: "player_b", category, event: preferenceEvent },
    ]);

    assert.equal(app.audiences.length, 1);
    assert.equal(
      app.audiences[0].type,
      event === GroupMatchNotificationEvent.CREATED
        ? "group"
        : "match"
    );

    assert.deepEqual(
      app.audiences[0].args.excludedUserIds,
      ["creator"]
    );
  });
}

test("V2 : préférence refusée pour tous = aucun envoi", async () => {
  const app = setup(
    GroupMatchNotificationEvent.CANCELLED,
    () => false
  );

  const result = await app.notify(app.request);

  assert.equal(result.sentUserCount, 0);
  assert.equal(app.tokenRequests.length, 0);
  assert.equal(app.sends.length, 0);
});

test("V2 : erreur de préférence isolée par joueur", async () => {
  const app = setup(
    GroupMatchNotificationEvent.UPDATED,
    ({ uid }) => {
      if (uid === "player_a") {
        throw new Error("Firestore unavailable");
      }
      return true;
    }
  );

  const result = await app.notify(app.request);

  assert.equal(result.sentUserCount, 1);
  assert.deepEqual(app.tokenRequests, ["player_b"]);
});

test("compatibilité : absence du filtre conserve l'ancien envoi", async () => {
  const sent = [];
  const notify = buildNotifyGroupMatchEvent({
    getEligibleGroupRecipients: async () => [
      { userId: "player_a" },
    ],
    getEligibleMatchRecipients: async () => [
      { userId: "player_a" },
    ],
    tokensOf: async () => ["token_a"],
    sendVisibleHybrid: async (tokens) => sent.push(tokens),
    frDate: () => "14 octobre",
    frTime: () => "19:00",
  });

  const result = await notify({
    event: GroupMatchNotificationEvent.CREATED,
    groupId: "group_1",
    matchId: "match_1",
    actorUid: "creator",
    group: { name: "Groupe Padel" },
    match: { lieu: "Club Padel" },
  });

  assert.equal(result.sentUserCount, 1);
  assert.equal(sent.length, 1);
});
