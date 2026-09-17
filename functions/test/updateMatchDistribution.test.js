import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUpdateMatchDistribution,
} from "../updateMatchDistribution.js";


class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}


function makeOnCall() {
  return (_runtime, handler) =>
    handler;
}


function makeDb({
  match,
  group = null,
  membership = null,
  club = null,
}) {
  let written = null;
  const groupUpdates = [];
  const activityWrites = [];

  const db = {
    async runTransaction(handler) {
      const tx = {
        async get(ref) {
          return ref.get();
        },

        set(ref, value) {
          written = value;
        },
      };

      return handler(tx);
    },

    collection(name) {
      return {
        doc(id) {
          return {
            id,

            async get() {
              if (name === "matches") {
                return {
                  exists:
                    match !== null,
                  data: () => match,
                };
              }

              if (name === "groups") {
                return {
                  exists:
                    group !== null,
                  data: () => group,
                };
              }

              if (
                name
                === "groupMemberships"
              ) {
                return {
                  exists:
                    membership !== null,
                  data: () =>
                    membership,
                };
              }

              if (name === "clubs") {
                return {
                  exists:
                    club !== null,
                  data: () => club,
                };
              }

              throw new Error(
                `unexpected collection ${name}`
              );
            },

            async create(value) {
              if (
                name
                === "groupActivities"
              ) {
                activityWrites.push(
                  {
                    id,
                    value,
                  }
                );
                return;
              }

              throw new Error(
                `unexpected create ${name}`
              );
            },

            async set(value) {
              written = value;
            },

            async update(value) {
              if (
                name === "groups"
              ) {
                groupUpdates.push(
                  {
                    id,
                    value,
                  }
                );
                return;
              }

              throw new Error(
                `unexpected update ${name}`
              );
            },
          };
        },
      };
    },

    getWritten() {
      return written;
    },

    getGroupUpdates() {
      return groupUpdates;
    },

    getActivityWrites() {
      return activityWrites;
    },
  };

  return db;
}


const FieldValue = {
  serverTimestamp() {
    return "SERVER_TIMESTAMP";
  },
};


test(
  "owner can make a legacy group match public",
  async () => {
    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",
          groupId:
            "group_A",
          dateHeure:
            Date.now()
            + 3600000,
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
        db,
        FieldValue,
        logger: {},
      });

    const result =
      await callable({
        auth: {
          uid: "user_A",
        },

        data: {
          matchId:
            "match_1",
          makePublic:
            true,
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      result
        .distribution
        .public,
      true
    );

    assert.deepEqual(
      result
        .distribution
        .groupIds,
      [
        "group_A",
      ]
    );
  }
);


test(
  "non owner cannot change distribution",
  async () => {
    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",
          dateHeure:
            Date.now()
            + 3600000,
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
        db,
        FieldValue,
        logger: {},
      });

    await assert.rejects(
      () =>
        callable({
          auth: {
            uid: "user_B",
          },

          data: {
            matchId:
              "match_1",
            makePublic:
              true,
          },
        }),
      (error) =>
        error.code
          === "permission-denied"
        &&
        error.message
          === "NOT_MATCH_OWNER"
    );
  }
);


