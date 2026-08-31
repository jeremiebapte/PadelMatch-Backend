// Path: functions/test-player-invite-domain.mjs

import assert from "node:assert/strict";

import {
  PlayerInviteScheduleKind,
  PlayerInviteTimePreference,
  PlayerInviteValidationError,
  buildPlayerPairKey,
  validateCreatePlayerInviteInput,
} from "./domain/playerInvites/index.js";


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


function expectCode(
  expectedCode,
  fn
) {
  assert.throws(
    fn,
    error =>
      error instanceof
        PlayerInviteValidationError
      && error.code ===
        expectedCode
  );
}


test(
  "pairKey est stable quelle que soit la direction",
  () => {
    assert.equal(
      buildPlayerPairKey(
        "uidB",
        "uidA"
      ),
      "uidA_uidB"
    );

    assert.equal(
      buildPlayerPairKey(
        "uidA",
        "uidB"
      ),
      "uidA_uidB"
    );
  }
);


test(
  "auto-invitation interdite",
  () => {
    expectCode(
      "PLAYER_INVITE_SELF_NOT_ALLOWED",
      () =>
        buildPlayerPairKey(
          "uidA",
          "uidA"
        )
    );
  }
);


test(
  "inviteeUid obligatoire",
  () => {
    expectCode(
      "PLAYER_INVITEE_UID_REQUIRED",
      () =>
        validateCreatePlayerInviteInput({
          scheduleKind:
            PlayerInviteScheduleKind.FLEXIBLE,
        })
    );
  }
);


test(
  "scheduleKind invalide refusé",
  () => {
    expectCode(
      "PLAYER_INVITE_INVALID_SCHEDULE_KIND",
      () =>
        validateCreatePlayerInviteInput({
          inviteeUid:
            "uidB",
          scheduleKind:
            "random",
        })
    );
  }
);


test(
  "exactDate exige proposedStartAt",
  () => {
    expectCode(
      "PLAYER_INVITE_START_REQUIRED",
      () =>
        validateCreatePlayerInviteInput({
          inviteeUid:
            "uidB",
          scheduleKind:
            PlayerInviteScheduleKind.EXACT_DATE,
        })
    );
  }
);


test(
  "dateRange exige début et fin",
  () => {
    expectCode(
      "PLAYER_INVITE_DATE_RANGE_REQUIRED",
      () =>
        validateCreatePlayerInviteInput({
          inviteeUid:
            "uidB",
          scheduleKind:
            PlayerInviteScheduleKind.DATE_RANGE,
          proposedStartAt:
            123,
        })
    );
  }
);


test(
  "flexible accepte aucune date",
  () => {
    const result =
      validateCreatePlayerInviteInput({
        inviteeUid:
          " uidB ",
        scheduleKind:
          PlayerInviteScheduleKind.FLEXIBLE,
      });

    assert.equal(
      result.inviteeUid,
      "uidB"
    );

    assert.equal(
      result.timePreference,
      PlayerInviteTimePreference.ANY
    );
  }
);


test(
  "timePreference valide",
  () => {
    const result =
      validateCreatePlayerInviteInput({
        inviteeUid:
          "uidB",
        scheduleKind:
          PlayerInviteScheduleKind.FLEXIBLE,
        timePreference:
          PlayerInviteTimePreference.EVENING,
      });

    assert.equal(
      result.timePreference,
      "evening"
    );
  }
);


test(
  "timePreference invalide refusé",
  () => {
    expectCode(
      "PLAYER_INVITE_INVALID_TIME_PREFERENCE",
      () =>
        validateCreatePlayerInviteInput({
          inviteeUid:
            "uidB",
          scheduleKind:
            PlayerInviteScheduleKind.FLEXIBLE,
          timePreference:
            "night",
        })
    );
  }
);


test(
  "message est trim et facultatif",
  () => {
    const result =
      validateCreatePlayerInviteInput({
        inviteeUid:
          "uidB",
        scheduleKind:
          PlayerInviteScheduleKind.FLEXIBLE,
        message:
          "  Ça te dit une partie ?  ",
      });

    assert.equal(
      result.message,
      "Ça te dit une partie ?"
    );
  }
);


test(
  "message > 280 refusé",
  () => {
    expectCode(
      "PLAYER_INVITE_MESSAGE_TOO_LONG",
      () =>
        validateCreatePlayerInviteInput({
          inviteeUid:
            "uidB",
          scheduleKind:
            PlayerInviteScheduleKind.FLEXIBLE,
          message:
            "x".repeat(281),
        })
    );
  }
);


console.log("");
console.log(
  `${passed} tests Player Invite To Play PASS`
);
