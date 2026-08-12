import test from "node:test";
import assert from "node:assert/strict";

import {
  createUserActivityRecorder,
  USER_ACTIVITY_SCHEMA_VERSION,
} from "../../../domain/activity/UserActivityRecorder.js";

function createEnvironment() {
  const writes = [];
  let generatedId = 0;

  const db = {
    collection(name) {
      assert.equal(name, "userActivities");

      return {
        doc() {
          generatedId += 1;

          return {
            id: `activity_${generatedId}`,
            path:
              `userActivities/activity_${generatedId}`,

            async set(data) {
              writes.push({
                operation: "set",
                path:
                  `userActivities/activity_${generatedId}`,
                data,
              });
            },
          };
        },
      };
    },
  };

  const logger = {
    error() {},
  };

  return {
    writes,
    db,
    logger,
  };
}

test(
  "UserActivityRecorder writes canonical activity",
  async () => {
    const env = createEnvironment();

    const recordUserActivity =
      createUserActivityRecorder({
        db: env.db,
        logger: env.logger,
      });

    const now =
      new Date("2026-08-12T14:00:00.000Z");

    const result =
      await recordUserActivity({
        userId: "target_123",
        type: "group_invite_received",
        entityType: "invitation",
        entityId: "invite_123",

        groupId: "group_123",
        inviteId: "invite_123",

        actorUid: "owner_123",
        actorPseudoSnapshot: "Jeremie",
        actorAvatarSnapshot:
          "https://example.com/avatar.jpg",

        title:
          "Invitation à rejoindre Padel Paris",
        subtitle:
          "Jeremie t’invite à rejoindre ce groupe.",

        sourceType: "group_activity",
        sourceId: "group_activity_123",

        createdAt: now,

        metadata: {
          groupName: "Padel Paris",
        },
      });

    assert.equal(
      env.writes.length,
      1
    );

    const write =
      env.writes[0];

    assert.equal(
      write.operation,
      "set"
    );

    assert.equal(
      write.path,
      "userActivities/activity_1"
    );

    assert.equal(
      write.data.schemaVersion,
      USER_ACTIVITY_SCHEMA_VERSION
    );

    assert.equal(
      write.data.userId,
      "target_123"
    );

    assert.equal(
      write.data.type,
      "group_invite_received"
    );

    assert.equal(
      write.data.entityType,
      "invitation"
    );

    assert.equal(
      write.data.entityId,
      "invite_123"
    );

    assert.equal(
      write.data.groupId,
      "group_123"
    );

    assert.equal(
      write.data.inviteId,
      "invite_123"
    );

    assert.equal(
      write.data.sourceId,
      "group_activity_123"
    );

    assert.equal(
      write.data.readAt,
      null
    );

    assert.equal(
      write.data.createdAt,
      now
    );

    assert.deepEqual(
      result.metadata,
      {
        groupName: "Padel Paris",
      }
    );
  }
);

test(
  "UserActivityRecorder supports transaction.create",
  async () => {
    const env = createEnvironment();

    const transactionWrites = [];

    const transaction = {
      create(ref, data) {
        transactionWrites.push({
          path: ref.path,
          data,
        });
      },
    };

    const recordUserActivity =
      createUserActivityRecorder({
        db: env.db,
        logger: env.logger,
      });

    await recordUserActivity(
      {
        userId: "target_123",
        type: "group_invite_received",
        entityType: "invitation",
        entityId: "invite_123",
        title: "Invitation",
        sourceType: "group_activity",
        createdAt:
          new Date(
            "2026-08-12T14:00:00.000Z"
          ),
      },
      {
        transaction,
      }
    );

    assert.equal(
      env.writes.length,
      0
    );

    assert.equal(
      transactionWrites.length,
      1
    );

    assert.equal(
      transactionWrites[0].path,
      "userActivities/activity_1"
    );

    assert.equal(
      transactionWrites[0]
        .data
        .readAt,
      null
    );
  }
);

test(
  "UserActivityRecorder omits empty optional fields",
  async () => {
    const env = createEnvironment();

    const recordUserActivity =
      createUserActivityRecorder({
        db: env.db,
        logger: env.logger,
      });

    await recordUserActivity({
      userId: "user_123",
      type: "match_updated",
      entityType: "match",
      entityId: "match_123",
      title: "Match modifié",
      sourceType: "direct",

      subtitle: "   ",
      groupId: "",
      actorUid: " ",
    });

    const data =
      env.writes[0].data;

    assert.equal(
      Object.hasOwn(
        data,
        "subtitle"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        data,
        "groupId"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        data,
        "actorUid"
      ),
      false
    );

    assert.equal(
      data.readAt,
      null
    );

    assert.ok(
      data.createdAt instanceof Date
    );
  }
);

test(
  "UserActivityRecorder rejects missing required fields",
  async () => {
    const env = createEnvironment();

    const recordUserActivity =
      createUserActivityRecorder({
        db: env.db,
        logger: env.logger,
      });

    await assert.rejects(
      recordUserActivity({
        userId: "",
        type: "match_updated",
        entityType: "match",
        entityId: "match_123",
        title: "Match modifié",
        sourceType: "direct",
      }),
      /USER_ACTIVITY_USERID_MISSING/
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);
