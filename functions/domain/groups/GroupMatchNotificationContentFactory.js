// Path: functions/domain/groups/GroupMatchNotificationContentFactory.js
// ======================================================
// Padima — contenus explicites des notifications de match.
//
// Responsabilités :
// - comparer l’ancien et le nouvel état d’un match ;
// - identifier la modification utile pour le destinataire ;
// - produire un titre court avec emoji ;
// - produire un message immédiatement compréhensible.
//
// Cette factory ne sélectionne pas les destinataires et n’envoie
// aucune notification.
// ======================================================


export const GroupMatchNotificationContentEvent =
  Object.freeze({
    CREATED:
      "MATCH_CREATED",

    UPDATED:
      "MATCH_UPDATED",

    CANCELLED:
      "MATCH_CANCELLED",

    PLAYER_JOINED:
      "PLAYER_JOINED",

    PLAYER_LEFT:
      "PLAYER_LEFT",

    MATCH_FULL:
      "MATCH_FULL",

    SPOT_AVAILABLE:
      "SPOT_AVAILABLE",
  });


const FIELD_GROUPS =
  Object.freeze({
    DATE_TIME: [
      "dateHeure",
      "startAt",
      "scheduledAt",
      "date",
      "time",
    ],

    PLACE: [
      "lieu",
      "placeName",
      "clubName",
      "courtLabel",
      "location",
      "address",
    ],

    LEVEL: [
      "level",
      "levelMin",
      "levelMax",
      "niveau",
      "niveauMin",
      "niveauMax",
      "minLevel",
      "maxLevel",
    ],

    CAPACITY: [
      "maxPlayers",
      "playersCount",
      "playerCount",
      "numberOfPlayers",
      "availablePlaces",
      "remainingPlaces",
      "capacity",
    ],
  });


