import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUpdateGroup,
} from "../../updateGroup.js";

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
    name: "Padel Paris",
    nameNormalized: "padel paris",
    description:
      "Groupe pour organiser des parties.",
    ownerUid: "owner_123",
    type: "friends",
    status: "active",
    discoverability: "searchable",
    joinPolicy: "invite_only",
    city: "Paris",
    countryCode: "FR",
    tags: ["paris"],
    levelMin: 3,
    levelMax: 8,
    preferredWeekdays: [2, 5],
    preferredTimeSlots: [
      "evening",
    ],
    settings: {},
    stats: {},
    health: {},
    schemaVersion: 1,
    linkJoinEnabled: false,
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
    role: "owner",
    status: "active",
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
  clubExists = true,
  club = {
    name: "Padel Central",
  },
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

      async create(data) {
        writes.push({
          operation:
            "create-direct",
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

    delete() {
      return {
        __type:
          "delete_field",
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
    buildUpdateGroup({
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
  "buildUpdateGroup transmet le runtime à onCall",
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
  "updateGroup exige une authentification",
  async () => {
    const env =
      createTestEnvironment();

    await assertHttpsError(
      env.callable({
        data: {
          groupId: "group_123",
          name:
            "Nouveau nom",
        },
      }),
      "unauthenticated",
      "UNAUTHENTICATED"
    );

    assert.equal(
      env.writes.length,
      0
    );

    assert.equal(
      env.reads.length,
      0
    );
  }
);

test(
  "updateGroup refuse un groupe inexistant",
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
          name:
            "Nouveau nom",
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
  "updateGroup refuse un membership inexistant",
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
          name:
            "Nouveau nom",
        },
      }),
      "permission-denied",
      "MEMBERSHIP_NOT_FOUND"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "updateGroup refuse un groupe inactif",
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
          name:
            "Nouveau nom",
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
  "updateGroup refuse un membre simple",
  async () => {
    const env =
      createTestEnvironment({
        membership:
          defaultMembership({
            role: "member",
          }),
      });

    await assertHttpsError(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          name:
            "Nouveau nom",
        },
      }),
      "permission-denied",
      "ADMIN_REQUIRED"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "updateGroup refuse un membership non actif",
  async () => {
    const env =
      createTestEnvironment({
        membership:
          defaultMembership({
            role: "admin",
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
          name:
            "Nouveau nom",
        },
      }),
      "permission-denied",
      "ADMIN_REQUIRED"
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);

test(
  "updateGroup autorise un owner et enregistre l'activité",
  async () => {
    const env =
      createTestEnvironment();

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          name:
            "Padel After Work",
          description:
            "  Parties après le travail  ",
          tags: [
            "Paris",
            "After Work",
            "paris",
          ],
          levelMin: 4,
        },
      });

    assert.deepEqual(
      result,
      {
        ok: true,
        groupId: "group_123",
        changedFields: [
          "description",
          "levelMin",
          "name",
          "nameNormalized",
          "tags",
        ],
      }
    );

    assert.deepEqual(
      env.reads.sort(),
      [
        "groupMemberships/group_123_user_123",
        "groups/group_123",
        "users/user_123",
      ].sort()
    );

    assert.equal(
      env.writes.length,
      2
    );

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

    assert.ok(groupWrite);
    assert.ok(activityWrite);

    assert.equal(
      groupWrite.operation,
      "update"
    );

    assert.equal(
      groupWrite.data.name,
      "Padel After Work"
    );

    assert.equal(
      groupWrite.data
        .nameNormalized,
      "padel after work"
    );

    assert.equal(
      groupWrite.data.description,
      "Parties après le travail"
    );

    assert.deepEqual(
      groupWrite.data.tags,
      [
        "paris",
        "after_work",
      ]
    );

    assert.equal(
      groupWrite.data.levelMin,
      4
    );

    assert.deepEqual(
      groupWrite.data.updatedAt,
      {
        __type:
          "server_timestamp",
      }
    );

    assert.equal(
      activityWrite.operation,
      "create"
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
      "group_updated"
    );

    assert.equal(
      activityWrite.data.actorUid,
      "user_123"
    );

    assert.equal(
      activityWrite.data
        .actorPseudoSnapshot,
      "Jeremie"
    );

    assert.equal(
      activityWrite.data
        .actorAvatarSnapshot,
      "https://example.com/avatar.png"
    );

    assert.deepEqual(
      activityWrite.data.metadata,
      {
        changedFields: [
          "description",
          "levelMin",
          "name",
          "nameNormalized",
          "tags",
        ],
      }
    );

    assert.match(
      activityWrite.data
        .deduplicationKey,
      /^group_updated:group_123:\d+$/
    );
  }
);

test(
  "updateGroup autorise un administrateur actif",
  async () => {
    const env =
      createTestEnvironment({
        membership:
          defaultMembership({
            role: "admin",
          }),
      });

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          description:
            "Description modifiée",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    assert.deepEqual(
      result.changedFields,
      ["description"]
    );

    assert.equal(
      env.writes.length,
      2
    );
  }
);

test(
  "updateGroup met à jour linkJoinEnabled avec joinPolicy",
  async () => {
    const env =
      createTestEnvironment();

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          joinPolicy: "link_only",
        },
      });

    assert.deepEqual(
      result.changedFields,
      [
        "joinPolicy",
        "linkJoinEnabled",
      ]
    );

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data.joinPolicy,
      "link_only"
    );

    assert.equal(
      groupWrite.data
        .linkJoinEnabled,
      true
    );
  }
);

