// Path: functions/domain/activity/MatchPushNotificationService.js

function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isRealUserId(value) {
  const uid = asString(value);

  return !!uid
    && !uid.includes(":")
    && !uid.startsWith("ami_de_");
}

function participantUid(value) {
  if (typeof value === "string") {
    return asString(value);
  }

  if (value && typeof value === "object") {
    return asString(
      value.userId
      || value.uid
      || value.playerUid
    );
  }

  return "";
}

export function extractClassicMatchRecipientUids(
  match = {},
  {
    excludedUserIds = [],
  } = {}
) {
  const excluded = new Set(
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
        .filter((uid) => !excluded.has(uid))
    ),
  ];
}

function contentFor(type, match = {}) {
  const place =
    asString(
      match.placeName
      || match.lieu
    );

  switch (type) {
    case "match_updated":
      return {
        title:
          "Ton match a été modifié",
        body:
          place
            ? `Consulte les nouvelles informations pour ${place}.`
            : "Consulte les nouvelles informations du match.",
      };

    case "match_cancelled":
      return {
        title:
          "Ton match a été annulé",
        body:
          place
            ? `Le match à ${place} a été annulé.`
            : "Le match a été annulé.",
      };

    default:
      throw new TypeError(
        `UNSUPPORTED_MATCH_PUSH_TYPE:${type}`
      );
  }
}

export function buildNotifyClassicMatchEvent({
  tokensOf,
  sendVisibleHybrid,
  logger,
}) {
  if (typeof tokensOf !== "function") {
    throw new TypeError("TOKENS_OF_REQUIRED");
  }

  if (typeof sendVisibleHybrid !== "function") {
    throw new TypeError(
      "SEND_VISIBLE_HYBRID_REQUIRED"
    );
  }

  return async function notifyClassicMatchEvent({
    type,
    matchId,
    match = {},
    actorUid,
  }) {
    // Les matchs de groupe conservent exclusivement
    // GroupMatchNotificationService pour éviter les doublons.
    if (asString(match.groupId)) {
      return {
        eligibleUserCount: 0,
        sentUserCount: 0,
        skippedGroupMatch: true,
      };
    }

    const recipients =
      extractClassicMatchRecipientUids(
        match,
        {
          excludedUserIds: [
            actorUid,
          ],
        }
      );

    let sentUserCount = 0;

    const content =
      contentFor(type, match);

    for (const recipientUid of recipients) {
      try {
        const tokens =
          await tokensOf(recipientUid);

        if (
          !Array.isArray(tokens)
          || !tokens.length
        ) {
          continue;
        }

        await sendVisibleHybrid(
          tokens,
          {
            title:
              content.title,

            body:
              content.body,

            data: {
              type,
              matchId:
                asString(matchId),
              entityType:
                "match",
              entityId:
                asString(matchId),
            },
          }
        );

        sentUserCount += 1;
      } catch (error) {
        logger?.warn?.(
          "classic match notification ignored recipient failure",
          {
            type,
            matchId,
            recipientUid,
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
      eligibleUserCount:
        recipients.length,

      sentUserCount,
      skippedGroupMatch: false,
    };
  };
}
