import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApproveGroupJoinRequest,
} from "../../approveGroupJoinRequest.js";

const GROUP_ID = "group_123";
const MANAGER = "admin_123";
const PLAYER = "player_123";
const REQUEST_ID = `${GROUP_ID}_${PLAYER}`;

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function environment({ isPushAllowed } = {}) {
  const documents = new Map([
    [`groupJoinRequests/${REQUEST_ID}`, {
      requestId: REQUEST_ID,
      groupId: GROUP_ID,
      requesterUid: PLAYER,
      requesterPseudoSnapshot: "Joueur Test",
      status: "pending",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    }],
    [`groups/${GROUP_ID}`, {
      name: "Padel Paris",
      status: "active",
      stats: {
        pendingRequestCount: 1,
        memberCount: 1,
      },
    }],
    [`groupMemberships/${GROUP_ID}_${MANAGER}`, {
      groupId: GROUP_ID,
      userId: MANAGER,
      status: "active",
      role: "owner",
    }],
    [`users/${PLAYER}`, {
      pseudo: "Joueur Test",
    }],
  ]);

  const writes = [];
  const checks = [];
  const tokenRequests = [];
  const sends = [];
  const warnings = [];
  let sequence = 0;

  function reference(path) {
    return {
      path,
      id: path.split("/").pop(),
    };
  }

  function snapshot(ref) {
    return {
      id: ref.id,
      exists: documents.has(ref.path),
      data: () => documents.get(ref.path),
      ref,
    };
  }

  const db = {
    collection(name) {
      return {
        doc(id) {
          if (!id) {
            sequence += 1;
            id = `activity_${sequence}`;
          }
          return reference(`${name}/${id}`);
        },
      };
    },

    async runTransaction(callback) {
      const staged = [];

      const transaction = {
        async get(ref) {
          return snapshot(ref);
        },
        set(ref, data) {
          staged.push({
            operation: "set",
            path: ref.path,
            data,
          });
        },
        update(ref, data) {
          staged.push({
            operation: "update",
            path: ref.path,
            data,
          });
        },
        create(ref, data) {
          staged.push({
            operation: "create",
            path: ref.path,
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

  const callable = buildApproveGroupJoinRequest({
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
    ...(typeof isPushAllowed === "function"
      ? {
          isPushAllowed: async input => {
            checks.push(input);
            return isPushAllowed(input);
          },
        }
      : {}),
  });

  return {
    invoke: () => callable({
      auth: { uid: MANAGER },
      data: { requestId: REQUEST_ID },
    }),
    documents,
    writes,
    checks,
    tokenRequests,
    sends,
    warnings,
  };
}

function assertApproved(app, result) {
  assert.equal(result.ok, true);
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.groupId, GROUP_ID);
  assert.equal(result.requesterUid, PLAYER);

  const request = app.documents.get(
    `groupJoinRequests/${REQUEST_ID}`
  );
  assert.equal(request.status, "approved");
  assert.equal(request.resolvedByUid, MANAGER);

  const membership = app.documents.get(
    `groupMemberships/${GROUP_ID}_${PLAYER}`
  );
  assert.equal(membership.status, "active");
  assert.equal(membership.role, "member");
  assert.equal(membership.userId, PLAYER);
  assert.equal(membership.approvedByUid, MANAGER);

  const activities = app.writes.filter(
    item => item.path.startsWith("groupActivities/")
  );
  assert.equal(activities.length, 2);

  const membershipWrites = app.writes.filter(
    item => item.path === `groupMemberships/${GROUP_ID}_${PLAYER}`
  );
  assert.equal(membershipWrites.length, 1);
}

test("V2 : acceptation autorisée déclenche un push", async () => {
  const app = environment({
    isPushAllowed: async () => true,
  });

  const result = await app.invoke();
  assertApproved(app, result);

  assert.deepEqual(app.checks, [{
    uid: PLAYER,
    category: "groups",
    event: "groupMembershipUpdate",
  }]);

  assert.deepEqual(app.tokenRequests, [PLAYER]);
  assert.equal(app.sends.length, 1);
  assert.equal(
    app.sends[0].payload.data.subtype,
    "join_request_approved"
  );
});

test("V2 : préférence désactivée conserve l'acceptation", async () => {
  const app = environment({
    isPushAllowed: async () => false,
  });

  const result = await app.invoke();
  assertApproved(app, result);

  assert.equal(app.checks.length, 1);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
  assert.equal(app.warnings.length, 0);
});

test("V2 : erreur de préférence n'annule pas l'acceptation", async () => {
  const app = environment({
    isPushAllowed: async () => {
      throw new Error("FIRESTORE_UNAVAILABLE");
    },
  });

  const result = await app.invoke();
  assertApproved(app, result);

  assert.equal(app.checks.length, 1);
  assert.deepEqual(app.tokenRequests, []);
  assert.deepEqual(app.sends, []);
  assert.equal(app.warnings.length, 1);
});

test("V2 : filtre absent conserve l'ancien envoi", async () => {
  const app = environment();

  const result = await app.invoke();
  assertApproved(app, result);

  assert.deepEqual(app.checks, []);
  assert.deepEqual(app.tokenRequests, [PLAYER]);
  assert.equal(app.sends.length, 1);
});
