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
