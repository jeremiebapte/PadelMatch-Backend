import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFlushGroupChatNotifications,
  GROUP_CHAT_NOTIFICATION_QUEUE_COLLECTION,
} from "../../../domain/groups/GroupChatNotificationService.js";

const NOW = new Date("2026-10-14T12:00:00Z");
const MESSAGE_AT = new Date("2026-10-14T11:58:00Z");
const QUEUE_ID = "group_1_user_b";
const QUEUE_PATH =
  `${GROUP_CHAT_NOTIFICATION_QUEUE_COLLECTION}/${QUEUE_ID}`;

function setup({
  readAt = null,
  isPushAllowed = async () => true,
} = {}) {
  const documents = new Map();
  const tokensRequested = [];
  const sends = [];
  const gateCalls = [];

  documents.set(QUEUE_PATH, {
    groupId: "group_1",
    groupName: "Les joueurs du coin",
    recipientUid: "user_b",
    status: "pending",
    sendAfter: new Date("2026-10-14T11:59:00Z"),
    messageCount: 3,
    version: 1,
    retryCount: 0,
    senderUids: ["user_a"],
    lastSenderUid: "user_a",
    lastSenderPseudo: "Karim",
    lastPreview: "On joue demain ?",
    lastMessageId: "message_3",
    lastMessageAt: MESSAGE_AT,
  });

  documents.set("groups/group_1", {
    name: "Les joueurs du coin",
    status: "active",
  });

  documents.set("groupMemberships/group_1_user_b", {
    groupId: "group_1",
    userId: "user_b",
    status: "active",
    notificationsEnabled: true,
    messageNotificationsEnabled: true,
    ...(readAt ? { lastChatReadAt: readAt } : {}),
  });

  function ref(path) {
    return {
      path,
      id: path.split("/").pop(),
      async get() {
        return snapshot(path);
      },
    };
  }

  function snapshot(path) {
    const exists = documents.has(path);
    return {
      id: path.split("/").pop(),
      exists,
      ref: ref(path),
      data: () => documents.get(path),
    };
  }

  const transaction = {
    async get(reference) {
      return snapshot(reference.path);
    },
    update(reference, data) {
      documents.set(reference.path, {
        ...documents.get(reference.path),
        ...data,
      });
    },
    set(reference, data, options = {}) {
      documents.set(
        reference.path,
        options.merge
          ? { ...documents.get(reference.path), ...data }
          : data
      );
    },
    delete(reference) {
      documents.delete(reference.path);
    },
  };

  const db = {
    collection(name) {
      return {
        doc(id) {
          return ref(`${name}/${id}`);
        },
        where(_field, _operator, value) {
          return {
            limit(max) {
              return {
                async get() {
                  const docs = [...documents.keys()]
                    .filter(path => path.startsWith(`${name}/`))
                    .filter(path => {
                      const data = documents.get(path);
                      return data.sendAfter instanceof Date
                        && data.sendAfter <= value;
                    })
                    .slice(0, max)
                    .map(snapshotPath => snapshot(snapshotPath));

                  return { docs, size: docs.length };
                },
              };
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      return callback(transaction);
    },
  };

  const flush = buildFlushGroupChatNotifications({
    db,
    FieldValue: {
      serverTimestamp: () => NOW,
    },
    tokensOf: async uid => {
      tokensRequested.push(uid);
      return [`token_${uid}`];
    },
    sendChatHybrid: async (tokens, payload) => {
      sends.push({ tokens, payload });
    },
    isPushAllowed: async input => {
      gateCalls.push(input);
      return isPushAllowed(input);
    },
    logger: {
      info() {},
      warn() {},
    },
  });

  return {
    flush: () => flush({ now: NOW }),
    documents,
    sends,
    tokensRequested,
    gateCalls,
  };
}

test("V2 : agrégat autorisé = un seul push pour 3 messages", async () => {
  const app = setup();

  const result = await app.flush();

  assert.equal(result.sentCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(app.sends.length, 1);
  assert.deepEqual(app.tokensRequested, ["user_b"]);
  assert.equal(app.sends[0].payload.data.messageCount, "3");
  assert.equal(app.documents.has(QUEUE_PATH), false);

  assert.equal(app.gateCalls.length, 1);
  assert.equal(app.gateCalls[0].category, "messages");
  assert.equal(app.gateCalls[0].event, "groupMessage");
  assert.equal(app.gateCalls[0].uid, "user_b");
});

test("V2 : préférence désactivée = aucun push et agrégat supprimé", async () => {
  const app = setup({
    isPushAllowed: async () => false,
  });

  const result = await app.flush();

  assert.equal(result.sentCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(app.sends.length, 0);
  assert.equal(app.tokensRequested.length, 0);
  assert.equal(app.documents.has(QUEUE_PATH), false);
});

test("V2 : messages déjà lus = aucun push, aucun appel au filtre", async () => {
  const app = setup({
    readAt: new Date("2026-10-14T11:59:00Z"),
  });

  const result = await app.flush();

  assert.equal(result.sentCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(app.gateCalls.length, 0);
  assert.equal(app.tokensRequested.length, 0);
  assert.equal(app.documents.has(QUEUE_PATH), false);
});

test("V2 : erreur Firestore = agrégat conservé pour réessai", async () => {
  let shouldFail = true;

  const app = setup({
    isPushAllowed: async () => {
      if (shouldFail) {
        throw new Error("FIRESTORE_UNAVAILABLE");
      }
      return true;
    },
  });

  const first = await app.flush();

  assert.equal(first.sentCount, 0);
  assert.equal(first.failedCount, 1);
  assert.equal(app.sends.length, 0);
  assert.equal(app.tokensRequested.length, 0);
  assert.equal(app.documents.get(QUEUE_PATH).status, "pending");
  assert.equal(app.documents.get(QUEUE_PATH).messageCount, 3);
  assert.equal(app.documents.get(QUEUE_PATH).retryCount, 1);

  shouldFail = false;

  // Le service planifie le réessai cinq minutes plus tard.
  const retryAt = app.documents.get(QUEUE_PATH).sendAfter;
  assert.ok(retryAt instanceof Date);

  const skipped = await app.flush();
  assert.equal(skipped.sentCount, 0);

  // Autoriser le réessai dans notre horloge simulée.
  app.documents.get(QUEUE_PATH).sendAfter =
    new Date("2026-10-14T11:59:00Z");

  const second = await app.flush();

  assert.equal(second.sentCount, 1);
  assert.equal(second.failedCount, 0);
  assert.equal(app.sends.length, 1);
  assert.equal(app.documents.has(QUEUE_PATH), false);
});
