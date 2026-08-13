import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJoinOpenGroup,
} from "../../joinOpenGroup.js";


function createFakeRuntime() {
  return {
    onCall: (
      _runtime,
      handler
    ) => handler,
  };
}


function createHttpsError() {
  return class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
}


function snapshot({
  exists,
  id,
  data = {},
}) {
  return {
    exists,
    id,
    data: () => data,
  };
}


function createFirestore({
  group,
  user,
  membership = null,
}) {
  const writes = [];

  const refs = new Map();

  function makeRef(
    collection,
    id
  ) {
    const key =
      `${collection}/${id}`;

    if (refs.has(key)) {
      return refs.get(key);
    }

    const ref = {
      collection,
      id,
      path: key,
    };

    refs.set(key, ref);

    return ref;
  }

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

    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          if (
            ref.collection ===
            "groups"
          ) {
            return snapshot({
              exists:
                group != null,
              id: ref.id,
              data:
                group ?? {},
            });
          }

          if (
            ref.collection ===
            "users"
          ) {
            return snapshot({
              exists:
                user != null,
              id: ref.id,
              data:
                user ?? {},
            });
          }

          if (
            ref.collection ===
            "groupMemberships"
          ) {
            return snapshot({
              exists:
                membership != null,
              id: ref.id,
              data:
                membership ?? {},
            });
          }

          throw new Error(
            `Unexpected get: ${ref.path}`
          );
        },

        set(ref, data) {
          writes.push({
            type: "set",
            ref,
            data,
          });
        },

        create(ref, data) {
          writes.push({
            type: "create",
            ref,
            data,
          });
        },

        update(ref, data) {
          writes.push({
            type: "update",
            ref,
            data,
          });
        },
      };

      return callback(
        transaction
      );
    },
  };

  return {
    db,
    writes,
  };
}


function buildSubject({
  group,
  user,
  membership = null,
}) {
  const {
    db,
    writes,
  } = createFirestore({
    group,
    user,
    membership,
  });

  const onCall =
    createFakeRuntime()
      .onCall;

  const HttpsError =
    createHttpsError();

  const FieldValue = {
    increment(value) {
      return {
        __increment: value,
      };
    },
  };

  const callable =
    buildJoinOpenGroup({
      onCall,
      HttpsError,
      runtime: {},
      db,
      FieldValue,
      logger: {
        info() {},
        error() {},
      },
    });

  return {
    callable,
    writes,
  };
}


test(
  "joinOpenGroup crée un membership actif OPEN_JOIN et incrémente memberCount",
  async () => {
    const {
      callable,
      writes,
    } = buildSubject({
      group: {
        status: "active",
        joinPolicy: "open",
        stats: {
          memberCount: 4,
        },
      },

      user: {
        pseudo: "Jeremie",
        avatar: "avatar.jpg",
      },
    });

    const result =
      await callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId:
            "group_123",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.groupId,
      "group_123"
    );

    const membershipWrite =
      writes.find(
        write =>
          write.type === "set" &&
          write.ref.collection ===
            "groupMemberships"
      );

    assert.ok(
      membershipWrite
    );

    assert.equal(
      membershipWrite
        .data
        .groupId,
      "group_123"
    );

    assert.equal(
      membershipWrite
        .data
        .userId,
      "user_123"
    );

    assert.equal(
      membershipWrite
        .data
        .role,
      "member"
    );

    assert.equal(
      membershipWrite
        .data
        .status,
      "active"
    );

    assert.equal(
      membershipWrite
        .data
        .source,
      "open_join"
    );

    const groupWrite =
      writes.find(
        write =>
          write.type ===
            "update" &&
          write.ref.collection ===
            "groups"
      );

    assert.ok(
      groupWrite
    );

    assert.deepEqual(
      groupWrite.data[
        "stats.memberCount"
      ],
      {
        __increment: 1,
      }
    );
  }
);


test(
  "joinOpenGroup refuse un groupe approval_required",
  async () => {
    const {
      callable,
      writes,
    } = buildSubject({
      group: {
        status: "active",
        joinPolicy:
          "approval_required",
      },

      user: {
        pseudo: "Jeremie",
      },
    });

    await assert.rejects(
      callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId:
            "group_123",
        },
      }),
      error => {
        assert.equal(
          error.code,
          "failed-precondition"
        );

        assert.equal(
          error.message,
          "GROUP_NOT_OPEN"
        );

        return true;
      }
    );

    assert.equal(
      writes.length,
      0
    );
  }
);


test(
  "joinOpenGroup refuse un utilisateur déjà membre actif",
  async () => {
    const {
      callable,
      writes,
    } = buildSubject({
      group: {
        status: "active",
        joinPolicy: "open",
      },

      user: {
        pseudo: "Jeremie",
      },

      membership: {
        status: "active",
      },
    });

    await assert.rejects(
      callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId:
            "group_123",
        },
      }),
      error => {
        assert.equal(
          error.code,
          "already-exists"
        );

        assert.equal(
          error.message,
          "ALREADY_GROUP_MEMBER"
        );

        return true;
      }
    );

    assert.equal(
      writes.length,
      0
    );
  }
);


test(
  "joinOpenGroup refuse un utilisateur banni",
  async () => {
    const {
      callable,
      writes,
    } = buildSubject({
      group: {
        status: "active",
        joinPolicy: "open",
      },

      user: {
        pseudo: "Jeremie",
      },

      membership: {
        status: "banned",
      },
    });

    await assert.rejects(
      callable({
        auth: {
          uid: "user_123",
        },
        data: {
          groupId:
            "group_123",
        },
      }),
      error => {
        assert.equal(
          error.code,
          "permission-denied"
        );

        assert.equal(
          error.message,
          "BANNED_FROM_GROUP"
        );

        return true;
      }
    );

    assert.equal(
      writes.length,
      0
    );
  }
);


test(
  "joinOpenGroup exige une authentification",
  async () => {
    const {
      callable,
    } = buildSubject({
      group: {
        status: "active",
        joinPolicy: "open",
      },

      user: {
        pseudo: "Jeremie",
      },
    });

    await assert.rejects(
      callable({
        auth: null,
        data: {
          groupId:
            "group_123",
        },
      }),
      error => {
        assert.equal(
          error.code,
          "unauthenticated"
        );

        return true;
      }
    );
  }
);
