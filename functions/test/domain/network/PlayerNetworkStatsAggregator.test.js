import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlayerNetworkStats,
  PlayerNetworkStatsSchemaVersion,
} from "../../../domain/network/PlayerNetworkStatsAggregator.js";

function byUid(rows, uid) {
  const row =
    rows.find(
      (item) => item.uid === uid,
    );

  assert.ok(
    row,
    `Missing stats for ${uid}`,
  );

  return row;
}

test(
  "builds factual network stats from Padima match schema",
  () => {
    const matches = [
      {
        createurUid: "AAAAAAAAAAAAAAAAAAAA",
        participants: [
          "AAAAAAAAAAAAAAAAAAAA",
          "BBBBBBBBBBBBBBBBBBBB",
          "ami_de_A_1",
          "ami_de_A_2",
        ],
        placeId: "place_1",
        dateHeure: 1000,
      },
      {
        createurUid: "AAAAAAAAAAAAAAAAAAAA",
        participants: [
          "AAAAAAAAAAAAAAAAAAAA",
          "BBBBBBBBBBBBBBBBBBBB",
          "CCCCCCCCCCCCCCCCCCCC",
          "ami_de_A_3",
        ],
        placeId: "place_1",
        dateHeure: 2000,
      },
      {
        createurUid: "BBBBBBBBBBBBBBBBBBBB",
        participants: [
          "BBBBBBBBBBBBBBBBBBBB",
          "AAAAAAAAAAAAAAAAAAAA",
          "friend_B_1",
        ],
        placeId: "place_2",
        dateHeure: 3000,
      },
    ];

    const rows =
      buildPlayerNetworkStats(matches);

    assert.equal(
      PlayerNetworkStatsSchemaVersion,
      1,
    );

    assert.equal(
      rows.length,
      3,
    );

    const a =
      byUid(rows, "AAAAAAAAAAAAAAAAAAAA");

    assert.equal(
      a.matchesCreated,
      2,
    );

    assert.equal(
      a.matchesPlayed,
      3,
    );

    assert.equal(
      a.uniquePadimaPlayersSeen,
      2,
    );

    assert.equal(
      a.repeatedPadimaPlayers,
      1,
    );

    assert.equal(
      a.matchesWithOtherPadimaPlayers,
      3,
    );

    assert.equal(
      a.matchesWithExternalPlayers,
      2,
    );

    assert.equal(
      a.externalParticipantSlots,
      3,
    );

    assert.deepEqual(
      a.topPlaceIds,
      [
        {
          placeId: "place_1",
          matchCount: 2,
        },
        {
          placeId: "place_2",
          matchCount: 1,
        },
      ],
    );

    assert.equal(
      a.firstActivityAtMs,
      1000,
    );

    assert.equal(
      a.lastActivityAtMs,
      3000,
    );

    const b =
      byUid(rows, "BBBBBBBBBBBBBBBBBBBB");

    assert.equal(
      b.matchesCreated,
      1,
    );

    assert.equal(
      b.matchesPlayed,
      3,
    );

    assert.equal(
      b.uniquePadimaPlayersSeen,
      2,
    );

    assert.equal(
      b.repeatedPadimaPlayers,
      1,
    );

    const c =
      byUid(rows, "CCCCCCCCCCCCCCCCCCCC");

    assert.equal(
      c.matchesCreated,
      0,
    );

    assert.equal(
      c.matchesPlayed,
      1,
    );

    assert.equal(
      c.uniquePadimaPlayersSeen,
      2,
    );

    assert.equal(
      c.repeatedPadimaPlayers,
      0,
    );
  },
);


test(
  "counts creator-only matches and external slots without inventing social relations",
  () => {
    const rows =
      buildPlayerNetworkStats([
        {
          createurUid: "ORGANIZER_FIREBASE_UID_123",
          participants: [
            "ORGANIZER_FIREBASE_UID_123",
            "ami_de_ORGANIZER_1",
            "ami_de_ORGANIZER_2",
            "ami_de_ORGANIZER_3",
          ],
          placeId: "club_x",
          dateHeure: 5000,
        },
      ]);

    const organizer =
      byUid(
        rows,
        "ORGANIZER_FIREBASE_UID_123",
      );

    assert.equal(
      organizer.matchesCreated,
      1,
    );

    assert.equal(
      organizer.matchesPlayed,
      1,
    );

    assert.equal(
      organizer.uniquePadimaPlayersSeen,
      0,
    );

    assert.equal(
      organizer.repeatedPadimaPlayers,
      0,
    );

    assert.equal(
      organizer.matchesWithOtherPadimaPlayers,
      0,
    );

    assert.equal(
      organizer.matchesWithExternalPlayers,
      1,
    );

    assert.equal(
      organizer.externalParticipantSlots,
      3,
    );
  },
);


test(
  "deduplicates creator when creator is also present in participants",
  () => {
    const rows =
      buildPlayerNetworkStats([
        {
          createurUid: "AAAAAAAAAAAAAAAAAAAA",
          participants: [
            "AAAAAAAAAAAAAAAAAAAA",
            "AAAAAAAAAAAAAAAAAAAA",
            "BBBBBBBBBBBBBBBBBBBB",
          ],
        },
      ]);

    assert.equal(
      byUid(rows, "AAAAAAAAAAAAAAAAAAAA").matchesPlayed,
      1,
    );

    assert.equal(
      byUid(rows, "AAAAAAAAAAAAAAAAAAAA")
        .uniquePadimaPlayersSeen,
      1,
    );
  },
);


