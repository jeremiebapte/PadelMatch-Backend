import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreateGroup,
} from "../../createGroup.js";

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

function createTestEnvironment({
  userExists = true,
  user = {
    pseudo: "Jeremie",
    avatar: "https://example.com/avatar.png",
    niveau: 6,
  },
  membershipExists = false,
  clubExists = true,
  club = {
    name: "Padel Central",
  },
} = {}) {
  const writes = [];
  const logs = [];
  let generatedActivityCount = 0;

  const references = new Map();

  function createReference(collectionName, id) {
    const path = `${collectionName}/${id}`;

    if (references.has(path)) {
      return references.get(path);
    }

    const ref = {
      id,
      path,

      async create(data) {
        writes.push({
          operation: "create-direct",
          path,
          data,
        });
      },
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

          if (collectionName === "groups") {
            return createReference(
              "groups",
              "group_123"
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
          if (ref.path === "users/user_123") {
            return snapshot(
              userExists,
              user
            );
          }

          if (
            ref.path ===
            "groupMemberships/group_123_user_123"
          ) {
            return snapshot(
              membershipExists
            );
          }

          if (
            ref.path ===
            "clubs/club_123"
          ) {
            return snapshot(
              clubExists,
              club
            );
          }

          throw new Error(
            `UNEXPECTED_READ:${ref.path}`
          );
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
        __type: "server_timestamp",
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

  let receivedRuntime;

  function onCall(options, handler) {
    receivedRuntime = options;
    return handler;
  }

  const callable = buildCreateGroup({
    onCall,
    HttpsError: FakeHttpsError,
    runtime,
    db,
    FieldValue,
    logger,
  });

  return {
    callable,
    writes,
    logs,
    runtime,
    getReceivedRuntime:
      () => receivedRuntime,
  };
}

function validPayload(overrides = {}) {
  return {
    name: "Padel Paris",
    description:
      "Groupe pour organiser des parties.",
    type: "friends",
    discoverability: "searchable",
    joinPolicy: "invite_only",
    city: "Paris",
    countryCode: "fr",
    tags: [
      "Paris",
      "After Work",
      "paris",
    ],
    levelMin: 3,
    levelMax: 8,
    preferredWeekdays: [5, 2, 5],
    preferredTimeSlots: [
      "evening",
      "late_evening",
    ],
    createdBySource: "IOS",
    ...overrides,
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
        error instanceof FakeHttpsError
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
  "buildCreateGroup transmet le runtime à onCall",
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
  "createGroup exige une authentification",
  async () => {
    const env =
      createTestEnvironment();

    await assertHttpsError(
      env.callable({
        data: validPayload(),
      }),
      "unauthenticated",
      "UNAUTHENTICATED"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "createGroup crée atomiquement le groupe, le owner membership et l'activité",
  async () => {
    const env =
      createTestEnvironment();

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: validPayload(),
      });

    assert.deepEqual(result, {
      ok: true,
      groupId: "group_123",
      membershipId:
        "group_123_user_123",
    });

    assert.equal(
      env.writes.length,
      3
    );

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    const membershipWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groupMemberships/group_123_user_123"
      );

    const activityWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groupActivities/activity_1"
      );

    assert.ok(groupWrite);
    assert.ok(membershipWrite);
    assert.ok(activityWrite);

    assert.equal(
      groupWrite.operation,
      "create"
    );

    assert.equal(
      groupWrite.data.groupId,
      "group_123"
    );

    assert.equal(
      groupWrite.data.ownerUid,
      "user_123"
    );

    assert.equal(
      groupWrite.data.name,
      "Padel Paris"
    );

    assert.equal(
      groupWrite.data.nameNormalized,
      "padel paris"
    );

    assert.equal(
      groupWrite.data.countryCode,
      "FR"
    );

    assert.deepEqual(
      groupWrite.data.tags,
      [
        "paris",
        "after_work",
      ]
    );

    assert.deepEqual(
      groupWrite.data.preferredWeekdays,
      [2, 5]
    );

    assert.equal(
      groupWrite.data.createdBySource,
      "ios"
    );

    assert.equal(
      groupWrite.data.linkJoinEnabled,
      false
    );

    assert.equal(
      groupWrite.data.inviteCodeVersion,
      1
    );

    assert.ok(
      groupWrite.data.settings
    );

    assert.ok(
      groupWrite.data.stats
    );

    assert.ok(
      groupWrite.data.health
    );

    assert.deepEqual(
      groupWrite.data.createdAt,
      {
        __type: "server_timestamp",
      }
    );

    assert.deepEqual(
      groupWrite.data.updatedAt,
      {
        __type: "server_timestamp",
      }
    );

    assert.equal(
      membershipWrite.data.membershipId,
      "group_123_user_123"
    );

    assert.equal(
      membershipWrite.data.groupId,
      "group_123"
    );

    assert.equal(
      membershipWrite.data.userId,
      "user_123"
    );

    assert.equal(
      membershipWrite.data.role,
      "owner"
    );

    assert.equal(
      membershipWrite.data.status,
      "active"
    );

    assert.equal(
      membershipWrite.data.source,
      "group_creator"
    );

    assert.equal(
      membershipWrite.data.userPseudoSnapshot,
      "Jeremie"
    );

    assert.equal(
      activityWrite.data.activityId,
      "activity_1"
    );

    assert.equal(
      activityWrite.data.groupId,
      "group_123"
    );

    assert.equal(
      activityWrite.data.type,
      "group_created"
    );

    assert.equal(
      activityWrite.data.actorUid,
      "user_123"
    );

    assert.equal(
      activityWrite.data.actorPseudoSnapshot,
      "Jeremie"
    );

    assert.equal(
      activityWrite.data.deduplicationKey,
      "group_created:group_123"
    );

    assert.deepEqual(
      activityWrite.data.metadata,
      {
        groupType: "friends",
        discoverability:
          "searchable",
        joinPolicy: "invite_only",
        createdBySource: "ios",
      }
    );
  }
);

test(
  "createGroup active linkJoinEnabled pour link_only",
  async () => {
    const env =
      createTestEnvironment();

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: validPayload({
        discoverability: "hidden",
        joinPolicy: "link_only",
        city: "",
      }),
    });

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data.linkJoinEnabled,
      true
    );
  }
);

