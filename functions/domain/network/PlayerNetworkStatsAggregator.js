const SCHEMA_VERSION = 1;

function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isExternalPlaceholder(value) {
  const raw = asString(value);

  return Boolean(
    raw
    && (
      raw.startsWith("ami_de_")
      || raw.startsWith("friend_")
    )
  );
}

function isRealUid(value) {
  const raw = asString(value);

  return Boolean(
    raw
    && !isExternalPlaceholder(raw)
  );
}

function getCreatorUid(match) {
  const candidates = [
    match?.createurUid,
    match?.creatorUid,
    match?.ownerUid,
    match?.createdByUid,
    match?.userId,
  ];

  for (const candidate of candidates) {
    if (isRealUid(candidate)) {
      return asString(candidate);
    }
  }

  return "";
}

function extractParticipant(matchParticipant) {
  if (typeof matchParticipant === "string") {
    const raw = asString(matchParticipant);

    if (!raw) {
      return {
        type: "unknown",
        uid: "",
      };
    }

    if (isExternalPlaceholder(raw)) {
      return {
        type: "external",
        uid: "",
      };
    }

    return {
      type: "padima",
      uid: raw,
    };
  }

  if (
    matchParticipant
    && typeof matchParticipant === "object"
  ) {
    const candidates = [
      matchParticipant.uid,
      matchParticipant.userUid,
      matchParticipant.playerUid,
      matchParticipant.id,
    ];

    for (const candidate of candidates) {
      const raw = asString(candidate);

      if (!raw) {
        continue;
      }

      if (isExternalPlaceholder(raw)) {
        return {
          type: "external",
          uid: "",
        };
      }

      return {
        type: "padima",
        uid: raw,
      };
    }

    return {
      type: "unknown",
      uid: "",
    };
  }

  return {
    type: "unknown",
    uid: "",
  };
}

function extractMatchActors(match) {
  const creatorUid = getCreatorUid(match);

  const realUids = new Set();

  if (creatorUid) {
    realUids.add(creatorUid);
  }

  let externalSlots = 0;
  let unknownSlots = 0;

  const participants =
    Array.isArray(match?.participants)
      ? match.participants
      : [];

  for (const participant of participants) {
    const result =
      extractParticipant(participant);

    if (result.type === "padima") {
      realUids.add(result.uid);
      continue;
    }

    if (result.type === "external") {
      externalSlots += 1;
      continue;
    }

    unknownSlots += 1;
  }

  return {
    creatorUid,
    realUids: [...realUids],
    externalSlots,
    unknownSlots,
  };
}

function timestampToMs(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value === "object"
    && typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value === "number"
    && Number.isFinite(value)
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed =
      Date.parse(value);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}

function getActivityMs(match) {
  const candidates = [
    match?.dateHeure,
    match?.dateTime,
    match?.startAt,
    match?.createdAt,
  ];

  for (const candidate of candidates) {
    const ms =
      timestampToMs(candidate);

    if (ms !== null) {
      return ms;
    }
  }

  return null;
}

function getPlaceId(match) {
  return (
    asString(match?.placeId)
    || asString(match?.clubId)
    || ""
  );
}

function pairKey(a, b) {
  return [a, b]
    .sort()
    .join("__");
}

function ensurePlayerState(map, uid) {
  if (!map.has(uid)) {
    map.set(uid, {
      uid,

      matchesCreated: 0,
      matchesPlayed: 0,

      matchesWithOtherPadimaPlayers: 0,
      matchesWithExternalPlayers: 0,

      externalParticipantSlots: 0,
      unknownParticipantSlots: 0,

      uniquePadimaPlayersSeen: new Set(),
      repeatedPadimaPlayers: new Set(),

      placeCounts: new Map(),

      firstActivityAtMs: null,
      lastActivityAtMs: null,
    });
  }

  return map.get(uid);
}

function updateActivityRange(state, activityMs) {
  if (activityMs === null) {
    return;
  }

  state.firstActivityAtMs =
    state.firstActivityAtMs === null
      ? activityMs
      : Math.min(
          state.firstActivityAtMs,
          activityMs,
        );

  state.lastActivityAtMs =
    state.lastActivityAtMs === null
      ? activityMs
      : Math.max(
          state.lastActivityAtMs,
          activityMs,
        );
}

function incrementPlace(state, placeId) {
  if (!placeId) {
    return;
  }

  state.placeCounts.set(
    placeId,
    (state.placeCounts.get(placeId) || 0) + 1,
  );
}