function asString(value) {
  if (
    value === null
    || value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function asFiniteNumber(value) {
  if (
    value === null
    || value === undefined
    || value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function normalizeTimestamp(value) {
  if (
    value
    && typeof value.toMillis
      === "function"
  ) {
    const millis =
      value.toMillis();

    return Number.isFinite(millis)
      ? millis
      : null;
  }

  if (
    value
    && typeof value.toDate
      === "function"
  ) {
    const date =
      value.toDate();

    const millis =
      date instanceof Date
        ? date.getTime()
        : NaN;

    return Number.isFinite(millis)
      ? millis
      : null;
  }

  if (value instanceof Date) {
    const millis =
      value.getTime();

    return Number.isFinite(millis)
      ? millis
      : null;
  }

  const number =
    asFiniteNumber(value);

  if (number === null) {
    return null;
  }

  // Accepte les timestamps exprimés en secondes.
  return number < 100000000000
    ? number * 1000
    : number;
}


function firstDefined(
  source,
  keys
) {
  for (const key of keys) {
    const value =
      source?.[key];

    if (
      value !== null
      && value !== undefined
      && value !== ""
    ) {
      return value;
    }
  }

  return null;
}


function firstString(
  source,
  keys
) {
  return asString(
    firstDefined(
      source,
      keys
    )
  );
}


function formatDate(
  timestamp,
  frDate
) {
  if (
    timestamp === null
    || typeof frDate !== "function"
  ) {
    return "";
  }

  try {
    return asString(
      frDate(timestamp)
    );
  } catch {
    return "";
  }
}


function formatTime(
  timestamp,
  frTime
) {
  if (
    timestamp === null
    || typeof frTime !== "function"
  ) {
    return "";
  }

  try {
    return asString(
      frTime(timestamp)
    )
      .replace(":", "h");
  } catch {
    return "";
  }
}


function calendarDayKey(
  timestamp
) {
  if (timestamp === null) {
    return "";
  }

  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",

          timeZone:
            "Europe/Paris",
        }
      )
        .formatToParts(
          new Date(timestamp)
        );

    const values =
      Object.fromEntries(
        parts.map(
          ({ type, value }) =>
            [type, value]
        )
      );

    return [
      values.year,
      values.month,
      values.day,
    ].join("-");
  } catch {
    return "";
  }
}


function sameCalendarDay(
  firstTimestamp,
  secondTimestamp
) {
  const firstDay =
    calendarDayKey(
      firstTimestamp
    );

  const secondDay =
    calendarDayKey(
      secondTimestamp
    );

  return Boolean(
    firstDay
    && secondDay
    && firstDay === secondDay
  );
}


function extractTimestamp(match) {
  return normalizeTimestamp(
    firstDefined(
      match,
      [
        "dateHeure",
        "startAt",
        "scheduledAt",
        "date",
      ]
    )
  );
}


function extractPlace(match) {
  const clubName =
    firstString(
      match,
      [
        "lieu",
        "placeName",
        "clubName",
        "locationName",
      ]
    );

  const courtLabel =
    firstString(
      match,
      [
        "courtLabel",
        "terrain",
        "courtName",
      ]
    );

  if (
    clubName
    && courtLabel
    && !clubName
      .toLowerCase()
      .includes(
        courtLabel.toLowerCase()
      )
  ) {
    return `${clubName} · ${courtLabel}`;
  }

  return (
    clubName
    || courtLabel
    || firstString(
      match,
      [
        "address",
        "adresse",
        "location",
      ]
    )
  );
}


function normalizeLevel(value) {
  const number =
    asFiniteNumber(value);

  if (number !== null) {
    return Number.isInteger(number)
      ? String(number)
      : String(number)
        .replace(".", ",");
  }

  return asString(value);
}


function extractLevelRange(match) {
  const minimum =
    normalizeLevel(
      firstDefined(
        match,
        [
          "levelMin",
          "niveauMin",
          "minLevel",
        ]
      )
    );

  const maximum =
    normalizeLevel(
      firstDefined(
        match,
        [
          "levelMax",
          "niveauMax",
          "maxLevel",
        ]
      )
    );

  if (
    minimum
    && maximum
  ) {
    return minimum === maximum
      ? minimum
      : `${minimum}–${maximum}`;
  }

  return (
    minimum
    || maximum
    || normalizeLevel(
      firstDefined(
        match,
        [
          "level",
          "niveau",
        ]
      )
    )
  );
}


function extractCapacity(match) {
  const value =
    firstDefined(
      match,
      [
        "maxPlayers",
        "numberOfPlayers",
        "capacity",
        "playerCount",
        "playersCount",
      ]
    );

  const number =
    asFiniteNumber(value);

  return number !== null
    ? number
    : null;
}


function normalizeChangedKeys(
  changedKeys
) {
  if (!Array.isArray(changedKeys)) {
    return [];
  }

  return [
    ...new Set(
      changedKeys
        .map(asString)
        .filter(Boolean)
    ),
  ];
}


function hasChangedKey(
  changedKeys,
  aliases
) {
  const normalizedKeys =
    new Set(
      normalizeChangedKeys(
        changedKeys
      )
    );

  return aliases.some(
    (alias) =>
      normalizedKeys.has(alias)
  );
}


function valuesDiffer(
  first,
  second
) {
  return (
    JSON.stringify(first ?? null)
    !== JSON.stringify(second ?? null)
  );
}


function buildMatchSummary({
  match,
  frDate,
  frTime,
}) {
  const timestamp =
    extractTimestamp(match);

  const date =
    formatDate(
      timestamp,
      frDate
    );

  const time =
    formatTime(
      timestamp,
      frTime
    );

  const place =
    extractPlace(match);

  const parts = [];

  if (date) {
    parts.push(date);
  }

  if (time) {
    parts.push(`à ${time}`);
  }

  if (place) {
    parts.push(`au ${place}`);
  }

  return parts.join(" ");
}


function createCreatedContent({
  group,
  actorProfile,
  match,
  frDate,
  frTime,
}) {
  const groupName =
    firstString(
      group,
      [
        "name",
        "groupName",
        "title",
      ]
    )
    || "ton groupe";

  const actorPseudo =
    firstString(
      actorProfile,
      [
        "pseudo",
        "username",
        "displayName",
      ]
    )
    || "Un membre";

  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      `🆕 Nouveau match dans ${groupName}`,

    body:
      summary
        ? `${actorPseudo} a créé un match ${summary}.`
        : `${actorPseudo} a créé un nouveau match.`,

    subtype:
      "match_created",

    changeType:
      "created",
  };
}