test(
  "createGroup récupère le nom du club côté serveur",
  async () => {
    const env =
      createTestEnvironment({
        club: {
          name:
            "  Padel Central Paris  ",
        },
      });

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: validPayload({
        type: "club_community",
        defaultClubId: "club_123",
      }),
    });

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data.defaultClubId,
      "club_123"
    );

    assert.equal(
      groupWrite.data
        .defaultClubNameSnapshot,
      "Padel Central Paris"
    );
  }
);

test(
  "createGroup refuse un profil utilisateur inexistant",
  async () => {
    const env =
      createTestEnvironment({
        userExists: false,
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: validPayload(),
      }),
      "failed-precondition",
      "USER_PROFILE_NOT_FOUND"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "createGroup refuse un membership déjà existant",
  async () => {
    const env =
      createTestEnvironment({
        membershipExists: true,
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: validPayload(),
      }),
      "already-exists",
      "MEMBERSHIP_ALREADY_EXISTS"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "createGroup refuse un club inexistant",
  async () => {
    const env =
      createTestEnvironment({
        clubExists: false,
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: validPayload({
          type: "club_community",
          defaultClubId: "club_123",
        }),
      }),
      "not-found",
      "CLUB_NOT_FOUND"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "createGroup mappe les erreurs de validation",
  async () => {
    const env =
      createTestEnvironment();

    await assert.rejects(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: validPayload({
          name: "",
        }),
      }),
      (error) => {
        assert.ok(
          error instanceof FakeHttpsError
        );

        assert.equal(
          error.code,
          "invalid-argument"
        );

        assert.equal(
          error.message,
          "VALUE_TOO_SHORT"
        );

        assert.deepEqual(
          error.details,
          {
            field: "name",
            code: "VALUE_TOO_SHORT",
          }
        );

        return true;
      }
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "createGroup ignore une source de création non autorisée",
  async () => {
    const env =
      createTestEnvironment();

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: validPayload({
        createdBySource:
          "untrusted-client",
      }),
    });

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    const activityWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groupActivities/activity_1"
      );

    assert.equal(
      Object.hasOwn(
        groupWrite.data,
        "createdBySource"
      ),
      false
    );

    assert.equal(
      activityWrite.data.metadata
        .createdBySource,
      "unknown"
    );
  }
);
