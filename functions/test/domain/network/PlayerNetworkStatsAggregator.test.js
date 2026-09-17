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
        createurUid: "A",
        participants: [
          "A",
          "B",
          "ami_de_A_1",
          "ami_de_A_2",
        ],
        placeId: "place_1",
        dateHeure: 1000,
      },
      {
        createurUid: "A",
        participants: [
          "A",
          "B",
          "C",
          "ami_de_A_3",
        ],
        placeId: "place_1",
        dateHeure: 2000,
      },
      {
        createurUid: "B",
        participants: [
          "B",
          "A",
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
      byUid(rows, "A");

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
      3,
    );

    assert.equal(
      a.externalParticipantSlots,
      4,
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
      byUid(rows, "B");

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
      byUid(rows, "C");

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
          createurUid: "ORGANIZER",
          participants: [
            "ORGANIZER",
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
        "ORGANIZER",
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
          createurUid: "A",
          participants: [
            "A",
            "A",
            "B",
          ],
        },
      ]);

    assert.equal(
      byUid(rows, "A").matchesPlayed,
      1,
    );

    assert.equal(
      byUid(rows, "A")
        .uniquePadimaPlayersSeen,
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
          creatorUid: "LEGACY",
          participants: [
            "LEGACY",
            "OTHER",
          ],
        },
      ]);

    assert.equal(
      byUid(
        rows,
        "LEGACY",
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
          createurUid: "A",
          participants: [
            "A",
            "B",
          ],
        },
      ]);

    const a =
      byUid(rows, "A");

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