function createCancelledContent({
  actorProfile,
  match,
  frDate,
  frTime,
}) {
  const actorPseudo =
    firstString(
      actorProfile,
      [
        "pseudo",
        "username",
        "displayName",
      ]
    )
    || "L’organisateur";

  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      "❌ Match annulé",

    body:
      summary
        ? `${actorPseudo} a annulé le match prévu ${summary}.`
        : `${actorPseudo} a annulé un match du groupe.`,

    subtype:
      "match_cancelled",

    changeType:
      "cancelled",
  };
}


function actorDisplayPseudo(
  actorProfile = {}
) {
  return (
    firstString(
      actorProfile,
      [
        "pseudo",
        "username",
        "displayName",
        "name",
      ]
    )
    || "Un joueur"
  );
}


function createPlayerJoinedContent({
  actorProfile,
  match,
  frDate,
  frTime,
}) {
  const actorPseudo =
    actorDisplayPseudo(
      actorProfile
    );

  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      `✅ ${actorPseudo} rejoint le match`,

    body:
      summary
        ? `${actorPseudo} participe maintenant au match · ${summary}`
        : `${actorPseudo} participe maintenant au match.`,

    subtype:
      "match_player_joined",

    changeType:
      "player_joined",
  };
}


function createPlayerLeftContent({
  actorProfile,
  match,
  frDate,
  frTime,
}) {
  const actorPseudo =
    actorDisplayPseudo(
      actorProfile
    );

  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      `↩️ ${actorPseudo} a quitté le match`,

    body:
      summary
        ? `Une place peut être disponible · ${summary}`
        : "Une place peut être disponible sur le match.",

    subtype:
      "match_player_left",

    changeType:
      "player_left",
  };
}


function createMatchFullContent({
  match,
  frDate,
  frTime,
}) {
  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      "🔒 Le match est complet",

    body:
      summary
        ? `Toutes les places sont prises · ${summary}`
        : "Toutes les places du match sont désormais prises.",

    subtype:
      "match_full",

    changeType:
      "match_full",
  };
}


function createSpotAvailableContent({
  match,
  frDate,
  frTime,
}) {
  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      "🎉 Une place est disponible",

    body:
      summary
        ? `Une place vient de se libérer · ${summary}`
        : "Une place vient de se libérer sur le match.",

    subtype:
      "match_spot_available",

    changeType:
      "spot_available",
  };
}


function detectChanges({
  previousMatch,
  match,
  changedKeys,
}) {
  const previousTimestamp =
    extractTimestamp(
      previousMatch
    );

  const nextTimestamp =
    extractTimestamp(match);

  const timestampChanged =
    previousTimestamp !== null
    && nextTimestamp !== null
    && previousTimestamp
      !== nextTimestamp;

  const dateChanged =
    timestampChanged
    && previousTimestamp !== null
    && nextTimestamp !== null
    && !sameCalendarDay(
      previousTimestamp,
      nextTimestamp
    );

  const timeChanged =
    timestampChanged
    && (
      previousTimestamp === null
      || nextTimestamp === null
      || sameCalendarDay(
        previousTimestamp,
        nextTimestamp
      )
    );

  const previousPlace =
    extractPlace(
      previousMatch
    );

  const nextPlace =
    extractPlace(match);

  const placeChanged =
    previousPlace !== nextPlace
    && Boolean(
      previousPlace
      || nextPlace
    );

  const previousLevel =
    extractLevelRange(
      previousMatch
    );

  const nextLevel =
    extractLevelRange(match);

  const levelChanged =
    previousLevel !== nextLevel
    && Boolean(
      previousLevel
      || nextLevel
    );

  const previousCapacity =
    extractCapacity(
      previousMatch
    );

  const nextCapacity =
    extractCapacity(match);

  const capacityChanged =
    previousCapacity !== nextCapacity
    && (
      previousCapacity !== null
      || nextCapacity !== null
    );

  const detected = [];

  if (dateChanged) {
    detected.push("date");
  }

  if (timeChanged) {
    detected.push("time");
  }

  if (placeChanged) {
    detected.push("place");
  }

  if (levelChanged) {
    detected.push("level");
  }

  if (capacityChanged) {
    detected.push("capacity");
  }

  return {
    detected,

    previousTimestamp,
    nextTimestamp,

    previousPlace,
    nextPlace,

    previousLevel,
    nextLevel,

    previousCapacity,
    nextCapacity,
  };
}


