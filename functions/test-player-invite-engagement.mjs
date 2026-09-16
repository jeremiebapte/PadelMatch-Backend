import assert from "node:assert/strict";

import {
  buildPlayerInviteEngagementService,
} from "./domain/playerInvites/PlayerInviteEngagementService.js";


const activities =
  [];

const pushes =
  [];


const invitation = {
  id:
    "invite_test",

  inviterUid:
    "uid_a",

  inviteeUid:
    "uid_b",

  inviterPseudoSnapshot:
    "Alpha",

  inviteePseudoSnapshot:
    "Bravo",

  inviterAvatarSnapshot:
    "avatar-a",

  inviteeAvatarSnapshot:
    "avatar-b",

  pairKey:
    "uid_a_uid_b",

  status:
    "pending",

  scheduleKind:
    "flexible",

  timePreference:
    "evening",

  placeLabel:
    "Padel Test",

  conversationId:
    null,
};


const db = {
  collection(name) {
    assert.equal(
      name,
      "playerInvitations"
    );

    return {
      doc(id) {
        assert.equal(
          id,
          "invite_test"
        );

        return {
          async get() {
            return {
              exists:
                true,

              id:
                "invite_test",

              data() {
                return {
                  ...invitation,
                };
              },
            };
          },
        };
      },
    };
  },
};


const service =
  buildPlayerInviteEngagementService({
    db,

    async recordUserActivity(
      payload
    ) {
      activities.push(
        payload
      );

      return {
        id:
          `activity_${activities.length}`,
      };
    },

    async tokensOf(
      uid
    ) {
      return [
        `token_${uid}`,
      ];
    },

    async sendVisibleHybrid(
      tokens,
      payload
    ) {
      pushes.push({
        tokens,
        payload,
      });
    },

    logger:
      console,
  });


await service
  .invitationReceived(
    "invite_test"
  );


assert.equal(
  activities.length,
  1
);

assert.equal(
  activities[0].userId,
  "uid_b"
);

assert.equal(
  activities[0].type,
  "player_invite_received"
);

assert.equal(
  activities[0].entityType,
  "player_invite"
);

assert.equal(
  activities[0].inviteId,
  "invite_test"
);

assert.equal(
  activities[0].actorUid,
  "uid_a"
);

assert.match(
  activities[0].title,
  /Alpha/
);

assert.equal(
  pushes.length,
  1
);

assert.equal(
  pushes[0]
    .payload
    .data
    .type,
  "player_invite_received"
);


console.log(
  "PASS — received crée Activity + push"
);


activities.length =
  0;

pushes.length =
  0;

invitation.status =
  "accepted";

invitation.conversationId =
  "uid_a_uid_b";


await service
  .invitationAccepted(
    "invite_test"
  );


assert.equal(
  activities.length,
  1
);

assert.equal(
  activities[0].userId,
  "uid_a"
);

assert.equal(
  activities[0].type,
  "player_invite_accepted"
);

assert.equal(
  activities[0].actorUid,
  "uid_b"
);

assert.equal(
  activities[0]
    .metadata
    .conversationId,
  "uid_a_uid_b"
);

assert.equal(
  pushes.length,
  1
);

assert.equal(
  pushes[0]
    .payload
    .data
    .type,
  "player_invite_accepted"
);


console.log(
  "PASS — accepted crée Activity + push"
);


activities.length =
  0;

pushes.length =
  0;

invitation.status =
  "declined";

invitation.conversationId =
  null;


await service
  .invitationDeclined(
    "invite_test"
  );


assert.equal(
  activities.length,
  1
);

assert.equal(
  activities[0].userId,
  "uid_a"
);

assert.equal(
  activities[0].type,
  "player_invite_declined"
);

assert.equal(
  pushes.length,
  0
);


console.log(
  "PASS — declined crée Activity sans push"
);

console.log();
console.log(
  "3 tests Player Invite Engagement PASS"
);
