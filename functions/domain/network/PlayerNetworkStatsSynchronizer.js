import {
  buildPlayerNetworkStats,
  PlayerNetworkStatsInternals,
} from "./PlayerNetworkStatsAggregator.js";

import {
  buildPlayerNetworkStatsDocument,
} from "./PlayerNetworkStatsProjection.js";


function asSet(values) {
  return new Set(
    Array.isArray(values)
      ? values.filter(Boolean)
      : [],
  );
}


export function extractAffectedUserIds(
  beforeMatch,
  afterMatch,
  {
    validUserIds = null,
  } = {},
) {
  const validUidSet =
    validUserIds instanceof Set
      ? validUserIds
      : null;

  const affected =
    new Set();

  for (const match of [
    beforeMatch,
    afterMatch,
  ]) {
    if (
      !match
      || typeof match !== "object"
    ) {
      continue;
    }

    const actors =
      PlayerNetworkStatsInternals
        .extractMatchActors(match);

    for (const uid of actors.realUids) {
      if (
        !validUidSet
        || validUidSet.has(uid)
      ) {
        affected.add(uid);
      }
    }

    const creatorUid =
      actors.creatorUid;

    if (
      creatorUid
      && validUidSet?.has(creatorUid)
    ) {
      affected.add(creatorUid);
    }
  }

  return affected;
}


export function buildNetworkSyncPlan({
  matches,
  validUserIds,
  affectedUserIds,
  generatedAtMs = Date.now(),
}) {
  if (!Array.isArray(matches)) {
    throw new TypeError(
      "matches must be an array",
    );
  }

  if (!(validUserIds instanceof Set)) {
    throw new TypeError(
      "validUserIds must be a Set",
    );
  }

  const affected =
    affectedUserIds instanceof Set
      ? affectedUserIds
      : asSet(affectedUserIds);

  const allStats =
    buildPlayerNetworkStats(
      matches,
      {
        validUserIds,
      },
    );

  const statsByUid =
    new Map(
      allStats.map(
        (row) => [
          row.uid,
          row,
        ],
      ),
    );

  const upserts = [];
  const deletes = [];

  for (const uid of affected) {
    if (!validUserIds.has(uid)) {
      continue;
    }

    const stats =
      statsByUid.get(uid);

    if (!stats) {
      deletes.push(uid);
      continue;
    }

    upserts.push(
      buildPlayerNetworkStatsDocument(
        stats,
        {
          generatedAtMs,
        },
      ),
    );
  }

  upserts.sort(
    (a, b) =>
      a.uid.localeCompare(b.uid),
  );

  deletes.sort(
    (a, b) =>
      a.localeCompare(b),
  );

  return {
    upserts,
    deletes,
  };
}
