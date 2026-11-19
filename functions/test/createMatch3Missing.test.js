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

test("buildParticipants replaces placeholders with selected group members", () => {
  assert.deepEqual(
    buildParticipants("creator", 1, ["member_a", "member_b"]),
    ["creator", "member_a", "member_b"]
  );
});

test("buildParticipants supports a selected group member and an external friend", () => {
  assert.deepEqual(
    buildParticipants("creator", 1, ["member_a"]),
    ["creator", "member_a", "ami_de_creator:Joueur 1"]
  );
});

test("buildParticipants supports one preconfirmed member when two players are missing", () => {
  assert.deepEqual(
    buildParticipants("creator", 2, ["member_a"]),
    ["creator", "member_a"]
  );
});
