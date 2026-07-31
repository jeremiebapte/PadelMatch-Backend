import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLeaveGroup,
} from "../../leaveGroup.js";

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}

function snapshot(exists, data = {}) {
  return {
    exists,
    data: () => data,
  };
}

function defaultGroup(overrides = {}) {
  return {
    groupId: "group_123",
    ownerUid: "owner_123",
    status: "active",
    stats: {
      memberCount: 4,
    },
    ...overrides,
  };
}

function defaultMembership(
  overrides = {}
) {
  return {
    membershipId:
      "group_123_user_123",
    groupId: "group_123",
    userId: "user_123",
    role: "member",
    status: "active",
    userPseudoSnapshot:
      "Jeremie Snapshot",
    userAvatarSnapshot:
      "https://example.com/snapshot.png",
    ...overrides,
  };
}

function defaultUser(overrides = {}) {
  return {
    pseudo: "Jeremie",
    avatar:
      "https://example.com/avatar.png",
    ...overrides,
  };
}

function createTestEnvironment({
  groupExists = true,
  group = defaultGroup(),
  membershipExists = true,
  membership =
    defaultMembership(),
  userExists = true,
  user = defaultUser(),
} = {}) {
  const writes = [];
  const reads = [];
  const logs = [];
  const references = new Map();

  let generatedActivityCount = 0;
  let receivedRuntime;

  function createReference(
    collectionName,
    id
  ) {
    const path =
      `${collectionName}/${id}`;

    if (references.has(path)) {
      return references.get(path);
    }

    const ref = {
      id,
      path,
    };

    references.set(path, ref);
    return ref;
  }

  const db = {
    collection(collectionName) {
      return {
        doc(id) {
          if (id) {
            return createReference(
              collectionName,
              id
            );
          }

          if (
            collectionName ===
            "groupActivities"
          ) {
            generatedActivityCount += 1;

            return createReference(
              "groupActivities",
              `activity_${generatedActivityCount}`
            );
          }

          throw new Error(
            `AUTO_ID_NOT_SUPPORTED:${collectionName}`
          );
        },
      };
    },

    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          reads.push(ref.path);

          if (
            ref.path ===
            "groups/group_123"
          ) {
            return snapshot(
              groupExists,
              group
            );
          }

          if (
            ref.path ===
            "groupMemberships/group_123_user_123"
          ) {
            return snapshot(
              membershipExists,
              membership
            );
          }

          if (
            ref.path ===
            "users/user_123"
          ) {
            return snapshot(
              userExists,
              user
            );
          }

          throw new Error(
            `UNEXPECTED_READ:${ref.path}`
          );
        },

        update(ref, data) {
          writes.push({
            operation: "update",
            path: ref.path,
            data,
          });
        },

        create(ref, data) {
          writes.push({
            operation: "create",
            path: ref.path,
            data,
          });
        },
      };

      return callback(transaction);
    },
  };

  const FieldValue = {
    serverTimestamp() {
      return {
        __type:
          "server_timestamp",
      };
    },

    increment(value) {
      return {
        __type: "increment",
        value,
      };
    },
  };

  const logger = {
    info(message, metadata) {
      logs.push({
        level: "info",
        message,
        metadata,
      });
    },

    error(message, metadata) {
      logs.push({
        level: "error",
        message,
        metadata,
      });
    },
  };

  const runtime = {
    region: "europe-west1",
  };

  function onCall(options, handler) {
    receivedRuntime = options;
    return handler;
  }

  const callable =
    buildLeaveGroup({
      onCall,
      HttpsError:
        FakeHttpsError,
      runtime,
      db,
      FieldValue,
      logger,
    });

  return {
    callable,
    writes,
    reads,
    logs,
    runtime,
    getReceivedRuntime:
      () => receivedRuntime,
  };
}

async function assertHttpsError(
  promise,
  expectedCode,
  expectedMessage
) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(
        error instanceof
          FakeHttpsError
      );

      assert.equal(
        error.code,
        expectedCode
      );

      assert.equal(
        error.message,
        expectedMessage
      );

      return true;
    }
  );
}

test(
  "buildLeaveGroup transmet le runtime à onCall",
  () => {
    const env =
      createTestEnvironment();

    assert.equal(
      env.getReceivedRuntime(),
      env.runtime
    );
  }
);

