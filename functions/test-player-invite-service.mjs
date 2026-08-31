// Path: functions/test-player-invite-service.mjs

import assert from "node:assert/strict";

import {
  Timestamp,
} from "firebase-admin/firestore";

import {
  PlayerInviteServiceError,
} from "./domain/playerInvites/PlayerInviteService.js";


let passed = 0;


function test(
  name,
  fn
) {
  try {
    fn();

    passed += 1;

    console.log(
      `PASS — ${name}`
    );

  } catch (error) {
    console.error(
      `FAIL — ${name}`
    );

    throw error;
  }
}


test(
  "Timestamp Firebase disponible",
  () => {
    const ts =
      Timestamp.fromMillis(
        1_000
      );

    assert.equal(
      ts.toMillis(),
      1_000
    );
  }
);


test(
  "PlayerInviteServiceError conserve son code",
  () => {
    const error =
      new PlayerInviteServiceError(
        "PLAYER_INVITE_ALREADY_PENDING"
      );

    assert.equal(
      error.code,
      "PLAYER_INVITE_ALREADY_PENDING"
    );
  }
);


console.log("");
console.log(
  `${passed} tests Player Invite Service PASS`
);