function buildMultipleChangesBody({
  detected,
  actorPseudo,
}) {
  const labels = {
    date:
      "la date",

    time:
      "l’heure",

    place:
      "le lieu",

    level:
      "le niveau",

    capacity:
      "le nombre de places",
  };

  const changes =
    detected
      .map(
        (change) =>
          labels[change]
      )
      .filter(Boolean);

  if (!changes.length) {
    return `${actorPseudo} a modifié les informations du match.`;
  }

  if (changes.length === 1) {
    return `${actorPseudo} a modifié ${changes[0]} du match.`;
  }

  const last =
    changes.pop();

  return `${actorPseudo} a modifié ${changes.join(", ")} et ${last} du match.`;
}


function createUpdatedContent({
  previousMatch,
  match,
  actorProfile,
  changedKeys,
  frDate,
  frTime,
}) {
  const actorPseudo =
    firstString(
      actorProfile,
      [
        "pseudo",
        "username",
        "displayName",
      ]
    )
    || "Un membre";

  const changes =
    detectChanges({
      previousMatch,
      match,
      changedKeys,
    });

  if (
    changes.detected.length > 1
  ) {
    return {
      title:
        "✏️ Match mis à jour",

      body:
        buildMultipleChangesBody({
          detected:
            changes.detected,

          actorPseudo,
        }),

      subtype:
        "match_updated",

      changeType:
        "multiple",

      detectedChanges:
        changes.detected,
    };
  }

  if (
    changes.detected[0]
      === "date"
  ) {
    const previousDate =
      formatDate(
        changes.previousTimestamp,
        frDate
      );

    const nextDate =
      formatDate(
        changes.nextTimestamp,
        frDate
      );

    return {
      title:
        "📅 Date modifiée",

      body:
        previousDate
        && nextDate
        && previousDate !== nextDate
          ? `Le match est déplacé du ${previousDate} au ${nextDate}.`
          : nextDate
            ? `Le match aura finalement lieu le ${nextDate}.`
            : `${actorPseudo} a modifié la date du match.`,

      subtype:
        "match_date_updated",

      changeType:
        "date",

      detectedChanges:
        changes.detected,
    };
  }

  if (
    changes.detected[0]
      === "time"
  ) {
    const previousTime =
      formatTime(
        changes.previousTimestamp,
        frTime
      );

    const nextTime =
      formatTime(
        changes.nextTimestamp,
        frTime
      );

    return {
      title:
        "⏰ Horaire modifié",

      body:
        previousTime
        && nextTime
        && previousTime !== nextTime
          ? `Le match est déplacé de ${previousTime} à ${nextTime}.`
          : nextTime
            ? `Le match aura finalement lieu à ${nextTime}.`
            : `${actorPseudo} a modifié l’horaire du match.`,

      subtype:
        "match_time_updated",

      changeType:
        "time",

      detectedChanges:
        changes.detected,
    };
  }

  if (
    changes.detected[0]
      === "place"
  ) {
    return {
      title:
        "📍 Nouveau lieu",

      body:
        changes.previousPlace
        && changes.nextPlace
        && changes.previousPlace
          !== changes.nextPlace
          ? `Le match est déplacé de ${changes.previousPlace} à ${changes.nextPlace}.`
          : changes.nextPlace
            ? `Le match se jouera finalement au ${changes.nextPlace}.`
            : `${actorPseudo} a modifié le lieu du match.`,

      subtype:
        "match_place_updated",

      changeType:
        "place",

      detectedChanges:
        changes.detected,
    };
  }

  if (
    changes.detected[0]
      === "level"
  ) {
    return {
      title:
        "🎯 Niveau modifié",

      body:
        changes.previousLevel
        && changes.nextLevel
        && changes.previousLevel
          !== changes.nextLevel
          ? `Le niveau recherché passe de ${changes.previousLevel} à ${changes.nextLevel}.`
          : changes.nextLevel
            ? `Le niveau recherché est désormais ${changes.nextLevel}.`
            : `${actorPseudo} a modifié le niveau recherché.`,

      subtype:
        "match_level_updated",

      changeType:
        "level",

      detectedChanges:
        changes.detected,
    };
  }

  if (
    changes.detected[0]
      === "capacity"
  ) {
    return {
      title:
        "👥 Places modifiées",

      body:
        changes.nextCapacity !== null
          ? `Le match est désormais limité à ${changes.nextCapacity} joueur${changes.nextCapacity > 1 ? "s" : ""}.`
          : `${actorPseudo} a modifié le nombre de places du match.`,

      subtype:
        "match_capacity_updated",

      changeType:
        "capacity",

      detectedChanges:
        changes.detected,
    };
  }

  const summary =
    buildMatchSummary({
      match,
      frDate,
      frTime,
    });

  return {
    title:
      "✏️ Match mis à jour",

    body:
      summary
        ? `${actorPseudo} a modifié le match prévu ${summary}.`
        : `${actorPseudo} a modifié les informations du match.`,

    subtype:
      "match_updated",

    changeType:
      "generic",

    detectedChanges: [],
  };
}


