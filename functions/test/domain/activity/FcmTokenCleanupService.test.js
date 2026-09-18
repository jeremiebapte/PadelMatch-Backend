import test from "node:test";
import assert from "node:assert/strict";

import {
  isPermanentFcmTokenError,
  classifyMulticastFailures,
  buildFcmTokenCleanupService,
} from "../../../domain/notifications/FcmTokenCleanupService.js";


function makeDb() {
  const deleted = [];

  return {
    deleted,

    collection(collectionName) {
      assert.equal(
        collectionName,
        "users"
      );

      return {
        doc(uid) {
          return {
            collection(subcollection) {
              assert.equal(
                subcollection,
                "fcmTokens"
              );

              return {
                doc(token) {
                  return {
                    async delete() {
                      deleted.push({
                        uid,
                        token,
                      });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}


test(
  "only permanent registration token errors are classified as stale",
  () => {
    assert.equal(
      isPermanentFcmTokenError({
        code:
          "messaging/registration-token-not-registered",
      }),
      true
    );

    assert.equal(
      isPermanentFcmTokenError({
        code:
          "messaging/invalid-registration-token",
      }),
      true
    );

    assert.equal(
      isPermanentFcmTokenError({
        code:
          "messaging/server-unavailable",
      }),
      false
    );

    assert.equal(
      isPermanentFcmTokenError({
        code:
          "messaging/internal-error",
      }),
      false
    );
  }
);


test(
  "multicast classification preserves transient failures",
  () => {
    const result =
      classifyMulticastFailures(
        [
          "token_ok",
          "token_dead",
          "token_temp",
        ],
        {
          responses: [
            {
              success: true,
            },
            {
              success: false,
              error: {
                code:
                  "messaging/registration-token-not-registered",
              },
            },
            {
              success: false,
              error: {
                code:
                  "messaging/server-unavailable",
              },
            },
          ],
        }
      );

    assert.deepEqual(
      result.permanentlyInvalidTokens,
      [
        "token_dead",
      ]
    );

    assert.equal(
      result.temporaryFailures,
      1
    );
  }
);


test(
  "cleanup removes stale token only from its known owner",
  async () => {
    const db =
      makeDb();

    const logs = [];

    const service =
      buildFcmTokenCleanupService({
        db,

        logger: {
          info(message, payload) {
            logs.push({
              message,
              payload,
            });
          },

          warn() {},
        },
      });

    service.rememberTokenOwners(
      "user_A",
      [
        "token_ok",
        "token_dead",
      ]
    );

    const result =
      await service
        .cleanupInvalidTokensFromResponse(
          [
            "token_ok",
            "token_dead",
          ],
          {
            responses: [
              {
                success: true,
              },
              {
                success: false,
                error: {
                  code:
                    "messaging/registration-token-not-registered",
                },
              },
            ],
          },
          {
            sender:
              "sendVisibleHybrid",
          }
        );

    assert.deepEqual(
      db.deleted,
      [
        {
          uid:
            "user_A",

          token:
            "token_dead",
        },
      ]
    );

    assert.equal(
      result.invalidTokensRemoved,
      1
    );

    assert.equal(
      result.permanentFailures,
      1
    );

    assert.equal(
      result.temporaryFailures,
      0
    );

    assert.equal(
      logs.length,
      1
    );
  }
);


test(
  "same stale token is removed from every known owner",
  async () => {
    const db =
      makeDb();

    const service =
      buildFcmTokenCleanupService({
        db,
        logger: {},
      });

    service.rememberTokenOwners(
      "user_A",
      [
        "shared_dead_token",
      ]
    );

    service.rememberTokenOwners(
      "user_B",
      [
        "shared_dead_token",
      ]
    );

    await service
      .cleanupInvalidTokensFromResponse(
        [
          "shared_dead_token",
        ],
        {
          responses: [
            {
              success: false,
              error: {
                code:
                  "messaging/invalid-registration-token",
              },
            },
          ],
        }
      );

    assert.deepEqual(
      db.deleted,
      [
        {
          uid:
            "user_A",
          token:
            "shared_dead_token",
        },
        {
          uid:
            "user_B",
          token:
            "shared_dead_token",
        },
      ]
    );
  }
);
