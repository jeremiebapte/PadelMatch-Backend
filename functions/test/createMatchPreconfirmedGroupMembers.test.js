import test from "node:test";
import assert from "node:assert/strict";
import { buildCreateMatch } from "../createMatch.js";

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function makeFixture({ activeMembers = ["player_a", "player_b"], groupActive = true, conflictingUid = null } = {}) {
  let storedMatch = null;
  const checkedTime = [];
  const checkedReservations = [];
  const db = {
    collection(name) {
      if (name === "groups") return {
        doc(id) {
          assert.equal(id, "group_1");
          return {
            get: async () => ({
              exists: true,
              data: () => ({ status: groupActive ? "active" : "archived", settings: {} }),
            }),
            update: async () => {},
          };
        },
      };
      if (name === "groupMemberships") return {
        doc(id) {
          const uid = id.slice("group_1_".length);
          const active = uid === "organizer" || activeMembers.includes(uid);
          return {
            get: async () => ({
              exists: active,
              data: () => ({
                userId: uid,
                groupId: "group_1",
                status: active ? "active" : "removed",
                role: uid === "organizer" ? "owner" : "member",
              }),
            }),
          };
        },
      };
      if (name === "users") return {
        doc: () => ({
          get: async () => ({
            exists: true,
            get: (name) => name === "pseudo" ? "Organisateur" : "",
          }),
        }),
      };
      if (name === "matches") return {
        add: async (value) => {
          storedMatch = value;
          return { id: "match_1" };
        },
      };
      if (name === "groupActivities") return {
        doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }),
        add: async () => ({ id: "activity_1" }),
      };
      throw Error("Unexpected collection: " + name);
    },
  };

  const handler = buildCreateMatch({
    onCall: (_, fn) => fn,
    HttpsError: FakeHttpsError,
    runtime: {},
    db,
    FieldValue: {
      serverTimestamp: () => "SERVER_TIMESTAMP",
      increment: n => n,
    },
    logger: { info() {}, warn() {}, error() {} },
    hasTimeOverlap: async (uid) => {
      checkedTime.push(uid);
      return uid === conflictingUid;
    },
    hasReservationOverlap: async (uid) => {
      checkedReservations.push(uid);
      return false;
    },
    recordClubActivity: async () => {},
    notifyGroupMatchCreated: async () => {},
    frDate: () => "24/11/2026",
    frTime: () => "18:00",
  });

  const create = (extra = {}) => handler({
    auth: { uid: "organizer" },
    data: {
      createdByType: "player",
      groupId: "group_1",
      placeId: "place_1",
      lieu: "Club",
      dateHeure: Date.now() + 86400000,
      lat: 48.85,
      lng: 2.35,
      niveau: 5,
      joueursManquants: 1,
      ...extra,
    },
  });
  return {
    create,
    getStoredMatch: () => storedMatch,
    checkedTime,
    checkedReservations,
  };
}

test("creates match with two real group members and one remaining place", async () => {
  const fixture = makeFixture();
  const result = await fixture.create({ confirmedGroupMemberIds: ["player_a", "player_b"] });
  assert.equal(result.matchId, "match_1");
  assert.deepEqual(fixture.getStoredMatch().participants,
    ["organizer", "player_a", "player_b"]);
  assert.deepEqual(fixture.getStoredMatch().organizerAddedParticipantIds,
    ["player_a", "player_b"]);
  assert.deepEqual(fixture.checkedTime,
    ["organizer", "player_a", "player_b"]);
  assert.deepEqual(fixture.checkedReservations,
    ["organizer", "player_a", "player_b"]);
});

test("keeps external friend placeholder when one group member selected", async () => {
  const fixture = makeFixture();
  await fixture.create({ confirmedGroupMemberIds: ["player_a"] });
  assert.deepEqual(fixture.getStoredMatch().participants,
    ["organizer", "player_a", "ami_de_organizer:Joueur 1"]);
});

test("refuses inactive or non-member players", async () => {
  const fixture = makeFixture();
  await assert.rejects(
    fixture.create({ confirmedGroupMemberIds: ["other_user"] }),
    e => e.code === "failed-precondition" && e.message === "CONFIRMED_MEMBER_NOT_ACTIVE"
  );
  assert.equal(fixture.getStoredMatch(), null);
});

test("rejects invalid and duplicated member IDs", async () => {
  for (const selected of [
    ["player_a", "player_a"],
    ["player_a", "other/user"],
    ["organizer", "player_a"],
    ["player_a", "player_b", "player_c"],
  ]) {
    const fixture = makeFixture();
    await assert.rejects(
      fixture.create({ confirmedGroupMemberIds: selected }),
      e => e.code === "invalid-argument"
    );
    assert.equal(fixture.getStoredMatch(), null);
  }
});

test("rejects selected players beyond reserved seats", async () => {
  const fixture = makeFixture();
  await assert.rejects(
    fixture.create({ joueursManquants: 2, confirmedGroupMemberIds: ["player_a", "player_b"] }),
    e => e.code === "invalid-argument"
  );
});

test("blocks scheduling conflicts for preselected players", async () => {
  const fixture = makeFixture({ conflictingUid: "player_b" });
  await assert.rejects(
    fixture.create({ confirmedGroupMemberIds: ["player_a", "player_b"] }),
    e => e.code === "failed-precondition" && e.message === "TIME_OVERLAP"
  );
  assert.equal(fixture.getStoredMatch(), null);
});

test("rejects preselected player IDs outside group matches", async () => {
  const fixture = makeFixture();
  await assert.rejects(
    fixture.create({ groupId: null, confirmedGroupMemberIds: ["player_a"] }),
    e => e.code === "invalid-argument"
  );
});