test(
  "updateGroup désactive linkJoinEnabled quand joinPolicy change",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          joinPolicy: "link_only",
          linkJoinEnabled: true,
        }),
      });

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: {
        groupId: "group_123",
        joinPolicy: "invite_only",
      },
    });

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data
        .linkJoinEnabled,
      false
    );
  }
);

test(
  "updateGroup récupère le nom du club côté serveur",
  async () => {
    const env =
      createTestEnvironment({
        club: {
          name:
            "  Padel Central Paris  ",
        },
      });

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          type:
            "club_community",
          defaultClubId:
            "club_123",
        },
      });

    assert.deepEqual(
      result.changedFields,
      [
        "defaultClubId",
        "defaultClubNameSnapshot",
        "type",
      ]
    );

    assert.ok(
      env.reads.includes(
        "clubs/club_123"
      )
    );

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data.type,
      "club_community"
    );

    assert.equal(
      groupWrite.data
        .defaultClubId,
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
  "updateGroup conserve un nom de club fourni explicitement",
  async () => {
    const env =
      createTestEnvironment();

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: {
        groupId: "group_123",
        type:
          "club_community",
        defaultClubId:
          "club_123",
        defaultClubNameSnapshot:
          "Nom explicite",
      },
    });

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data
        .defaultClubNameSnapshot,
      "Nom explicite"
    );
  }
);

test(
  "updateGroup refuse un club inexistant",
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
        data: {
          groupId: "group_123",
          type:
            "club_community",
          defaultClubId:
            "club_123",
        },
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
  "updateGroup supprime les champs club en quittant club_community",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          type:
            "club_community",
          defaultClubId:
            "club_123",
          defaultClubNameSnapshot:
            "Padel Central",
        }),
      });

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          type: "friends",
        },
      });

    assert.deepEqual(
      result.changedFields,
      [
        "defaultClubId",
        "defaultClubNameSnapshot",
        "type",
      ]
    );

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data.type,
      "friends"
    );

    assert.deepEqual(
      groupWrite.data
        .defaultClubId,
      {
        __type:
          "delete_field",
      }
    );

    assert.deepEqual(
      groupWrite.data
        .defaultClubNameSnapshot,
      {
        __type:
          "delete_field",
      }
    );
  }
);

test(
  "updateGroup supprime explicitement le club associé",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          type:
            "club_community",
          defaultClubId:
            "club_123",
          defaultClubNameSnapshot:
            "Padel Central",
        }),
      });

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          type: "friends",
          defaultClubId: "",
          defaultClubNameSnapshot:
            "",
        },
      });

    assert.ok(
      result.changedFields.includes(
        "defaultClubId"
      )
    );

    assert.ok(
      result.changedFields.includes(
        "defaultClubNameSnapshot"
      )
    );

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.deepEqual(
      groupWrite.data
        .defaultClubId,
      {
        __type:
          "delete_field",
      }
    );

    assert.deepEqual(
      groupWrite.data
        .defaultClubNameSnapshot,
      {
        __type:
          "delete_field",
      }
    );
  }
);