function serializeTopPlaces(placeCounts, limit = 5) {
  return [...placeCounts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1]
        || a[0].localeCompare(b[0]),
    )
    .slice(0, limit)
    .map(([placeId, matchCount]) => ({
      placeId,
      matchCount,
    }));
}

export function buildPlayerNetworkStats(matches) {
  if (!Array.isArray(matches)) {
    throw new TypeError(
      "matches must be an array",
    );
  }

  const players = new Map();
  const pairMatchCounts = new Map();

  for (const match of matches) {
    if (!match || typeof match !== "object") {
      continue;
    }

    const {
      creatorUid,
      realUids,
      externalSlots,
      unknownSlots,
    } = extractMatchActors(match);

    if (realUids.length === 0) {
      continue;
    }

    const activityMs =
      getActivityMs(match);

    const placeId =
      getPlaceId(match);

    for (const uid of realUids) {
      const state =
        ensurePlayerState(
          players,
          uid,
        );

      state.matchesPlayed += 1;

      if (realUids.length >= 2) {
        state.matchesWithOtherPadimaPlayers += 1;
      }

      if (externalSlots > 0) {
        state.matchesWithExternalPlayers += 1;
      }

      state.externalParticipantSlots +=
        externalSlots;

      state.unknownParticipantSlots +=
        unknownSlots;

      updateActivityRange(
        state,
        activityMs,
      );

      incrementPlace(
        state,
        placeId,
      );

      for (const otherUid of realUids) {
        if (otherUid !== uid) {
          state.uniquePadimaPlayersSeen.add(
            otherUid,
          );
        }
      }
    }

    if (creatorUid) {
      const creator =
        ensurePlayerState(
          players,
          creatorUid,
        );

      creator.matchesCreated += 1;
    }

    for (
      let i = 0;
      i < realUids.length;
      i += 1
    ) {
      for (
        let j = i + 1;
        j < realUids.length;
        j += 1
      ) {
        const key =
          pairKey(
            realUids[i],
            realUids[j],
          );

        pairMatchCounts.set(
          key,
          (pairMatchCounts.get(key) || 0) + 1,
        );
      }
    }
  }

  for (
    const [key, matchCount]
    of pairMatchCounts
  ) {
    if (matchCount < 2) {
      continue;
    }

    const separatorIndex =
      key.indexOf("__");

    if (separatorIndex < 0) {
      continue;
    }

    const playerAUid =
      key.slice(
        0,
        separatorIndex,
      );

    const playerBUid =
      key.slice(
        separatorIndex + 2,
      );

    const playerA =
      players.get(playerAUid);

    const playerB =
      players.get(playerBUid);

    if (playerA) {
      playerA.repeatedPadimaPlayers.add(
        playerBUid,
      );
    }

    if (playerB) {
      playerB.repeatedPadimaPlayers.add(
        playerAUid,
      );
    }
  }

  return [...players.values()]
    .map((state) => ({
      schemaVersion:
        SCHEMA_VERSION,

      uid:
        state.uid,

      matchesCreated:
        state.matchesCreated,

      matchesPlayed:
        state.matchesPlayed,

      uniquePadimaPlayersSeen:
        state.uniquePadimaPlayersSeen.size,

      repeatedPadimaPlayers:
        state.repeatedPadimaPlayers.size,

      matchesWithOtherPadimaPlayers:
        state.matchesWithOtherPadimaPlayers,

      matchesWithExternalPlayers:
        state.matchesWithExternalPlayers,

      externalParticipantSlots:
        state.externalParticipantSlots,

      unknownParticipantSlots:
        state.unknownParticipantSlots,

      topPlaceIds:
        serializeTopPlaces(
          state.placeCounts,
        ),

      firstActivityAtMs:
        state.firstActivityAtMs,

      lastActivityAtMs:
        state.lastActivityAtMs,
    }))
    .sort(
      (a, b) =>
        b.uniquePadimaPlayersSeen
        - a.uniquePadimaPlayersSeen
        ||
        b.matchesCreated
        - a.matchesCreated
        ||
        a.uid.localeCompare(b.uid),
    );
}

export const PlayerNetworkStatsSchemaVersion =
  SCHEMA_VERSION;

export const PlayerNetworkStatsInternals = {
  getCreatorUid,
  extractParticipant,
  extractMatchActors,
  getPlaceId,
};
