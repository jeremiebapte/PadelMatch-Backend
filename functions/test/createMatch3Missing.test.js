import test from "node:test";
import assert from "node:assert/strict";

import {
  buildParticipants,
} from "../createMatch.js";

test("buildParticipants preserves legacy behavior for 1 missing player", () => {
  assert.deepEqual(
    buildParticipants("user_123", 1),
    [
      "user_123",
      "ami_de_user_123:Joueur 1",
      "ami_de_user_123:Joueur 2",
    ]
  );
});

test("buildParticipants preserves legacy behavior for 2 missing players", () => {
  assert.deepEqual(
    buildParticipants("user_123", 2),
    [
      "user_123",
      "ami_de_user_123:Joueur 1",
    ]
  );
});

test("buildParticipants supports a solo creator looking for 3 players", () => {
  assert.deepEqual(
    buildParticipants("user_123", 3),
    [
      "user_123",
    ]
  );
});
