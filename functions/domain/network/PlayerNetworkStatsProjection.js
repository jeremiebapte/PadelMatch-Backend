const PROJECTION_SCHEMA_VERSION = 1;

function finiteNumber(value, fallback = 0) {
  return (
    typeof value === "number"
    && Number.isFinite(value)
  )
    ? value
    : fallback;
}

function nullableFiniteNumber(value) {
  return (
    typeof value === "number"
    && Number.isFinite(value)
  )
    ? value
    : null;
}

function sanitizeTopPlaces(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item) =>
        item
        && typeof item === "object"
        && typeof item.placeId === "string"
        && item.placeId.trim()
    )
    .slice(0, 5)
    .map((item) => ({
      placeId:
        item.placeId.trim(),

      matchCount:
        Math.max(
          0,
          finiteNumber(
            item.matchCount,
            0,
          ),
        ),
    }));
}

export function buildPlayerNetworkStatsDocument(
  stats,
  {
    generatedAtMs = Date.now(),
  } = {},
) {
  if (
    !stats
    || typeof stats !== "object"
    || typeof stats.uid !== "string"
    || !stats.uid.trim()
  ) {
    throw new TypeError(
      "stats.uid is required",
    );
  }

  const uid =
    stats.uid.trim();

  return {
    uid,

    schemaVersion:
      PROJECTION_SCHEMA_VERSION,

    sourceSchemaVersion:
      finiteNumber(
        stats.schemaVersion,
        1,
      ),

    matchesCreated:
      Math.max(
        0,
        finiteNumber(
          stats.matchesCreated,
          0,
        ),
      ),

    matchesPlayed:
      Math.max(
        0,
        finiteNumber(
          stats.matchesPlayed,
          0,
        ),
      ),

    uniquePadimaPlayersSeen:
      Math.max(
        0,
        finiteNumber(
          stats.uniquePadimaPlayersSeen,
          0,
        ),
      ),

    repeatedPadimaPlayers:
      Math.max(
        0,
        finiteNumber(
          stats.repeatedPadimaPlayers,
          0,
        ),
      ),

    matchesWithOtherPadimaPlayers:
      Math.max(
        0,
        finiteNumber(
          stats.matchesWithOtherPadimaPlayers,
          0,
        ),
      ),

    matchesWithExternalPlayers:
      Math.max(
        0,
        finiteNumber(
          stats.matchesWithExternalPlayers,
          0,
        ),
      ),

    externalParticipantSlots:
      Math.max(
        0,
        finiteNumber(
          stats.externalParticipantSlots,
          0,
        ),
      ),

    unknownParticipantSlots:
      Math.max(
        0,
        finiteNumber(
          stats.unknownParticipantSlots,
          0,
        ),
      ),

    topPlaceIds:
      sanitizeTopPlaces(
        stats.topPlaceIds,
      ),

    firstActivityAtMs:
      nullableFiniteNumber(
        stats.firstActivityAtMs,
      ),

    lastActivityAtMs:
      nullableFiniteNumber(
        stats.lastActivityAtMs,
      ),

    generatedAtMs:
      finiteNumber(
        generatedAtMs,
        Date.now(),
      ),

    source:
      "matches_backfill",
  };
}

export const PlayerNetworkStatsProjectionSchemaVersion =
  PROJECTION_SCHEMA_VERSION;
