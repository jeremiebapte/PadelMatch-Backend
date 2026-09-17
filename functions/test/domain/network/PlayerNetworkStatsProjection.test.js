import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlayerNetworkStatsDocument,
  PlayerNetworkStatsProjectionSchemaVersion,
} from "../../../domain/network/PlayerNetworkStatsProjection.js";

test(
  "builds canonical playerNetworkStats document",
  () => {
    const doc =
      buildPlayerNetworkStatsDocument(
        {
          uid: "player_A",
          schemaVersion: 1,
          matchesCreated: 12,
          matchesPlayed: 20,
          uniquePadimaPlayersSeen: 8,
          repeatedPadimaPlayers: 3,
          matchesWithOtherPadimaPlayers: 9,
          matchesWithExternalPlayers: 15,
          externalParticipantSlots: 24,
          unknownParticipantSlots: 0,
          topPlaceIds: [
            {
              placeId: "place_1",
              matchCount: 10,
            },
            {
              placeId: "place_2",
              matchCount: 4,
            },
          ],
          firstActivityAtMs: 1000,
          lastActivityAtMs: 5000,
        },
        {
          generatedAtMs: 9000,
        },
      );

    assert.equal(
      PlayerNetworkStatsProjectionSchemaVersion,
      1,
    );

    assert.deepEqual(
      doc,
      {
        uid: "player_A",
        schemaVersion: 1,
        sourceSchemaVersion: 1,
        matchesCreated: 12,
        matchesPlayed: 20,
        uniquePadimaPlayersSeen: 8,
        repeatedPadimaPlayers: 3,
        matchesWithOtherPadimaPlayers: 9,
        matchesWithExternalPlayers: 15,
        externalParticipantSlots: 24,
        unknownParticipantSlots: 0,
        topPlaceIds: [
          {
            placeId: "place_1",
            matchCount: 10,
          },
          {
            placeId: "place_2",
            matchCount: 4,
          },
        ],
        firstActivityAtMs: 1000,
        lastActivityAtMs: 5000,
        generatedAtMs: 9000,
        source: "matches_backfill",
      },
    );
  },
);


test(
  "rejects missing uid",
  () => {
    assert.throws(
      () =>
        buildPlayerNetworkStatsDocument(
          {},
        ),
      /stats\.uid is required/,
    );
  },
);


test(
  "sanitizes negative and invalid counters",
  () => {
    const doc =
      buildPlayerNetworkStatsDocument(
        {
          uid: "A",
          matchesCreated: -4,
          matchesPlayed: NaN,
          uniquePadimaPlayersSeen: 2,
          repeatedPadimaPlayers: -1,
          topPlaceIds: [
            {
              placeId: "",
              matchCount: 20,
            },
            {
              placeId: "valid",
              matchCount: -3,
            },
          ],
        },
        {
          generatedAtMs: 100,
        },
      );

    assert.equal(
      doc.matchesCreated,
      0,
    );

    assert.equal(
      doc.matchesPlayed,
      0,
    );

    assert.equal(
      doc.repeatedPadimaPlayers,
      0,
    );

    assert.deepEqual(
      doc.topPlaceIds,
      [
        {
          placeId: "valid",
          matchCount: 0,
        },
      ],
    );
  },
);


test(
  "contains no connector score or badge decision",
  () => {
    const doc =
      buildPlayerNetworkStatsDocument(
        {
          uid: "A",
        },
      );

    assert.equal(
      Object.hasOwn(
        doc,
        "connectorScore",
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        doc,
        "badge",
      ),
      false,
    );
  },
);