test(
  "leaveGroup exige une authentification",
  async () => {
    const env =
      createTestEnvironment();

    await assertHttpsError(
      env.callable({
        data: {
          groupId: "group_123",
        },
      }),
      "unauthenticated",
      "UNAUTHENTICATED"
    );

    assert.equal(
      env.reads.length,
      0
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "leaveGroup refuse un groupe inexistant",
  async () => {
    const env =
      createTestEnvironment({
        groupExists: false,
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
        },
      }),
      "not-found",
      "GROUP_NOT_FOUND"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "leaveGroup refuse un membership inexistant",
  async () => {
    const env =
      createTestEnvironment({
        membershipExists: false,
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
        },
      }),
      "not-found",
      "MEMBERSHIP_NOT_FOUND"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "leaveGroup refuse un groupe inactif",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          status: "archived",
        }),
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
        },
      }),
      "failed-precondition",
      "GROUP_NOT_ACTIVE"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "leaveGroup refuse un membership inactif",
  async () => {
    const env =
      createTestEnvironment({
        membership:
          defaultMembership({
            status: "removed",
          }),
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
        },
      }),
      "failed-precondition",
      "ACTIVE_MEMBERSHIP_REQUIRED"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "leaveGroup refuse le propriétaire",
  async () => {
    const env =
      createTestEnvironment({
        membership:
          defaultMembership({
            role: "owner",
          }),
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
        },
      }),
      "failed-precondition",
      "OWNER_CANNOT_LEAVE_GROUP"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

for (
  const role of [
    "member",
    "admin",
  ]
) {
  test(
    `leaveGroup autorise le rôle ${role}`,
    async () => {
      const env =
        createTestEnvironment({
          membership:
            defaultMembership({
              role,
            }),
        });

      const result =
        await env.callable({
          auth: {
            uid: "user_123",
          },
          data: {
            groupId: "group_123",
          },
        });

      assert.deepEqual(
        result,
        {
          ok: true,
          groupId: "group_123",
          membershipId:
            "group_123_user_123",
          role,
          status: "left",
          activityId:
            "activity_1",
        }
      );

      const membershipWrite =
        env.writes.find(
          (write) =>
            write.operation ===
              "update" &&
            write.path ===
              "groupMemberships/group_123_user_123"
        );

      assert.ok(
        membershipWrite
      );

      assert.equal(
        membershipWrite.data.status,
        "left"
      );

      assert.deepEqual(
        membershipWrite.data.leftAt,
        {
          __type:
            "server_timestamp",
        }
      );

      assert.deepEqual(
        membershipWrite.data.updatedAt,
        {
          __type:
            "server_timestamp",
        }
      );

      assert.equal(
        membershipWrite.data.removedAt,
        null
      );

      assert.equal(
        membershipWrite.data.removedByUid,
        null
      );

      const groupWrite =
        env.writes.find(
          (write) =>
            write.operation ===
              "update" &&
            write.path ===
              "groups/group_123"
        );

      assert.ok(groupWrite);

      assert.deepEqual(
        groupWrite.data[
          "stats.memberCount"
        ],
        {
          __type: "increment",
          value: -1,
        }
      );

      const activityWrite =
        env.writes.find(
          (write) =>
            write.operation ===
              "create" &&
            write.path ===
              "groupActivities/activity_1"
        );

      assert.ok(activityWrite);

      assert.equal(
        activityWrite.data.type,
        "member_left"
      );

      assert.equal(
        activityWrite.data.actorUid,
        "user_123"
      );

      assert.equal(
        activityWrite.data.targetUserId,
        "user_123"
      );

      assert.equal(
        activityWrite.data.actorPseudoSnapshot,
        "Jeremie"
      );

      assert.equal(
        activityWrite.data.actorAvatarSnapshot,
        "https://example.com/avatar.png"
      );

      assert.deepEqual(
        activityWrite.data.metadata,
        {
          membershipId:
            "group_123_user_123",
          previousRole: role,
          previousStatus:
            "active",
          nextStatus:
            "left",
        }
      );
    }
  );
}

test(
  "leaveGroup utilise les snapshots du membership sans profil utilisateur",
  async () => {
    const env =
      createTestEnvironment({
        userExists: false,
      });

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: {
        groupId: "group_123",
      },
    });

    const activityWrite =
      env.writes.find(
        (write) =>
          write.operation ===
            "create" &&
          write.path ===
            "groupActivities/activity_1"
      );

    assert.ok(activityWrite);

    assert.equal(
      activityWrite.data.actorPseudoSnapshot,
      "Jeremie Snapshot"
    );

    assert.equal(
      activityWrite.data.actorAvatarSnapshot,
      "https://example.com/snapshot.png"
    );
  }
);