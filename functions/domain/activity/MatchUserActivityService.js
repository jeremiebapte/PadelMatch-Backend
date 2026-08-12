// Path: functions/domain/activity/MatchUserActivityService.js

function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isRealUserId(value) {
  const userId = asString(value);

  if (!userId) {
    return false;
  }

  if (
    userId.includes(":")
    || userId.startsWith("ami_de_")
  ) {
    return false;
  }

  return true;
}

function participantUid(value) {
  if (typeof value === "string") {
    return asString(value);
  }

  if (
    value
    && typeof value === "object"
  ) {
    return asString(
      value.userId
      || value.uid
      || value.playerUid
    );
  }

  return "";
}

export function extractMatchUserIds(
  match = {},
  {
    excludedUserIds = [],
  } = {}
) {
  const excluded =
    new Set(
      excludedUserIds
        .map(asString)
        .filter(Boolean)
    );

  const candidates = [
    ...(Array.isArray(match.participants)
      ? match.participants
      : []),

    match.createurUid,
    match.creatorUid,

    match.createdByType === "player"
      ? match.createdById
      : null,
  ];

  return [
    ...new Set(
      candidates
        .map(participantUid)
        .filter(isRealUserId)
        .filter(
          (userId) =>
            !excluded.has(userId)
        )
    ),
  ];
}

function matchPlace(match = {}) {
  return asString(
    match.lieu
    || match.placeName
  );
}

function actorPseudo(
  actorProfile = {}
) {
  return asString(
    actorProfile.pseudo
    || actorProfile.username
    || actorProfile.displayName
  ) || "Un joueur";
}

function actorAvatar(
  actorProfile = {}
) {
  return asString(
    actorProfile.avatar
    || actorProfile.avatarURL
    || actorProfile.photoURL
    || actorProfile.photoUrl
  );
}

function contentFor({
  type,
  actorProfile,
  match,
}) {
  const pseudo =
    actorPseudo(actorProfile);

  const place =
    matchPlace(match);

  switch (type) {
    case "match_player_joined":
      return {
        title:
          `${pseudo} rejoint ton match`,
        subtitle:
          place
            ? `Match à ${place}`
            : "Un joueur vient de rejoindre la partie.",
      };

    case "match_player_left":
      return {
        title:
          `${pseudo} s’est désisté`,
        subtitle:
          place
            ? `Match à ${place}`
            : "Une place vient de se libérer.",
      };

    case "match_updated":
      return {
        title:
          "Ton match a été modifié",
        subtitle:
          place
            ? `Match à ${place}`
            : "Consulte les nouvelles informations du match.",
      };

    case "match_cancelled":
      return {
        title:
          "Ton match a été annulé",
        subtitle:
          place
            ? `Match à ${place}`
            : "La partie a été annulée.",
      };

    default:
      throw new Error(
        `UNSUPPORTED_MATCH_USER_ACTIVITY_TYPE:${type}`
      );
  }
}

export function buildRecordMatchUserActivities({
  recordUserActivity,
  logger = console,
}) {
  if (
    typeof recordUserActivity
    !== "function"
  ) {
    throw new TypeError(
      "RECORD_USER_ACTIVITY_REQUIRED"
    );
  }

  return async function recordMatchUserActivities({
    type,
    matchId,
    match = {},
    actorUid,
    actorProfile = {},
    sourceId,
    metadata = {},
  }) {
    const normalizedMatchId =
      asString(matchId);

    const normalizedActorUid =
      asString(actorUid);

    if (!normalizedMatchId) {
      throw new Error(
        "MATCH_USER_ACTIVITY_MATCH_ID_MISSING"
      );
    }

    const recipients =
      extractMatchUserIds(
        match,
        {
          excludedUserIds:
            normalizedActorUid
              ? [normalizedActorUid]
              : [],
        }
      );

    if (!recipients.length) {
      return {
        recipientCount: 0,
        activityIds: [],
      };
    }

    const content =
      contentFor({
        type,
        actorProfile,
        match,
      });

    const pseudo =
      actorPseudo(actorProfile);

    const avatar =
      actorAvatar(actorProfile);

    const activityIds = [];

    for (const userId of recipients) {
      try {
        const activity =
          await recordUserActivity({
            userId,
            type,

            entityType:
              "match",

            entityId:
              normalizedMatchId,

            matchId:
              normalizedMatchId,

            ...(asString(match.groupId)
              ? {
                  groupId:
                    asString(match.groupId),
                }
              : {}),

            ...(normalizedActorUid
              ? {
                  actorUid:
                    normalizedActorUid,
                }
              : {}),

            ...(pseudo
              ? {
                  actorPseudoSnapshot:
                    pseudo,
                }
              : {}),

            ...(avatar
              ? {
                  actorAvatarSnapshot:
                    avatar,
                }
              : {}),

            title:
              content.title,

            subtitle:
              content.subtitle,

            sourceType:
              "match_event",

            ...(asString(sourceId)
              ? {
                  sourceId:
                    asString(sourceId),
                }
              : {}),

            metadata: {
              ...metadata,

              ...(matchPlace(match)
                ? {
                    placeName:
                      matchPlace(match),
                  }
                : {}),

              ...(match.dateHeure
                ? {
                    matchDate:
                      match.dateHeure,
                  }
                : {}),
            },
          });

        activityIds.push(
          activity.id
        );
      } catch (error) {
        logger?.warn?.(
          "recordMatchUserActivities ignored failure",
          {
            type,
            matchId:
              normalizedMatchId,
            userId,
            error:
              String(
                error?.message
                ?? error
              ),
          }
        );
      }
    }

    return {
      recipientCount:
        recipients.length,

      activityIds,
    };
  };
}
