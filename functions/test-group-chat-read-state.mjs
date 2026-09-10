import assert from "node:assert/strict";

import {
  isGroupChatAggregateAlreadyRead,
} from "./domain/groups/GroupChatNotificationService.js";


function timestampLike(date) {
  return {
    toDate() {
      return date;
    },
  };
}


const messageAt =
  new Date("2026-09-09T08:00:00.000Z");


assert.equal(
  isGroupChatAggregateAlreadyRead({
    membership: {},
    lastMessageAt: messageAt,
  }),
  false,
  "absence de lastChatReadAt => non lu"
);


assert.equal(
  isGroupChatAggregateAlreadyRead({
    membership: {
      lastChatReadAt:
        new Date("2026-09-09T07:59:59.000Z"),
    },
    lastMessageAt: messageAt,
  }),
  false,
  "lecture antérieure au message => notification conservée"
);


assert.equal(
  isGroupChatAggregateAlreadyRead({
    membership: {
      lastChatReadAt:
        new Date("2026-09-09T08:00:00.000Z"),
    },
    lastMessageAt: messageAt,
  }),
  true,
  "lecture au même timestamp => agrégat lu"
);


assert.equal(
  isGroupChatAggregateAlreadyRead({
    membership: {
      lastChatReadAt:
        timestampLike(
          new Date("2026-09-09T08:00:10.000Z")
        ),
    },
    lastMessageAt:
      timestampLike(messageAt),
  }),
  true,
  "Firestore Timestamp postérieur => agrégat lu"
);


assert.equal(
  isGroupChatAggregateAlreadyRead({
    membership: {
      lastChatReadAt:
        timestampLike(
          new Date("2026-09-09T07:59:00.000Z")
        ),
    },
    lastMessageAt:
      timestampLike(messageAt),
  }),
  false,
  "Firestore Timestamp antérieur => non lu"
);


console.log(
  "PASS — Group Chat read-state comparator"
);
