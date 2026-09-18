import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProcessMatchDistributionEvent,
} from "../MatchDistributionEffectService.js";


function clone(value) {
  return structuredClone(value);
}


function makeDb({
  eventType = "group_distribution_added",
  eventId = "match_distribution__match_1__group_B",
  groupId = "group_B",
} = {}) {
  const docs =
    new Map();

  const creates = [];
  const updates = [];

  const key = (collection, id) =>
    `${collection}/${id}`;

  docs.set(
    key(
      "matchDistributionEvents",
      eventId
    ),
    {
      eventId,

      type:
        eventType,

      status:
        "pending",

      matchId:
        "match_1",

      groupId,

      actorUid:
        "user_A",

      creatorProfile: {
        pseudo:
          "Jeremie",
      },

      matchSnapshot: {
        lieu:
          "Padel Club",

        dateHeure:
          123456789,
      },

      createdAt:
        1000,
    }
  );

  docs.set(
    key(
      "groups",
      "group_B"
    ),
    {
      status:
        "active",

      stats: {},
    }
  );

  const makeRef =
    (collectionName, id) => ({
      collectionName,
      id,

      async get() {
        const value =
          docs.get(
            key(
              collectionName,
              id
            )
          );

        return {
          exists:
            value !== undefined,

          data: () =>
            value === undefined
              ? undefined
              : clone(value),
        };
      },

      async set(value, options = {}) {
        const current =
          docs.get(
            key(
              collectionName,
              id
            )
          )
          || {};

        docs.set(
          key(
            collectionName,
            id
          ),
          options.merge
            ? {
                ...current,
                ...clone(value),
              }
            : clone(value)
        );
      },
    });

  const db = {
    collection(name) {
      return {
        doc(id) {
          return makeRef(
            name,
            id
          );
        },
      };
    },

    async runTransaction(handler) {
      const pending = [];

      const tx = {
        async get(ref) {
          return ref.get();
        },

        create(ref, value) {
          pending.push(() => {
            const docKey =
              key(
                ref.collectionName,
                ref.id
              );

            if (
              docs.has(docKey)
            ) {
              throw new Error(
                "ALREADY_EXISTS"
              );
            }

            docs.set(
              docKey,
              clone(value)
            );

            creates.push({
              collection:
                ref.collectionName,

              id:
                ref.id,
            });
          });
        },

        update(ref, value) {
          pending.push(() => {
            const docKey =
              key(
                ref.collectionName,
                ref.id
              );

            const current =
              docs.get(docKey);

            if (!current) {
              throw new Error(
                "NOT_FOUND"
              );
            }

            docs.set(
              docKey,
              {
                ...current,
                ...clone(value),
              }
            );

            updates.push({
              collection:
                ref.collectionName,

              id:
                ref.id,

              value:
                clone(value),
            });
          });
        },

        set(ref, value, options = {}) {
          pending.push(() => {
            const docKey =
              key(
                ref.collectionName,
                ref.id
              );

            const current =
              docs.get(docKey)
              || {};

            docs.set(
              docKey,
              options.merge
                ? {
                    ...current,
                    ...clone(value),
                  }
                : clone(value)
            );
          });
        },
      };

      const result =
        await handler(tx);

      for (
        const operation
        of pending
      ) {
        operation();
      }

      return result;
    },

    creates,
    updates,

    get(collection, id) {
      return docs.get(
        key(
          collection,
          id
        )
      );
    },
  };

  return db;
}


const FieldValue = {
  serverTimestamp() {
    return Date.now();
  },

  increment(value) {
    return {
      increment:
        value,
    };
  },
};


test(
  "distribution event applies core effects once and does not duplicate on retry",
  async () => {
    const db =
      makeDb();

    const notifications = [];

    const processor =
      buildProcessMatchDistributionEvent({
        db,
        FieldValue,
        logger: {},

        notifyGroupMatchCreated:
          async (payload) => {
            notifications.push(
              payload
            );
          },
      });

    const event = {
      params: {
        eventId:
          "match_distribution__match_1__group_B",
      },
    };

    await processor(event);
    await processor(event);

    const activityCreates =
      db.creates.filter(
        (write) =>
          write.collection
            === "groupActivities"
      );

    assert.equal(
      activityCreates.length,
      1
    );

    assert.equal(
      activityCreates[0].id,
      "match_distribution__match_1__group_B"
    );

    const groupUpdates =
      db.updates.filter(
        (write) =>
          write.collection
            === "groups"
      );

    assert.equal(
      groupUpdates.length,
      1
    );

    assert.equal(
      notifications.length,
      1
    );

    const effect =
      db.get(
        "matchDistributionEvents",
        "match_distribution__match_1__group_B"
      );

    assert.ok(
      effect.coreProcessedAt
    );

    assert.ok(
      effect.notificationSentAt
    );

    assert.equal(
      effect.status,
      "processed"
    );
  }
);


test(
  "public distribution event sends nearby notification once without group side effects",
  async () => {
    const eventId =
      "match_distribution__match_1__public";

    const db =
      makeDb({
        eventType:
          "public_distribution_added",

        eventId,

        groupId:
          "",
      });

    const publicNotifications =
      [];

    const processor =
      buildProcessMatchDistributionEvent({
        db,
        FieldValue,
        logger: {},

        notifyGroupMatchCreated:
          async () => {
            throw new Error(
              "GROUP_NOTIFICATION_SHOULD_NOT_RUN"
            );
          },

        notifyPublicMatchCreated:
          async (payload) => {
            publicNotifications.push(
              payload
            );
          },
      });

    const event = {
      params: {
        eventId,
      },
    };

    await processor(event);
    await processor(event);

    const activityCreates =
      db.creates.filter(
        (write) =>
          write.collection
            === "groupActivities"
      );

    assert.equal(
      activityCreates.length,
      0
    );

    const groupUpdates =
      db.updates.filter(
        (write) =>
          write.collection
            === "groups"
      );

    assert.equal(
      groupUpdates.length,
      0
    );

    assert.equal(
      publicNotifications.length,
      1
    );

    assert.equal(
      publicNotifications[0]
        .matchId,
      "match_1"
    );

    const effect =
      db.get(
        "matchDistributionEvents",
        eventId
      );

    assert.ok(
      effect.coreProcessedAt
    );

    assert.ok(
      effect.notificationSentAt
    );

    assert.equal(
      effect.status,
      "processed"
    );
  }
);
