import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeleteGroup,
} from "../../deleteGroup.js";

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}

function snapshot(
  exists,
  data = {},
  ref = null
) {
  return {
    exists,
    ref,
    data: () => data,
  };
}

function defaultGroup(overrides = {}) {
  return {
    groupId: "group_123",
    ownerUid: "user_123",
    name: "Padel Paris",
    status: "active",
    discoverability: "searchable",
    linkJoinEnabled: true,
    stats: {
      memberCount: 3,
    },
    ...overrides,
  };
}

function defaultOwnerMembership(
  overrides = {}
) {
  return {
    membershipId:
      "group_123_user_123",
    groupId: "group_123",
    userId: "user_123",
    role: "owner",
    status: "active",
    notificationsEnabled: true,
    matchNotificationsEnabled: true,
    messageNotificationsEnabled: true,
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

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function createTestEnvironment({
  groupExists = true,
  group = defaultGroup(),

  membershipExists = true,
  membership =
    defaultOwnerMembership(),

  userExists = true,
  user = defaultUser(),

  memberships = [
    {
      id: "group_123_member_456",
      data: {
        membershipId:
          "group_123_member_456",
        groupId: "group_123",
        userId: "member_456",
        role: "member",
        status: "active",
        notificationsEnabled: true,
        matchNotificationsEnabled: true,
        messageNotificationsEnabled: true,
      },
    },
    {
      id: "group_123_admin_789",
      data: {
        membershipId:
          "group_123_admin_789",
        groupId: "group_123",
        userId: "admin_789",
        role: "admin",
        status: "active",
        notificationsEnabled: true,
        matchNotificationsEnabled: true,
        messageNotificationsEnabled: true,
      },
    },
  ],

  invites = [
    {
      id: "invite_1",
      data: {
        inviteId: "invite_1",
        groupId: "group_123",
        status: "pending",
      },
    },
    {
      id: "invite_accepted",
      data: {
        inviteId:
          "invite_accepted",
        groupId: "group_123",
        status: "accepted",
      },
    },
  ],

  joinRequests = [
    {
      id: "request_1",
      data: {
        requestId: "request_1",
        groupId: "group_123",
        status: "pending",
      },
    },
    {
      id: "request_rejected",
      data: {
        requestId:
          "request_rejected",
        groupId: "group_123",
        status: "rejected",
      },
    },
  ],

  notificationQueue = [
    {
      id: "queue_1",
      data: {
        groupId: "group_123",
        recipientUid: "member_456",
        status: "pending",
      },
    },
    {
      id: "queue_other_group",
      data: {
        groupId: "other_group",
        recipientUid: "user_999",
        status: "pending",
      },
    },
  ],
} = {}) {
  const writes = [];
  const reads = [];
  const logs = [];

  const collections = {
    groups: new Map(),
    groupMemberships: new Map(),
    users: new Map(),
    groupInvites: new Map(),
    groupJoinRequests: new Map(),
    groupChatNotificationQueue:
      new Map(),
    groupActivities: new Map(),
  };

  if (groupExists) {
    collections.groups.set(
      "group_123",
      clone(group)
    );
  }

  if (membershipExists) {
    collections.groupMemberships.set(
      "group_123_user_123",
      clone(membership)
    );
  }

  for (const item of memberships) {
    collections.groupMemberships.set(
      item.id,
      clone(item.data)
    );
  }

  if (userExists) {
    collections.users.set(
      "user_123",
      clone(user)
    );
  }

  for (const item of invites) {
    collections.groupInvites.set(
      item.id,
      clone(item.data)
    );
  }

  for (const item of joinRequests) {
    collections.groupJoinRequests.set(
      item.id,
      clone(item.data)
    );
  }

  for (const item of notificationQueue) {
    collections
      .groupChatNotificationQueue
      .set(
        item.id,
        clone(item.data)
      );
  }

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

    const reference = {
      id,
      path,
      collectionName,
    };

    references.set(
      path,
      reference
    );

    return reference;
  }

  function getDocumentData(ref) {
    return collections[
      ref.collectionName
    ]?.get(ref.id);
  }

  function setDocumentData(
    ref,
    data,
    merge = true
  ) {
    const collection =
      collections[
        ref.collectionName
      ];

    const current =
      collection.get(ref.id) ?? {};

    collection.set(
      ref.id,
      merge
        ? {
            ...current,
            ...data,
          }
        : {
            ...data,
          }
    );
  }

  function updateDocumentData(
    ref,
    data
  ) {
    const collection =
      collections[
        ref.collectionName
      ];

    const current = {
      ...(collection.get(ref.id) ?? {}),
    };

    for (
      const [rawField, value]
      of Object.entries(data)
    ) {
      const fieldParts =
        rawField.split(".");

      let target = current;

      for (
        let index = 0;
        index < fieldParts.length - 1;
        index += 1
      ) {
        const field =
          fieldParts[index];

        const existing =
          target[field];

        target[field] =
          existing
          && typeof existing === "object"
          && !Array.isArray(existing)
            ? {
                ...existing,
              }
            : {};

        target =
          target[field];
      }

      target[
        fieldParts[
          fieldParts.length - 1
        ]
      ] = value;
    }

    collection.set(
      ref.id,
      current
    );
  }

  function deleteDocument(ref) {
    collections[
      ref.collectionName
    ]?.delete(ref.id);
  }

  function createQuery(
    collectionName,
    filters = [],
    queryLimit = null
  ) {
    return {
      where(
        field,
        operator,
        expectedValue
      ) {
        assert.equal(
          operator,
          "=="
        );

        return createQuery(
          collectionName,
          [
            ...filters,
            {
              field,
              expectedValue,
            },
          ],
          queryLimit
        );
      },

      limit(value) {
        return createQuery(
          collectionName,
          filters,
          value
        );
      },

      async get() {
        const collection =
          collections[collectionName];

        let documents =
          Array.from(
            collection.entries()
          )
          .filter(([, data]) =>
            filters.every(
              ({
                field,
                expectedValue,
              }) =>
                data[field] ===
                  expectedValue
            )
          )
          .map(([id, data]) => {
            const ref =
              createReference(
                collectionName,
                id
              );

            return {
              id,
              ref,
              data: () => ({
                ...data,
              }),
            };
          });

        if (
          Number.isInteger(queryLimit)
        ) {
          documents =
            documents.slice(
              0,
              queryLimit
            );
        }

        return {
          docs: documents,
          size: documents.length,
          empty:
            documents.length === 0,
        };
      },
    };
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
              collectionName,
              `activity_${generatedActivityCount}`
            );
          }

          throw new Error(
            `AUTO_ID_NOT_SUPPORTED:${collectionName}`
          );
        },

        where(
          field,
          operator,
          expectedValue
        ) {
          return createQuery(
            collectionName
          ).where(
            field,
            operator,
            expectedValue
          );
        },
      };
    },

    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          reads.push(ref.path);

          const data =
            getDocumentData(ref);

          return snapshot(
            data !== undefined,
            data ?? {},
            ref
          );
        },

        update(ref, data) {
          writes.push({
            operation:
              "transaction-update",
            path: ref.path,
            data,
          });

          updateDocumentData(
            ref,
            data
          );
        },

        create(ref, data) {
          writes.push({
            operation:
              "transaction-create",
            path: ref.path,
            data,
          });

          if (
            getDocumentData(ref) !==
            undefined
          ) {
            throw new Error(
              `DOCUMENT_ALREADY_EXISTS:${ref.path}`
            );
          }

          setDocumentData(
            ref,
            data,
            false
          );
        },

        set(ref, data, options) {
          writes.push({
            operation:
              "transaction-set",
            path: ref.path,
            data,
            options,
          });

          setDocumentData(
            ref,
            data,
            options?.merge === true
          );
        },

        delete(ref) {
          writes.push({
            operation:
              "transaction-delete",
            path: ref.path,
          });

          deleteDocument(ref);
        },
      };

      return callback(transaction);
    },

    batch() {
      const operations = [];

      return {
        update(ref, data) {
          operations.push({
            operation:
              "batch-update",
            ref,
            data,
          });
        },

        delete(ref) {
          operations.push({
            operation:
              "batch-delete",
            ref,
          });
        },

        async commit() {
          for (
            const operation
            of operations
          ) {
            writes.push({
              operation:
                operation.operation,
              path:
                operation.ref.path,
              data:
                operation.data,
            });

            if (
              operation.operation ===
              "batch-update"
            ) {
              updateDocumentData(
                operation.ref,
                operation.data
              );
            } else {
              deleteDocument(
                operation.ref
              );
            }
          }
        },
      };
    },
  };

  const FieldValue = {
    serverTimestamp() {
      return {
        __type:
          "server_timestamp",
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
    buildDeleteGroup({
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
    collections,
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

function callableRequest({
  uid = "user_123",
  groupId = "group_123",
} = {}) {
  return {
    auth: uid
      ? {
          uid,
        }
      : undefined,

    data: {
      groupId,
    },
  };
}

test(
  "buildDeleteGroup transmet le runtime à onCall",
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
  "deleteGroup exige une authentification",
  async () => {
    const env =
      createTestEnvironment();

    await assertHttpsError(
      env.callable(
        callableRequest({
          uid: null,
        })
      ),
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
  "deleteGroup refuse un groupe inexistant",
  async () => {
    const env =
      createTestEnvironment({
        groupExists: false,
      });

    await assertHttpsError(
      env.callable(
        callableRequest()
      ),
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
  "deleteGroup refuse un membership inexistant",
  async () => {
    const env =
      createTestEnvironment({
        membershipExists: false,
      });

    await assertHttpsError(
      env.callable(
        callableRequest()
      ),
      "not-found",
      "MEMBERSHIP_NOT_FOUND"
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
    `deleteGroup refuse le rôle ${role}`,
    async () => {
      const env =
        createTestEnvironment({
          membership:
            defaultOwnerMembership({
              role,
            }),
        });

      await assertHttpsError(
        env.callable(
          callableRequest()
        ),
        "permission-denied",
        "OWNER_REQUIRED"
      );

      assert.equal(
        env.writes.length,
        0
      );
    }
  );
}

test(
  "deleteGroup refuse un groupe archivé",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          status: "archived",
        }),
      });

    await assertHttpsError(
      env.callable(
        callableRequest()
      ),
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
  "deleteGroup supprime logiquement le groupe et nettoie ses dépendances",
  async () => {
    const env =
      createTestEnvironment();

    const result =
      await env.callable(
        callableRequest()
      );

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.groupId,
      "group_123"
    );

    assert.equal(
      result.status,
      "deleted"
    );

    assert.equal(
      result.activityId,
      "activity_1"
    );

    assert.equal(
      result.resumedCleanup,
      false
    );

    assert.deepEqual(
      result.cleanup,
      {
        membershipsUpdated: 2,
        invitationsRevoked: 1,
        joinRequestsCancelled: 1,
        notificationQueueDeleted: 1,
      }
    );

    const group =
      env.collections.groups.get(
        "group_123"
      );

    assert.equal(
      group.status,
      "deleted"
    );

    assert.equal(
      group.deletedByUid,
      "user_123"
    );

    assert.deepEqual(
      group.deletedAt,
      {
        __type:
          "server_timestamp",
      }
    );

    assert.equal(
      group.discoverability,
      "hidden"
    );

    assert.equal(
      group.linkJoinEnabled,
      false
    );

    assert.equal(
      group.stats.memberCount,
      0
    );

    assert.equal(
      group.deleteActivityId,
      "activity_1"
    );

    const ownerMembership =
      env.collections
        .groupMemberships
        .get(
          "group_123_user_123"
        );

    assert.equal(
      ownerMembership.status,
      "removed"
    );

    assert.equal(
      ownerMembership.removedByUid,
      "user_123"
    );

    assert.equal(
      ownerMembership.notificationsEnabled,
      false
    );

    assert.equal(
      ownerMembership.matchNotificationsEnabled,
      false
    );

    assert.equal(
      ownerMembership.messageNotificationsEnabled,
      false
    );

    for (
      const membershipId of [
        "group_123_member_456",
        "group_123_admin_789",
      ]
    ) {
      const membership =
        env.collections
          .groupMemberships
          .get(membershipId);

      assert.equal(
        membership.status,
        "removed"
      );

      assert.equal(
        membership.removedByUid,
        "user_123"
      );

      assert.equal(
        membership.notificationsEnabled,
        false
      );
    }

    const pendingInvite =
      env.collections
        .groupInvites
        .get("invite_1");

    assert.equal(
      pendingInvite.status,
      "revoked"
    );

    assert.equal(
      pendingInvite.statusChangedByUid,
      "user_123"
    );

    assert.equal(
      env.collections
        .groupInvites
        .get("invite_accepted")
        .status,
      "accepted"
    );

    assert.equal(
      env.collections
        .groupJoinRequests
        .get("request_1")
        .status,
      "cancelled"
    );

    assert.equal(
      env.collections
        .groupJoinRequests
        .get("request_rejected")
        .status,
      "rejected"
    );

    assert.equal(
      env.collections
        .groupChatNotificationQueue
        .has("queue_1"),
      false
    );

    assert.equal(
      env.collections
        .groupChatNotificationQueue
        .has("queue_other_group"),
      true
    );

    const activity =
      env.collections
        .groupActivities
        .get("activity_1");

    assert.equal(
      activity.type,
      "group_deleted"
    );

    assert.equal(
      activity.actorUid,
      "user_123"
    );

    assert.equal(
      activity.actorPseudoSnapshot,
      "Jeremie"
    );

    assert.deepEqual(
      activity.metadata,
      {
        previousStatus: "active",
        nextStatus: "deleted",
        ownerMembershipId:
          "group_123_user_123",
      }
    );
  }
);

test(
  "deleteGroup reprend le nettoyage sans recréer l'activité",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          status: "deleted",
          deletedByUid: "user_123",
          deleteActivityId:
            "existing_activity",
        }),

        membership:
          defaultOwnerMembership({
            status: "removed",
            removedByUid:
              "user_123",
          }),
      });

    const result =
      await env.callable(
        callableRequest()
      );

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.resumedCleanup,
      true
    );

    assert.equal(
      result.activityId,
      "existing_activity"
    );

    const createdActivities =
      env.writes.filter(
        (write) =>
          write.operation ===
            "transaction-create" &&
          write.path.startsWith(
            "groupActivities/"
          )
      );

    assert.equal(
      createdActivities.length,
      0
    );

    const groupUpdates =
      env.writes.filter(
        (write) =>
          write.operation ===
            "transaction-update" &&
          write.path ===
            "groups/group_123"
      );

    assert.equal(
      groupUpdates.length,
      0
    );

    assert.equal(
      result.cleanup
        .membershipsUpdated,
      2
    );

    assert.equal(
      result.cleanup
        .invitationsRevoked,
      1
    );

    assert.equal(
      result.cleanup
        .joinRequestsCancelled,
      1
    );

    assert.equal(
      result.cleanup
        .notificationQueueDeleted,
      1
    );
  }
);

test(
  "deleteGroup refuse la reprise par un autre utilisateur",
  async () => {
    const env =
      createTestEnvironment({
        group: defaultGroup({
          status: "deleted",
          deletedByUid:
            "another_owner",
        }),

        membership:
          defaultOwnerMembership({
            status: "removed",
          }),
      });

    await assertHttpsError(
      env.callable(
        callableRequest()
      ),
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
  "deleteGroup utilise les snapshots du membership sans profil utilisateur",
  async () => {
    const env =
      createTestEnvironment({
        userExists: false,
      });

    const result =
      await env.callable(
        callableRequest()
      );

    assert.equal(
      result.ok,
      true
    );

    const activity =
      env.collections
        .groupActivities
        .get("activity_1");

    assert.equal(
      activity.actorPseudoSnapshot,
      "Jeremie Snapshot"
    );

    assert.equal(
      activity.actorAvatarSnapshot,
      "https://example.com/snapshot.png"
    );
  }
);
