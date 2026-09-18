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
  let matchWrite = null;

  const eventWrites = [];
  const transactionReads = [];

  const db = {
    async runTransaction(handler) {
      const pending = [];

      const tx = {
        async get(ref) {
          transactionReads.push({
            collection:
              ref.collectionName,
            id:
              ref.id,
          });

          return ref.get();
        },

        set(ref, value) {
          pending.push(() => {
            if (
              ref.collectionName
              === "matches"
            ) {
              matchWrite =
                value;
            }
          });
        },

        create(ref, value) {
          pending.push(() => {
            if (
              ref.collectionName
              === "matchDistributionEvents"
            ) {
              eventWrites.push({
                id:
                  ref.id,
                value,
              });

              return;
            }

            throw new Error(
              `unexpected tx.create ${ref.collectionName}`
            );
          });
        },
      };

      const result =
        await handler(tx);

      for (const commit of pending) {
        commit();
      }

      return result;
    },

    collection(name) {
      return {
        doc(id) {
          return {
            id,
            collectionName:
              name,

            async get() {
              if (name === "matches") {
                return {
                  exists:
                    match !== null,
                  data: () =>
                    match,
                };
              }

              if (name === "groups") {
                return {
                  exists:
                    group !== null,
                  data: () =>
                    group,
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
                  data: () =>
                    club,
                };
              }

              throw new Error(
                `unexpected get ${name}`
              );
            },
          };
        },
      };
    },

    getMatchWrite() {
      return matchWrite;
    },

    getEventWrites() {
      return eventWrites;
    },

    getTransactionReads() {
      return transactionReads;
    },
  };

  return db;
}


const FieldValue = {
  serverTimestamp() {
    return "SERVER_TIMESTAMP";
  },
};


function playerMatch(
  overrides = {}
) {
  return {
    createurUid:
      "user_A",

    participants: [
      "user_A",
    ],

    dateHeure:
      Date.now()
      + 3600000,

    ...overrides,
  };
}


function allowedGroup() {
  return {
    status: "active",

    settings: {
      canMembersCreateMatches:
        true,
    },
  };
}


function activeMembership() {
  return {
    userId:
      "user_A",

    groupId:
      "group_B",

    status:
      "active",

    role:
      "member",
  };
}


function makeCallable(db) {
  return buildUpdateMatchDistribution({
    onCall:
      makeOnCall(),

    HttpsError:
      FakeHttpsError,

    runtime: {},

    db,

    FieldValue,

    logger: {},
  });
}


test(
  "owner can make a legacy group match public",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch({
            groupId:
              "group_A",
          }),
      });

    const result =
      await makeCallable(db)({
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

    const events =
      db.getEventWrites();

    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].id,
      "match_distribution__match_1__public"
    );

    assert.equal(
      events[0]
        .value
        .type,
      "public_distribution_added"
    );
  }
);


test(
  "non owner cannot change distribution",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch(),
      });

    await assert.rejects(
      () =>
        makeCallable(db)({
          auth: {
            uid:
              "user_B",
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
  "player match refuses distribution when creator is missing from participants",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch({
            participants: [
              "user_B",
            ],
          }),
      });

    await assert.rejects(
      () =>
        makeCallable(db)({
          auth: {
            uid:
              "user_A",
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
          === "failed-precondition"
        &&
        error.message
          === "MATCH_CREATOR_NOT_PARTICIPANT"
    );
  }
);


test(
  "allowed target group is checked inside transaction and creates deterministic outbox event",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch({
            createurPseudo:
              "Jeremie",

            createurAvatar:
              "avatar.jpg",

            lieu:
              "Padel Club",
          }),

        group:
          allowedGroup(),

        membership:
          activeMembership(),
      });

    const result =
      await makeCallable(db)({
        auth: {
          uid:
            "user_A",
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

    const reads =
      db
        .getTransactionReads();

    assert.ok(
      reads.some(
        (read) =>
          read.collection
            === "groups"
          &&
          read.id
            === "group_B"
      )
    );

    assert.ok(
      reads.some(
        (read) =>
          read.collection
            === "groupMemberships"
      )
    );

    const events =
      db.getEventWrites();

    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].id,
      "match_distribution__match_1__group_B"
    );

    assert.equal(
      events[0]
        .value
        .type,
      "group_distribution_added"
    );

    assert.equal(
      events[0]
        .value
        .matchId,
      "match_1"
    );

    assert.equal(
      events[0]
        .value
        .groupId,
      "group_B"
    );

    assert.equal(
      events[0]
        .value
        .creatorProfile
        .pseudo,
      "Jeremie"
    );
  }
);


test(
  "existing target group creates no second outbox event",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch({
            distribution: {
              public:
                false,

              groupIds: [
                "group_B",
              ],
            },
          }),

        group:
          allowedGroup(),

        membership:
          activeMembership(),
      });

    const result =
      await makeCallable(db)({
        auth: {
          uid:
            "user_A",
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
      db
        .getEventWrites()
        .length,
      0
    );
  }
);


test(
  "making public creates deterministic public outbox event",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch({
            groupId:
              "group_A",
          }),
      });

    const result =
      await makeCallable(db)({
        auth: {
          uid:
            "user_A",
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

    const events =
      db.getEventWrites();

    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].id,
      "match_distribution__match_1__public"
    );

    assert.equal(
      events[0]
        .value
        .type,
      "public_distribution_added"
    );
  }
);


test(
  "public plus new group creates exactly one outbox event",
  async () => {
    const db =
      makeDb({
        match:
          playerMatch(),

        group:
          allowedGroup(),

        membership:
          activeMembership(),
      });

    const result =
      await makeCallable(db)({
        auth: {
          uid:
            "user_A",
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
      db
        .getEventWrites()
        .length,
      1
    );
  }
);