test(
  "external slots are credited only to the match creator",
  () => {
    const rows =
      buildPlayerNetworkStats([
        {
          createurUid: "AAAAAAAAAAAAAAAAAAAA",
          participants: [
            "AAAAAAAAAAAAAAAAAAAA",
            "BBBBBBBBBBBBBBBBBBBB",
            "ami_de_A_1",
            "ami_de_A_2",
          ],
        },
      ]);

    const a =
      byUid(rows, "AAAAAAAAAAAAAAAAAAAA");

    const b =
      byUid(rows, "BBBBBBBBBBBBBBBBBBBB");

    assert.equal(
      a.externalParticipantSlots,
      2,
    );

    assert.equal(
      a.matchesWithExternalPlayers,
      1,
    );

    assert.equal(
      b.externalParticipantSlots,
      0,
    );

    assert.equal(
      b.matchesWithExternalPlayers,
      0,
    );
  },
);


test(
  "filters participants and creators against known Padima users",
  () => {
    const rows =
      buildPlayerNetworkStats(
        [
          {
            createurUid: "REAL_A_FIREBASE_UID_123456789",
            participants: [
              "REAL_A_FIREBASE_UID_123456789",
              "REAL_B_FIREBASE_UID_123456789",
              "uA",
            ],
          },
          {
            createurUid: "uA",
            participants: [
              "uA",
              "REAL_A_FIREBASE_UID_123456789",
            ],
          },
        ],
        {
          validUserIds: new Set([
            "REAL_A_FIREBASE_UID_123456789",
            "REAL_B_FIREBASE_UID_123456789",
          ]),
        },
      );

    assert.equal(
      rows.length,
      2,
    );

    assert.equal(
      rows.some(
        (row) => row.uid === "uA",
      ),
      false,
    );

    assert.equal(
      byUid(
        rows,
        "REAL_A_FIREBASE_UID_123456789",
      ).uniquePadimaPlayersSeen,
      1,
    );

    assert.equal(
      byUid(
        rows,
        "REAL_B_FIREBASE_UID_123456789",
      ).uniquePadimaPlayersSeen,
      1,
    );
  },
);


test(
  "supports legacy creator fallback fields",
  () => {
    const rows =
      buildPlayerNetworkStats([
        {
          creatorUid: "LEGACY_FIREBASE_UID_12345",
          participants: [
            "LEGACY_FIREBASE_UID_12345",
            "OTHER_FIREBASE_UID_123456",
          ],
        },
      ]);

    assert.equal(
      byUid(
        rows,
        "LEGACY_FIREBASE_UID_12345",
      ).matchesCreated,
      1,
    );
  },
);


test(
  "does not expose an opaque connector score or badge decision",
  () => {
    const rows =
      buildPlayerNetworkStats([
        {
          createurUid: "AAAAAAAAAAAAAAAAAAAA",
          participants: [
            "AAAAAAAAAAAAAAAAAAAA",
            "BBBBBBBBBBBBBBBBBBBB",
          ],
        },
      ]);

    const a =
      byUid(rows, "AAAAAAAAAAAAAAAAAAAA");

    assert.equal(
      Object.hasOwn(
        a,
        "connectorScore",
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        a,
        "badge",
      ),
      false,
    );
  },
);


test(
  "accepts plausible historical Firebase creator even when not in current users",
  () => {
    const historicalUid =
      "HISTORICAL_FIREBASE_UID_123";

    const currentUid =
      "CURRENT_FIREBASE_UID_123456";

    const rows =
      buildPlayerNetworkStats(
        [
          {
            createurUid: historicalUid,
            participants: [
              historicalUid,
              currentUid,
            ],
            dateHeure: 1000,
          },
        ],
        {
          validUserIds:
            new Set([
              currentUid,
            ]),
        },
      );

    assert.equal(
      rows.some(
        (row) =>
          row.uid === historicalUid,
      ),
      false,
    );

    assert.equal(
      rows.some(
        (row) =>
          row.uid === currentUid,
      ),
      true,
    );
  },
);


test(
  "rejects short test-like ids",
  () => {
    const rows =
      buildPlayerNetworkStats(
        [
          {
            createurUid: "uA",
            participants: [
              "uA",
            ],
          },
        ],
        {
          validUserIds:
            new Set([
              "uA",
            ]),
        },
      );

    assert.equal(
      rows.length,
      0,
    );
  },
);


test(
  "ignores future activity dates",
  () => {
    const uid =
      "CURRENT_FIREBASE_UID_123456";

    const rows =
      buildPlayerNetworkStats(
        [
          {
            createurUid: uid,
            participants: [
              uid,
            ],
            dateHeure:
              Date.now()
              + 365 * 24 * 60 * 60 * 1000,
          },
        ],
        {
          validUserIds:
            new Set([
              uid,
            ]),
        },
      );

    const row =
      byUid(
        rows,
        uid,
      );

    assert.equal(
      row.firstActivityAtMs,
      null,
    );

    assert.equal(
      row.lastActivityAtMs,
      null,
    );
  },
);