test(
  "owner can distribute to an allowed group",
  async () => {
    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",
          dateHeure:
            Date.now()
            + 3600000,
        },

        group: {
          status: "active",
          settings: {
            canMembersCreateMatches:
              true,
          },
        },

        membership: {
          userId: "user_A",
          groupId: "group_B",
          status: "active",
          role: "member",
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
        db,
        FieldValue,
        logger: {},
      });

    const result =
      await callable({
        auth: {
          uid: "user_A",
        },

        data: {
          matchId:
            "match_1",
          groupId:
            "group_B",
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.deepEqual(
      result
        .distribution
        .groupIds,
      [
        "group_B",
      ]
    );
  }
);


test(
  "new target group triggers group notification once",
  async () => {
    const notifications = [];

    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",
          createurPseudo:
            "Jeremie",
          createurAvatar:
            "avatar.jpg",
          lieu:
            "Padel Club",
          dateHeure:
            Date.now()
            + 3600000,
        },

        group: {
          status: "active",
          name: "Groupe B",
          settings: {
            canMembersCreateMatches:
              true,
          },
        },

        membership: {
          userId: "user_A",
          groupId: "group_B",
          status: "active",
          role: "member",
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
        db,
        FieldValue: {
          ...FieldValue,

          increment(value) {
            return {
              increment: value,
            };
          },
        },
        logger: {},

        notifyGroupMatchCreated:
          async (payload) => {
            notifications.push(
              payload
            );
          },
      });

    const result =
      await callable({
        auth: {
          uid: "user_A",
        },

        data: {
          matchId:
            "match_1",
          groupId:
            "group_B",
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      notifications.length,
      1
    );

    assert.equal(
      notifications[0].groupId,
      "group_B"
    );

    assert.equal(
      notifications[0].matchId,
      "match_1"
    );

    assert.equal(
      notifications[0]
        .creatorProfile
        .pseudo,
      "Jeremie"
    );

    assert.equal(
      db.getActivityWrites().length,
      1
    );

    assert.equal(
      db.getActivityWrites()[0]
        .value
        .groupId,
      "group_B"
    );

    assert.equal(
      db.getActivityWrites()[0]
        .value
        .type,
      "match_created"
    );

    assert.equal(
      db.getActivityWrites()[0]
        .value
        .matchId,
      "match_1"
    );

    assert.equal(
      db.getActivityWrites()[0]
        .value
        .metadata
        .source,
      "match_distribution"
    );

    assert.equal(
      db.getGroupUpdates().length,
      1
    );

    assert.equal(
      db.getGroupUpdates()[0].id,
      "group_B"
    );

    assert.deepEqual(
      db.getGroupUpdates()[0]
        .value[
          "stats.upcomingMatchCount"
        ],
      {
        increment: 1,
      }
    );

    assert.deepEqual(
      db.getGroupUpdates()[0]
        .value[
          "stats.matchesCreated30d"
        ],
      {
        increment: 1,
      }
    );
  }
);


test(
  "existing target group creates no duplicate notification",
  async () => {
    const notifications = [];

    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",

          dateHeure:
            Date.now()
            + 3600000,

          distribution: {
            public: false,
            groupIds: [
              "group_B",
            ],
          },
        },

        group: {
          status: "active",
          settings: {
            canMembersCreateMatches:
              true,
          },
        },

        membership: {
          userId: "user_A",
          groupId: "group_B",
          status: "active",
          role: "member",
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
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

    const result =
      await callable({
        auth: {
          uid: "user_A",
        },

        data: {
          matchId:
            "match_1",
          groupId:
            "group_B",
        },
      });

    assert.equal(
      result.changed,
      false
    );

    assert.equal(
      notifications.length,
      0
    );

    assert.equal(
      db.getActivityWrites().length,
      0
    );

    assert.equal(
      db.getGroupUpdates().length,
      0
    );
  }
);


test(
  "making public only sends no group notification",
  async () => {
    const notifications = [];

    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",

          groupId:
            "group_A",

          dateHeure:
            Date.now()
            + 3600000,
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
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

    const result =
      await callable({
        auth: {
          uid: "user_A",
        },

        data: {
          matchId:
            "match_1",
          makePublic:
            true,
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      notifications.length,
      0
    );

    assert.equal(
      db.getActivityWrites().length,
      0
    );

    assert.equal(
      db.getGroupUpdates().length,
      0
    );
  }
);


test(
  "public plus new group sends one group notification",
  async () => {
    const notifications = [];

    const db =
      makeDb({
        match: {
          createurUid:
            "user_A",

          dateHeure:
            Date.now()
            + 3600000,
        },

        group: {
          status: "active",
          settings: {
            canMembersCreateMatches:
              true,
          },
        },

        membership: {
          userId: "user_A",
          groupId: "group_B",
          status: "active",
          role: "member",
        },
      });

    const callable =
      buildUpdateMatchDistribution({
        onCall:
          makeOnCall(),
        HttpsError:
          FakeHttpsError,
        runtime: {},
        db,
        FieldValue: {
          ...FieldValue,

          increment(value) {
            return {
              increment: value,
            };
          },
        },
        logger: {},

        notifyGroupMatchCreated:
          async (payload) => {
            notifications.push(
              payload
            );
          },
      });

    const result =
      await callable({
        auth: {
          uid: "user_A",
        },

        data: {
          matchId:
            "match_1",
          makePublic:
            true,
          groupId:
            "group_B",
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      result
        .distribution
        .public,
      true
    );

    assert.deepEqual(
      result
        .distribution
        .groupIds,
      [
        "group_B",
      ]
    );

    assert.equal(
      notifications.length,
      1
    );

    assert.equal(
      db.getActivityWrites().length,
      1
    );

    assert.equal(
      db.getGroupUpdates().length,
      1
    );
  }
);
