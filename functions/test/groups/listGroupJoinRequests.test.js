import test from "node:test";
import assert from "node:assert/strict";

import {
  buildListGroupJoinRequests,
} from "../../listGroupJoinRequests.js";


class FakeHttpsError extends Error {
  constructor(
    code,
    message,
    details
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}


function timestamp(ms) {
  return {
    toMillis() {
      return ms;
    },
  };
}


function buildFakeDb({
  group,
  membership,
  requests,
}) {
  const requestDocs =
    requests.map(
      (request) => ({
        id: request.requestId,
        data: () => ({
          ...request,
        }),
      })
    );

  const requestQuery = {
    where() {
      return this;
    },

    orderBy() {
      return this;
    },

    async get() {
      return {
        docs:
          requestDocs,
      };
    },
  };

  return {
    collection(name) {
      if (
        name ===
        "groupJoinRequests"
      ) {
        return requestQuery;
      }

      return {
        doc() {
          return {
            async get() {
              if (
                name === "groups"
              ) {
                return {
                  exists:
                    Boolean(group),
                  data:
                    () => group,
                };
              }

              if (
                name ===
                "groupMemberships"
              ) {
                return {
                  exists:
                    Boolean(
                      membership
                    ),
                  data:
                    () =>
                      membership,
                };
              }

              throw new Error(
                `UNEXPECTED_COLLECTION:${name}`
              );
            },
          };
        },
      };
    },
  };
}


function callableFrom({
  group,
  membership,
  requests = [],
}) {
  return buildListGroupJoinRequests({
    onCall:
      (_runtime, handler) =>
        handler,

    HttpsError:
      FakeHttpsError,

    runtime: {},

    db:
      buildFakeDb({
        group,
        membership,
        requests,
      }),

    logger: {
      info() {},
      error() {},
    },
  });
}


test(
  "owner can list pending join requests",
  async () => {
    const callable =
      callableFrom({
        group: {
          status: "active",
        },

        membership: {
          status: "active",
          role: "owner",
        },

        requests: [
          {
            requestId:
              "group_1_user_1",
            groupId:
              "group_1",
            requesterUid:
              "user_1",
            status:
              "pending",
            requesterPseudoSnapshot:
              "Alice",
            requesterLevelSnapshot:
              5,
            createdAt:
              timestamp(2000),
            expiresAt:
              timestamp(5000),
          },
        ],
      });

    const result =
      await callable({
        auth: {
          uid:
            "owner_1",
        },

        data: {
          groupId:
            "group_1",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.groupId,
      "group_1"
    );

    assert.equal(
      result.requests.length,
      1
    );

    assert.equal(
      result.requests[0]
        .requesterPseudoSnapshot,
      "Alice"
    );

    assert.equal(
      result.requests[0]
        .createdAt,
      2000
    );
  }
);


test(
  "member cannot list join requests",
  async () => {
    const callable =
      callableFrom({
        group: {
          status: "active",
        },

        membership: {
          status: "active",
          role: "member",
        },
      });

    await assert.rejects(
      () =>
        callable({
          auth: {
            uid:
              "member_1",
          },

          data: {
            groupId:
              "group_1",
          },
        }),

      (error) =>
        error.code ===
          "permission-denied"
    );
  }
);


test(
  "unauthenticated user is rejected",
  async () => {
    const callable =
      callableFrom({
        group: {
          status: "active",
        },

        membership: null,
      });

    await assert.rejects(
      () =>
        callable({
          auth: null,

          data: {
            groupId:
              "group_1",
          },
        }),

      (error) =>
        error.code ===
          "unauthenticated"
    );
  }
);
