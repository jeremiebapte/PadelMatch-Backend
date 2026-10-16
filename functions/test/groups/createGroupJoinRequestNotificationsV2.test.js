import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreateGroupJoinRequest,
} from "../../createGroupJoinRequest.js";

const GROUP_ID = "group_123";
const REQUESTER = "user_123";
const REQUEST_ID = `${GROUP_ID}_${REQUESTER}`;
const MANAGERS = ["admin_a", "admin_b", "admin_c"];

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function environment({ isPushAllowed } = {}) {
  const documents = new Map([
    [`groups/${GROUP_ID}`, {
      groupId: GROUP_ID,
      name: "Padel Paris",
      status: "active",
      joinPolicy: "approval_required",
    }],
    [`users/${REQUESTER}`, {
      pseudo: "Joueur Test",
      level: 5,
    }],
  ]);

  const writes = [];
  const checks = [];
  const tokenRequests = [];
  const sends = [];
  const warnings = [];
  let activitySequence = 0;

  function ref(path) {
    return {
      path,
      id: path.split("/").pop(),
    };
  }

  function snapshot(reference) {
    return {
      id: reference.id,
      ref: reference,
      exists: documents.has(reference.path),
      data: () => documents.get(reference.path),
    };
  }

  const managerDocs = MANAGERS.map((uid, index) => ({
    id: `${GROUP_ID}_${uid}`,
    data: () => ({
      groupId: GROUP_ID,
      userId: uid,
      status: "active",
      role: index === 0 ? "owner" : "admin",
    }),
  }));

  const query = {
    where() {
      return this;
    },
  };

  const db = {
    collection(name) {
      return {
        doc(id) {
          if (!id) {
            activitySequence += 1;
            id = `activity_${activitySequence}`;
          }
          return ref(`${name}/${id}`);
        },
        where() {
          return query;
        },
      };
    },

    async runTransaction(callback) {
      const staged = [];

      const transaction = {
        async get(reference) {
          if (reference === query) {
            return { docs: managerDocs };
          }
          return snapshot(reference);
        },

        set(reference, data) {
          staged.push({
            operation: "set",
            path: reference.path,
            data,
          });
        },

        update(reference, data) {
          staged.push({
            operation: "update",
            path: reference.path,
            data,
          });
        },

        create(reference, data) {
          staged.push({
            operation: "create",
            path: reference.path,
            data,
          });
        },
      };

      const result = await callback(transaction);

      for (const write of staged) {
        if (write.operation === "update") {
          documents.set(write.path, {
            ...documents.get(write.path),
            ...write.data,
          });
        } else {
          documents.set(write.path, write.data);
        }
        writes.push(write);
      }

      return result;
    },
  };

  const callable = buildCreateGroupJoinRequest({
    onCall: (_runtime, handler) => handler,
    HttpsError,
    runtime: {},
    db,
    FieldValue: {
      increment: value => ({ increment: value }),
    },
    logger: {
      info() {},
      warn: (...args) => warnings.push(args),
      error() {},
    },
    tokensOf: async uid => {
      tokenRequests.push(uid);
      return [`token_${uid}`];
    },
    sendVisibleHybrid: async (tokens, payload) => {
      sends.push({ tokens, payload });
    },
    ...(typeof isPushAllowed === "function" ? {
      isPushAllowed: async input => {
        checks.push(input);
        return isPushAllowed(input);
      },
    } : {}),
  });

  return {
    invoke: () => callable({
      auth: { uid: REQUESTER },
      data: { groupId: GROUP_ID },
    }),
    documents,
    writes,
    checks,
    tokenRequests,
    sends,
    warnings,
  };
}

function assertCreated(app, result) {
  assert.equal(result.ok, true);
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.groupId, GROUP_ID);

  const request = app.documents.get(
    `groupJoinRequests/${REQUEST_ID}`
  );

  assert.equal(request?.status, "pending");
  assert.equal(request?.requesterUid, REQUESTER);

  const requestWrites = app.writes.filter(
    w => w.path === `groupJoinRequests/${REQUEST_ID}`
  );
  assert.equal(requestWrites.length, 1);

  const activityWrites = app.writes.filter(
    w => w.path.startsWith("groupActivities/")
  );
  assert.equal(activityWrites.length, 1);
  assert.equal(
    activityWrites[0].data.joinRequestId,
    REQUEST_ID
  );
}

test("V2 : trois administrateurs avec préférences distinctes", async () => {
  const app = environment({
    isPushAllowed: async ({ uid }) => {
      if (uid === "admin_b") return false;
      if (uid === "admin_c") {
        throw new Error("FIRESTORE_UNAVAILABLE");
      }
      return true;
    },
  });

  const result = await app.invoke();
  assertCreated(app, result);

  assert.deepEqual(
    app.checks.map(item => item.uid),
    MANAGERS
  );
  for (const check of app.checks) {
    assert.equal(check.category, "groups");
    assert.equal(check.event, "groupJoinRequest");
  }

  assert.deepEqual(app.tokenRequests, ["admin_a"]);
  assert.equal(app.sends.length, 1);
  assert.deepEqual(
    app.sends[0].tokens,
    ["token_admin_a"]
  );
  assert.equal(
    app.sends[0].payload.data.subtype,
    "join_request"
  );
  assert.equal(app.warnings.length, 1);
});

test("V2 : tous désactivés, demande et activité conservées", async () => {
  const app = environment({
    isPushAllowed: async () => false,
  });

  const result = await app.invoke();
  assertCreated(app, result);

  assert.equal(app.checks.length, 3);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
  assert.equal(app.warnings.length, 0);
});

test("V2 : tous autorisés, trois envois indépendants", async () => {
  const app = environment({
    isPushAllowed: async () => true,
  });

  const result = await app.invoke();
  assertCreated(app, result);

  assert.deepEqual(app.tokenRequests, MANAGERS);
  assert.equal(app.sends.length, 3);
  assert.equal(app.warnings.length, 0);
});

test("V2 : filtre absent, comportement historique conservé", async () => {
  const app = environment();

  const result = await app.invoke();
  assertCreated(app, result);

  assert.deepEqual(app.checks, []);
  assert.deepEqual(app.tokenRequests, MANAGERS);
  assert.equal(app.sends.length, 3);
});