test(
  "updateGroup supprime les coordonnées quand elles sont vidées",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          discoverability: "hidden",
          latitude: 48.8566,
          longitude: 2.3522,
        }),
      });

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          latitude: null,
          longitude: null,
        },
      });

    assert.deepEqual(
      result.changedFields,
      [
        "latitude",
        "longitude",
      ]
    );

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.deepEqual(
      groupWrite.data.latitude,
      {
        __type:
          "delete_field",
      }
    );

    assert.deepEqual(
      groupWrite.data.longitude,
      {
        __type:
          "delete_field",
      }
    );
  }
);

test(
  "updateGroup conserve de nouvelles coordonnées",
  async () => {
    const env =
      createTestEnvironment();

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: {
        groupId: "group_123",
        latitude: 48.85,
        longitude: 2.35,
      },
    });

    const groupWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groups/group_123"
      );

    assert.equal(
      groupWrite.data.latitude,
      48.85
    );

    assert.equal(
      groupWrite.data.longitude,
      2.35
    );
  }
);

test(
  "updateGroup utilise le fallback Joueur sans profil utilisateur",
  async () => {
    const env =
      createTestEnvironment({
        userExists: false,
      });

    const result =
      await env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          description:
            "Nouvelle description",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    const activityWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groupActivities/activity_1"
      );

    assert.equal(
      activityWrite.data
        .actorPseudoSnapshot,
      "Joueur"
    );

    assert.equal(
      Object.hasOwn(
        activityWrite.data,
        "actorAvatarSnapshot"
      ),
      false
    );
  }
);

test(
  "updateGroup utilise photoUrl comme fallback avatar",
  async () => {
    const env =
      createTestEnvironment({
        user: {
          pseudo: "Jeremie",
          avatar: "",
          photoUrl:
            "https://example.com/photo.png",
        },
      });

    await env.callable({
      auth: {
        uid: "user_123",
      },
      data: {
        groupId: "group_123",
        description:
          "Nouvelle description",
      },
    });

    const activityWrite =
      env.writes.find(
        (write) =>
          write.path ===
          "groupActivities/activity_1"
      );

    assert.equal(
      activityWrite.data
        .actorAvatarSnapshot,
      "https://example.com/photo.png"
    );
  }
);

test(
  "updateGroup mappe une erreur de validation",
  async () => {
    const env =
      createTestEnvironment();

    await assert.rejects(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          name: "",
        },
      }),
      (error) => {
        assert.ok(
          error instanceof
            FakeHttpsError
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
            code:
              "VALUE_TOO_SHORT",
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
  "updateGroup refuse un champ immuable",
  async () => {
    const env =
      createTestEnvironment();

    await assert.rejects(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
          ownerUid:
            "other_user",
        },
      }),
      (error) => {
        assert.equal(
          error.code,
          "invalid-argument"
        );

        assert.equal(
          error.message,
          "IMMUTABLE_FIELD"
        );

        assert.deepEqual(
          error.details,
          {
            field: "ownerUid",
            code:
              "IMMUTABLE_FIELD",
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
  "updateGroup refuse une mise à jour vide",
  async () => {
    const env =
      createTestEnvironment();

    await assert.rejects(
      env.callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId: "group_123",
        },
      }),
      (error) => {
        assert.equal(
          error.code,
          "invalid-argument"
        );

        assert.equal(
          error.message,
          "EMPTY_UPDATE"
        );

        assert.deepEqual(
          error.details,
          {
            field: "payload",
            code:
              "EMPTY_UPDATE",
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
  "updateGroup mappe une erreur interne inconnue",
  async () => {
    const env =
      createTestEnvironment();

    env.callable;

    const brokenEnvironment =
      createTestEnvironment();

    const originalCallable =
      brokenEnvironment.callable;

    await assertHttpsError(
      originalCallable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId:
            "invalid/group/id",
          name:
            "Nouveau nom",
        },
      }),
      "invalid-argument",
      "INVALID_GROUP_ID"
    );
  }
);
