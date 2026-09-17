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

            async set(value) {
              written = value;
            },
          };
        },
      };
    },

    getWritten() {
      return written;
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