export function buildGroupMatchNotificationContentFactory({
  frDate,
  frTime,
}) {
  if (typeof frDate !== "function") {
    throw new TypeError(
      "FR_DATE_REQUIRED"
    );
  }

  if (typeof frTime !== "function") {
    throw new TypeError(
      "FR_TIME_REQUIRED"
    );
  }

  return function createGroupMatchNotificationContent({
    event,
    group = {},
    previousMatch = {},
    match = {},
    actorProfile = {},
    changedKeys = [],
  }) {
    switch (event) {
      case GroupMatchNotificationContentEvent
        .CREATED:
        return createCreatedContent({
          group,
          actorProfile,
          match,
          frDate,
          frTime,
        });

      case GroupMatchNotificationContentEvent
        .UPDATED:
        return createUpdatedContent({
          previousMatch,
          match,
          actorProfile,
          changedKeys,
          frDate,
          frTime,
        });

      case GroupMatchNotificationContentEvent
        .CANCELLED:
        return createCancelledContent({
          actorProfile,
          match,
          frDate,
          frTime,
        });

      case GroupMatchNotificationContentEvent
        .PLAYER_JOINED:
        return createPlayerJoinedContent({
          actorProfile,
          match,
          frDate,
          frTime,
        });

      case GroupMatchNotificationContentEvent
        .PLAYER_LEFT:
        return createPlayerLeftContent({
          actorProfile,
          match,
          frDate,
          frTime,
        });

      case GroupMatchNotificationContentEvent
        .MATCH_FULL:
        return createMatchFullContent({
          match,
          frDate,
          frTime,
        });

      case GroupMatchNotificationContentEvent
        .SPOT_AVAILABLE:
        return createSpotAvailableContent({
          match,
          frDate,
          frTime,
        });

      default:
        throw new TypeError(
          "UNSUPPORTED_GROUP_MATCH_NOTIFICATION_CONTENT_EVENT"
        );
    }
  };
}


// Exports ciblés pour de futurs tests unitaires.
export const GroupMatchNotificationContentInternals =
  Object.freeze({
    extractTimestamp,
    extractPlace,
    extractLevelRange,
    extractCapacity,
    detectChanges,
    buildMatchSummary,
    valuesDiffer,
  });
