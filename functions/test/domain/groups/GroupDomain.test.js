import test from "node:test";
import assert from "node:assert/strict";

import {
  GroupDiscoverability,
  GroupJoinPolicy,
  GroupMembershipSource,
  GroupRole,
  GroupType,
  buildOwnerMembership,
  calculateGroupHealth,
  membershipDocumentId,
  normalizeSearchText,
  normalizeTags,
  validateCreateGroupInput,
} from "../../../domain/groups/index.js";

test("normalizeSearchText removes accents and normalizes spaces", () => {
  assert.equal(normalizeSearchText("  Padel   Été Paris "), "padel ete paris");
});

test("normalizeTags deduplicates and caps format", () => {
  assert.deepEqual(
    normalizeTags(["Paris", "paris", "Après travail"]),
    ["paris", "apres_travail"]
  );
});

test("validateCreateGroupInput validates a searchable group", () => {
  const result = validateCreateGroupInput({
    name: "Padel du mercredi",
    description: "Groupe régulier",
    type: GroupType.FRIENDS,
    discoverability: GroupDiscoverability.SEARCHABLE,
    joinPolicy: GroupJoinPolicy.APPROVAL_REQUIRED,
    city: "Paris",
    countryCode: "fr",
    tags: ["soir", "Paris"],
    levelMin: 4,
    levelMax: 7,
  });

  assert.equal(result.nameNormalized, "padel du mercredi");
  assert.equal(result.countryCode, "FR");
  assert.deepEqual(result.tags, ["soir", "paris"]);
});

test("searchable group requires city or coordinates", () => {
  assert.throws(
    () =>
      validateCreateGroupInput({
        name: "Padel test",
        type: GroupType.FRIENDS,
        discoverability: GroupDiscoverability.SEARCHABLE,
        joinPolicy: GroupJoinPolicy.OPEN,
        countryCode: "FR",
        levelMin: 1,
        levelMax: 10,
        tags: [],
      }),
    (error) => error.code === "SEARCHABLE_GROUP_REQUIRES_LOCATION"
  );
});

test("club community requires a club id", () => {
  assert.throws(
    () =>
      validateCreateGroupInput({
        name: "Club officiel",
        type: GroupType.CLUB_COMMUNITY,
        discoverability: GroupDiscoverability.HIDDEN,
        joinPolicy: GroupJoinPolicy.INVITE_ONLY,
        countryCode: "FR",
        levelMin: 1,
        levelMax: 10,
        tags: [],
      }),
    (error) => error.code === "CLUB_COMMUNITY_REQUIRES_CLUB"
  );
});

test("membershipDocumentId is deterministic", () => {
  assert.equal(membershipDocumentId("groupA", "userB"), "groupA_userB");
});

test("buildOwnerMembership creates the single owner relation", () => {
  const now = new Date("2026-07-22T10:00:00.000Z");
  const result = buildOwnerMembership({
    groupId: "groupA",
    userId: "userA",
    now,
    user: { pseudo: "Jeremie", niveau: 6 },
  });

  assert.equal(result.role, GroupRole.OWNER);
  assert.equal(result.source, GroupMembershipSource.GROUP_CREATOR);
  assert.equal(result.userLevelSnapshot, 6);
});

test("calculateGroupHealth returns a versioned bounded score", () => {
  const result = calculateGroupHealth({
    components: {
      activity: 100,
      matchFrequency: 80,
      fillRate: 70,
      activeMembers: 90,
      retention: 60,
      reliability: 100,
    },
    hasEnoughData: true,
  });

  assert.equal(result.version, 1);
  assert.equal(result.score, 82.5);
  assert.equal(result.status, "healthy");
});
