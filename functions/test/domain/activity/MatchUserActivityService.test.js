import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecordMatchUserActivities,
  extractMatchUserIds,
} from "../../../domain/activity/MatchUserActivityService.js";

test(
  "extractMatchUserIds keeps real participants and creator only",
  () => {
    const result =
      extractMatchUserIds(
        {
          participants: [
            "user_a",
            "user_b",
            "user_a",
            "ami_de_user_a:Paul",
            {
              uid:
                "user_c",
            },
          ],

          createurUid:
            "owner_1",
        },
        {
          excludedUserIds: [
            "user_b",
          ],
        }
      );

    assert.deepEqual(
      result.sort(),
      [
        "owner_1",
        "user_a",
        "user_c",
      ].sort()
    );
  }
);

test(
  "match_player_joined creates one activity per related user except actor",
  async () => {
    const writes = [];

    const record =
      buildRecordMatchUserActivities({
        async recordUserActivity(
          payload
        ) {
          writes.push(
            payload
          );

          return {
            id:
              `activity_${writes.length}`,
          };
        },
      });

    const result =
      await record({
        type:
          "match_player_joined",

        matchId:
          "match_123",

        actorUid:
          "user_joining",

        actorProfile: {
          pseudo:
            "Jeremie",
          avatar:
            "avatar.jpg",
        },

        match: {
          groupId:
            "group_123",

          createurUid:
            "owner_123",

          participants: [
            "owner_123",
            "existing_123",
            "user_joining",
          ],

          lieu:
            "Padel Central",

          dateHeure:
            123456789,
        },
      });

    assert.equal(
      result.recipientCount,
      2
    );

    assert.deepEqual(
      writes
        .map(
          (write) =>
            write.userId
        )
        .sort(),
      [
        "existing_123",
        "owner_123",
      ].sort()
    );

    for (
      const write
      of writes
    ) {
      assert.equal(
        write.type,
        "match_player_joined"
      );

      assert.equal(
        write.entityType,
        "match"
      );

      assert.equal(
        write.entityId,
        "match_123"
      );

      assert.equal(
        write.matchId,
        "match_123"
      );

      assert.equal(
        write.actorUid,
        "user_joining"
      );

      assert.equal(
        write.groupId,
        "group_123"
      );
    }
  }
);

test(
  "match activity is independent from push notification preferences",
  async () => {
    const writes = [];

    const record =
      buildRecordMatchUserActivities({
        async recordUserActivity(
          payload
        ) {
          writes.push(
            payload
          );

          return {
            id: "activity_1",
          };
        },
      });

    await record({
      type:
        "match_updated",

      matchId:
        "match_123",

      actorUid:
        "owner_123",

      match: {
        createurUid:
          "owner_123",

        participants: [
          "owner_123",
          "user_notifications_off",
        ],
      },
    });

    assert.equal(
      writes.length,
      1
    );

    assert.equal(
      writes[0].userId,
      "user_notifications_off"
    );
  }
);

test(
  "one failed recipient does not block other activities",
  async () => {
    let callCount = 0;

    const record =
      buildRecordMatchUserActivities({
        logger: {
          warn() {},
        },

        async recordUserActivity(
          payload
        ) {
          callCount += 1;

          if (
            payload.userId
            === "broken_user"
          ) {
            throw new Error(
              "TEST_FAILURE"
            );
          }

          return {
            id:
              `activity_${callCount}`,
          };
        },
      });

    const result =
      await record({
        type:
          "match_cancelled",

        matchId:
          "match_123",

        actorUid:
          "owner_123",

        match: {
          createurUid:
            "owner_123",

          participants: [
            "owner_123",
            "broken_user",
            "good_user",
          ],
        },
      });

    assert.equal(
      result.recipientCount,
      2
    );

    assert.equal(
      result.activityIds.length,
      1
    );
  }
);
