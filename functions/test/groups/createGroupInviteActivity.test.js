import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreateGroupInvite,
} from "../../createGroupInvite.js";

class FakeHttpsError extends Error {
  constructor(
    code,
    message,
    details
  ) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}

function snapshot(
  exists,
  data = {}
) {
  return {
    exists,
    data: () => data,
  };
}

function querySnapshot(
  docs = []
) {
  return {
    empty: docs.length === 0,
    docs,
  };
}

function createEnvironment({
  failTransaction = false,
} = {}) {
  const writes = [];
  const references =
    new Map();

  let autoIds = {
    groupInvites: 0,
    groupActivities: 0,
    userActivities: 0,
  };

  function ref(
    collectionName,
    id
  ) {
    const path =
      `${collectionName}/${id}`;

    if (references.has(path)) {
      return references.get(path);
    }

    const value = {
      id,
      path,
    };

    references.set(
      path,
      value
    );

    return value;
  }

  const db = {
    collection(
      collectionName
    ) {
      return {
        doc(id) {
          if (id) {
            return ref(
              collectionName,
              id
            );
          }

          if (
            Object.hasOwn(
              autoIds,
              collectionName
            )
          ) {
            autoIds[
              collectionName
            ] += 1;

            return ref(
              collectionName,
              `${collectionName}_auto_${autoIds[collectionName]}`
            );
          }

          throw new Error(
            `AUTO_ID_NOT_SUPPORTED:${collectionName}`
          );
        },

        where() {
          return this;
        },

        limit() {
          return this;
        },
      };
    },

    async runTransaction(
      callback
    ) {
      if (failTransaction) {
        throw new Error(
          "FORCED_TRANSACTION_FAILURE"
        );
      }

      const transaction = {
        async get(reference) {
          switch (
            reference.path
          ) {
            case "groups/group_123":
              return snapshot(
                true,
                {
                  name:
                    "Padel Paris",
                  status:
                    "active",
                  settings: {
                    canMembersInvitePlayers:
                      true,
                  },
                }
              );

            case "users/owner_123":
              return snapshot(
                true,
                {
                  pseudo:
                    "Jeremie",
                  avatar:
                    "https://example.com/jeremie.jpg",
                }
              );

            case "users/target_123":
              return snapshot(
                true,
                {
                  pseudo:
                    "Sam",
                  niveau: 6,
                }
              );

            case "groupMemberships/group_123_owner_123":
              return snapshot(
                true,
                {
                  groupId:
                    "group_123",
                  userId:
                    "owner_123",
                  role:
                    "owner",
                  status:
                    "active",
                }
              );

            case "groupMemberships/group_123_target_123":
              return snapshot(
                false
              );

            default:
              // pending invite query
              if (
                reference
                && typeof reference
                  .empty ===
                  "boolean"
              ) {
                return reference;
              }

              // Firestore query mock
              if (
                reference
                && typeof reference
                  .where ===
                  "function"
              ) {
                return querySnapshot();
              }

              throw new Error(
                `UNEXPECTED_READ:${reference.path}`
              );
          }
        },

        create(
          reference,
          data
        ) {
          writes.push({
            operation:
              "create",
            path:
              reference.path,
            data,
          });
        },
      };

      /*
       * createGroupInvite fait aussi transaction.get()
       * sur une Query. Notre mock collection.where(...)
       * renvoie un objet query ; on lui fournit ici
       * le snapshot vide attendu.
       */
      const originalGet =
        transaction.get;

      transaction.get =
        async (
          reference
        ) => {
          if (
            reference
            && reference
              .__pendingInviteQuery
          ) {
            return querySnapshot();
          }

          try {
            return await originalGet(
              reference
            );
          } catch (error) {
            if (
              String(
                error.message
              ).startsWith(
                "UNEXPECTED_READ:undefined"
              )
            ) {
              return querySnapshot();
            }

            throw error;
          }
        };

      return callback(
        transaction
      );
    },
  };

  /*
   * Recrée un minimum de Query Firestore.
   */
  const originalCollection =
    db.collection;

  db.collection =
    function (
      collectionName
    ) {
      const collection =
        originalCollection.call(
          db,
          collectionName
        );

      collection.where =
        function () {
          const query = {
            __pendingInviteQuery:
              true,

            where() {
              return this;
            },

            limit() {
              return this;
            },
          };

          return query;
        };

      return collection;
    };

  function onCall(
    _runtime,
    handler
  ) {
    return handler;
  }

  async function tokensOf() {
    return [];
  }

  async function sendVisibleHybrid() {}

  const logger = {
    info() {},
    warn() {},
    error() {},
  };

  const callable =
    buildCreateGroupInvite({
      onCall,
      HttpsError:
        FakeHttpsError,
      runtime: {
        region:
          "europe-west1",
      },
      db,
      logger,
      tokensOf,
      sendVisibleHybrid,
    });

  return {
    callable,
    writes,
  };
}

test(
  "createGroupInvite creates personal user activity in same transaction",
  async () => {
    const env =
      createEnvironment();

    const result =
      await env.callable({
        auth: {
          uid:
            "owner_123",
        },
        data: {
          groupId:
            "group_123",
          targetUserId:
            "target_123",
          source:
            "internal_search",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    const inviteWrite =
      env.writes.find(
        (write) =>
          write.path.startsWith(
            "groupInvites/"
          )
      );

    const groupActivityWrite =
      env.writes.find(
        (write) =>
          write.path.startsWith(
            "groupActivities/"
          )
      );

    const userActivityWrite =
      env.writes.find(
        (write) =>
          write.path.startsWith(
            "userActivities/"
          )
      );

    assert.ok(
      inviteWrite,
      "group invite missing"
    );

    assert.ok(
      groupActivityWrite,
      "group activity missing"
    );

    assert.ok(
      userActivityWrite,
      "user activity missing"
    );

    assert.equal(
      userActivityWrite
        .data
        .userId,
      "target_123"
    );

    assert.equal(
      userActivityWrite
        .data
        .type,
      "group_invite_received"
    );

    assert.equal(
      userActivityWrite
        .data
        .entityType,
      "invitation"
    );

    assert.equal(
      userActivityWrite
        .data
        .entityId,
      inviteWrite.data.inviteId
    );

    assert.equal(
      userActivityWrite
        .data
        .inviteId,
      inviteWrite.data.inviteId
    );

    assert.equal(
      userActivityWrite
        .data
        .groupId,
      "group_123"
    );

    assert.equal(
      userActivityWrite
        .data
        .actorUid,
      "owner_123"
    );

    assert.equal(
      userActivityWrite
        .data
        .actorPseudoSnapshot,
      "Jeremie"
    );

    assert.equal(
      userActivityWrite
        .data
        .sourceType,
      "group_activity"
    );

    assert.equal(
      userActivityWrite
        .data
        .sourceId,
      groupActivityWrite
        .path
        .split("/")
        .at(-1)
    );

    assert.equal(
      userActivityWrite
        .data
        .readAt,
      null
    );

    assert.equal(
      env.writes.filter(
        (write) =>
          write.path.startsWith(
            "userActivities/"
          )
      ).length,
      1
    );
  }
);

test(
  "createGroupInvite does not write user activity when transaction fails",
  async () => {
    const env =
      createEnvironment({
        failTransaction:
          true,
      });

    await assert.rejects(
      env.callable({
        auth: {
          uid:
            "owner_123",
        },
        data: {
          groupId:
            "group_123",
          targetUserId:
            "target_123",
          source:
            "internal_search",
        },
      })
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);
