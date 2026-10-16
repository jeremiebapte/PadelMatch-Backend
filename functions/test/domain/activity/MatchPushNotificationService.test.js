import test from "node:test";
import assert from "node:assert/strict";

import {
  extractClassicMatchRecipientUids,
  buildNotifyClassicMatchEvent,
} from "../../../domain/activity/MatchPushNotificationService.js";

test(
  "extracts participants and player creator, excluding actor and placeholders",
  () => {
    assert.deepEqual(
      extractClassicMatchRecipientUids(
        {
          participants: [
            "user_a",
            "user_b",
            "ami_de_user_a:Paul",
          ],
          createurUid:
            "creator",
          createdByType:
            "player",
        },
        {
          excludedUserIds:
            ["user_b"],
        }
      ).sort(),
      [
        "creator",
        "user_a",
      ]
    );
  }
);

test(
  "classic update sends to related users except actor",
  async () => {
    const sends = [];

    const notify =
      buildNotifyClassicMatchEvent({
        tokensOf:
          async (uid) =>
            [`token_${uid}`],

        sendVisibleHybrid:
          async (tokens, payload) => {
            sends.push({
              tokens,
              payload,
            });
          },

        logger:
          console,
      });

    const result =
      await notify({
        type:
          "match_updated",

        matchId:
          "match_1",

        actorUid:
          "creator",

        match: {
          createurUid:
            "creator",

          participants: [
            "creator",
            "player_b",
          ],

          placeName:
            "Padel Club",
        },
      });

    assert.equal(
      result.eligibleUserCount,
      1
    );

    assert.equal(
      result.sentUserCount,
      1
    );

    assert.equal(
      sends[0].payload.data.type,
      "match_updated"
    );
  }
);

test(
  "classic cancelled sends notification",
  async () => {
    let payload = null;

    const notify =
      buildNotifyClassicMatchEvent({
        tokensOf:
          async () =>
            ["token"],

        sendVisibleHybrid:
          async (_tokens, value) => {
            payload = value;
          },

        logger:
          console,
      });

    await notify({
      type:
        "match_cancelled",

      matchId:
        "match_2",

      actorUid:
        "creator",

      match: {
        createurUid:
          "creator",

        participants: [
          "creator",
          "player_b",
        ],
      },
    });

    assert.equal(
      payload.data.type,
      "match_cancelled"
    );
  }
);

test(
  "group match is skipped to avoid duplicate push",
  async () => {
    let called = false;

    const notify =
      buildNotifyClassicMatchEvent({
        tokensOf:
          async () => {
            called = true;
            return [];
          },

        sendVisibleHybrid:
          async () => {},

        logger:
          console,
      });

    const result =
      await notify({
        type:
          "match_updated",

        matchId:
          "group_match",

        actorUid:
          "creator",

        match: {
          groupId:
            "group_1",

          createurUid:
            "creator",

          participants: [
            "creator",
            "player_b",
          ],
        },
      });

    assert.equal(
      result.skippedGroupMatch,
      true
    );

    assert.equal(
      called,
      false
    );
  }
);

test("V2 : match modifié filtre les destinataires", async () => {
  const checked = [];
  const tokenRequests = [];
  const sends = [];

  const notify = buildNotifyClassicMatchEvent({
    isPushAllowed: async ({ uid, category, event }) => {
      checked.push({ uid, category, event });
      return uid !== "player_b";
    },
    tokensOf: async (uid) => {
      tokenRequests.push(uid);
      return [`token_${uid}`];
    },
    sendVisibleHybrid: async (tokens, payload) => {
      sends.push({ tokens, payload });
    },
  });

  const result = await notify({
    type: "match_updated",
    matchId: "match_1",
    actorUid: "creator",
    match: {
      createurUid: "creator",
      participants: ["creator", "player_a", "player_b"],
    },
  });

  assert.equal(result.eligibleUserCount, 2);
  assert.equal(result.sentUserCount, 1);
  assert.deepEqual(tokenRequests, ["player_a"]);
  assert.equal(sends.length, 1);
  assert.deepEqual(checked, [
    { uid: "player_a", category: "matches", event: "matchUpdated" },
    { uid: "player_b", category: "matches", event: "matchUpdated" },
  ]);
});

test("V2 : annulation bloquée sans récupération de token", async () => {
  let tokenCalls = 0;
  let sends = 0;

  const notify = buildNotifyClassicMatchEvent({
    isPushAllowed: async ({ category, event }) =>
      category !== "matches" || event !== "matchCancelled",
    tokensOf: async () => {
      tokenCalls += 1;
      return ["token"];
    },
    sendVisibleHybrid: async () => {
      sends += 1;
    },
  });

  const result = await notify({
    type: "match_cancelled",
    matchId: "match_2",
    actorUid: "creator",
    match: {
      createurUid: "creator",
      participants: ["creator", "player_b"],
    },
  });

  assert.equal(result.sentUserCount, 0);
  assert.equal(tokenCalls, 0);
  assert.equal(sends, 0);
});

test("V2 : un échec de préférence n'empêche pas les autres joueurs", async () => {
  const sent = [];
  const warnings = [];

  const notify = buildNotifyClassicMatchEvent({
    isPushAllowed: async ({ uid }) => {
      if (uid === "player_a") {
        throw new Error("FIRESTORE_UNAVAILABLE");
      }
      return true;
    },
    tokensOf: async (uid) => [`token_${uid}`],
    sendVisibleHybrid: async (tokens) => sent.push(tokens[0]),
    logger: {
      warn: (...args) => warnings.push(args),
    },
  });

  const result = await notify({
    type: "match_updated",
    matchId: "match_3",
    actorUid: "creator",
    match: {
      createurUid: "creator",
      participants: ["creator", "player_a", "player_b"],
    },
  });

  assert.equal(result.sentUserCount, 1);
  assert.deepEqual(sent, ["token_player_b"]);
  assert.equal(warnings.length, 1);
});

test("V2 : les matchs de groupe ne consultent pas le contrôle", async () => {
  let gateCalls = 0;
  let tokenCalls = 0;

  const notify = buildNotifyClassicMatchEvent({
    isPushAllowed: async () => {
      gateCalls += 1;
      return true;
    },
    tokensOf: async () => {
      tokenCalls += 1;
      return ["token"];
    },
    sendVisibleHybrid: async () => {},
  });

  const result = await notify({
    type: "match_updated",
    matchId: "match_group",
    actorUid: "creator",
    match: {
      groupId: "group_1",
      participants: ["creator", "player_b"],
    },
  });

  assert.equal(result.skippedGroupMatch, true);
  assert.equal(gateCalls, 0);
  assert.equal(tokenCalls, 0);
});
