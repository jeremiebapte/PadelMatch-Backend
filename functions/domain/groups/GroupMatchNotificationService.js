// Path: functions/domain/groups/GroupMatchNotificationService.js
// ======================================================
// Padima — notifications des matchs de groupe
//
// Architecture :
// - une factory construit le contenu métier de chaque événement ;
// - un moteur sélectionne la bonne audience ;
// - un sender mutualise l'envoi FCM et les logs ;
// - les exports historiques restent disponibles pour les appelants.
//
// Règles produit :
// - création : opportunité → membres éligibles du groupe ;
// - modification : engagement → participants concernés ;
// - annulation : engagement → participants concernés ;
// - une erreur push ne bloque jamais l'opération métier.
// ======================================================

import {
  GroupNotificationPreference,
} from "./GroupNotificationRecipientService.js";

import {
  buildGroupMatchNotificationContentFactory,
  GroupMatchNotificationContentEvent,
} from "./GroupMatchNotificationContentFactory.js";


export const GroupMatchNotificationEvent =
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


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function normalizeChangedKeys(
  changedKeys
) {
  return Array.isArray(changedKeys)
    ? [
        ...new Set(
          changedKeys
            .map(asString)
            .filter(Boolean)
        ),
      ]
    : [];
}


function buildMatchDetails({
  match = {},
  frDate,
  frTime,
}) {
  const placeName =
    asString(
      match?.lieu
      || match?.placeName
    )
    || "un club";

  const dateHeure =
    Number(match?.dateHeure);

  const dateLabel =
    Number.isFinite(dateHeure)
      ? frDate(dateHeure)
      : "";

  const timeLabel =
    Number.isFinite(dateHeure)
      ? frTime(dateHeure)
      : "";

  return [
    placeName,
    dateLabel,
    timeLabel
      ? `à ${timeLabel}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}


function validateNotificationDependencies({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  frDate,
  frTime,
}) {
  if (
    typeof getEligibleGroupRecipients
    !== "function"
  ) {
    throw new TypeError(
      "GET_ELIGIBLE_GROUP_RECIPIENTS_REQUIRED"
    );
  }

  if (
    typeof getEligibleMatchRecipients
    !== "function"
  ) {
    throw new TypeError(
      "GET_ELIGIBLE_MATCH_RECIPIENTS_REQUIRED"
    );
  }

  if (typeof tokensOf !== "function") {
    throw new TypeError(
      "TOKENS_OF_REQUIRED"
    );
  }

  if (
    typeof sendVisibleHybrid
    !== "function"
  ) {
    throw new TypeError(
      "SEND_VISIBLE_HYBRID_REQUIRED"
    );
  }

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
}


function buildSendGroupMatchNotification({
  tokensOf,
  sendVisibleHybrid,
  logger,
}) {
  return async function sendGroupMatchNotification({
    groupId,
    recipients,
    title,
    body,
    data,
    logContext,
  }) {
    const memberships =
      Array.isArray(recipients)
        ? recipients
        : [];

    if (!memberships.length) {
      logger?.info?.(
        `${logContext} notification: no recipients`,
        {
          groupId,
          ...data,
        }
      );

      return {
        eligibleUserCount: 0,
        sentUserCount: 0,
      };
    }

    let sentUserCount = 0;

    for (const membership of memberships) {
      const recipientUid =
        asString(
          membership?.userId
        );

      if (!recipientUid) {
        logger?.warn?.(
          `${logContext} notification missing recipient uid`,
          {
            groupId,
            membershipId:
              asString(
                membership
                  ?.membershipId
              ),
          }
        );

        continue;
      }

      try {
        const tokens =
          await tokensOf(
            recipientUid
          );

        if (!Array.isArray(tokens)) {
          logger?.warn?.(
            `${logContext} notification invalid tokens result`,
            {
              groupId,
              recipientUid,
            }
          );

          continue;
        }

        if (!tokens.length) {
          continue;
        }

        await sendVisibleHybrid(
          tokens,
          {
            title,
            body,
            data,
          }
        );

        sentUserCount += 1;
      } catch (error) {
        logger?.warn?.(
          `${logContext} notification failed for member`,
          {
            groupId,
            recipientUid,
            ...data,
            error:
              String(
                error?.message
                ?? error
              ),
          }
        );
      }
    }

    logger?.info?.(
      `${logContext} notification completed`,
      {
        groupId,
        ...data,
        eligibleUserCount:
          memberships.length,
        sentUserCount,
      }
    );

    return {
      eligibleUserCount:
        memberships.length,

      sentUserCount,
    };
  };
}


export function buildNotifyGroupMatchEvent({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  validateNotificationDependencies({
    getEligibleGroupRecipients,
    getEligibleMatchRecipients,
    tokensOf,
    sendVisibleHybrid,
    frDate,
    frTime,
  });

  const createNotificationContent =
    buildGroupMatchNotificationContentFactory({
      frDate,
      frTime,
    });

  const sendNotification =
    buildSendGroupMatchNotification({
      tokensOf,
      sendVisibleHybrid,
      logger,
    });

  return async function notifyGroupMatchEvent({
    event,
    groupId,
    group = {},
    matchId,
    actorUid,
    actorProfile = {},
    previousMatch = {},
    match = {},
    changedKeys = [],
  }) {
    const normalizedGroupId =
      asString(groupId);

    const normalizedMatchId =
      asString(matchId);

    const normalizedActorUid =
      asString(actorUid);

    if (
      !normalizedGroupId
      || !normalizedMatchId
      || !normalizedActorUid
    ) {
      return {
        eligibleUserCount: 0,
        sentUserCount: 0,
        skipped: true,
      };
    }

    const contentEventMap =
      Object.freeze({
        [GroupMatchNotificationEvent
          .CREATED]:
          GroupMatchNotificationContentEvent
            .CREATED,

        [GroupMatchNotificationEvent
          .UPDATED]:
          GroupMatchNotificationContentEvent
            .UPDATED,

        [GroupMatchNotificationEvent
          .CANCELLED]:
          GroupMatchNotificationContentEvent
            .CANCELLED,

        [GroupMatchNotificationEvent
          .PLAYER_JOINED]:
          GroupMatchNotificationContentEvent
            .PLAYER_JOINED,

        [GroupMatchNotificationEvent
          .PLAYER_LEFT]:
          GroupMatchNotificationContentEvent
            .PLAYER_LEFT,

        [GroupMatchNotificationEvent
          .MATCH_FULL]:
          GroupMatchNotificationContentEvent
            .MATCH_FULL,

        [GroupMatchNotificationEvent
          .SPOT_AVAILABLE]:
          GroupMatchNotificationContentEvent
            .SPOT_AVAILABLE,
      });

    const contentEvent =
      contentEventMap[event]
      ?? null;

    if (!contentEvent) {
      throw new TypeError(
        "UNSUPPORTED_GROUP_MATCH_NOTIFICATION_EVENT"
      );
    }

    const content =
      createNotificationContent({
        event:
          contentEvent,

        group,
        previousMatch,
        match,
        actorProfile,
        changedKeys,
      });

    const audience =
      event
        === GroupMatchNotificationEvent
          .CREATED
        ? "group"
        : "match";

    const excludedUserIds = [
      normalizedActorUid,
    ];

    const recipients =
      audience === "group"
        ? await getEligibleGroupRecipients({
            groupId:
              normalizedGroupId,

            preference:
              GroupNotificationPreference
                .MATCH,

            excludedUserIds,
          })
        : await getEligibleMatchRecipients({
            groupId:
              normalizedGroupId,

            match,

            excludedUserIds,
          });

    const result =
      await sendNotification({
        groupId:
          normalizedGroupId,

        recipients,

        title:
          content.title,

        body:
          content.body,

        data: {
          type:
            "group",

          subtype:
            content.subtype,

          groupId:
            normalizedGroupId,

          matchId:
            normalizedMatchId,

          actorUid:
            normalizedActorUid,

          changedKeys:
            normalizeChangedKeys(
              changedKeys
            ).join(","),

          changeType:
            asString(
              content.changeType
            ),
        },

        logContext:
          `group match ${asString(content.changeType) || "event"}`,
      });

    return {
      ...result,
      skipped: false,
    };
  };
}


function buildLegacyEventNotifier({
  event,
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  const notifyEvent =
    buildNotifyGroupMatchEvent({
      getEligibleGroupRecipients,
      getEligibleMatchRecipients,
      tokensOf,
      sendVisibleHybrid,
      logger,
      frDate,
      frTime,
    });

  return notifyEvent;
}


export function buildNotifyGroupMatchCreated({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  const notifyEvent =
    buildLegacyEventNotifier({
      event:
        GroupMatchNotificationEvent
          .CREATED,

      getEligibleGroupRecipients,
      getEligibleMatchRecipients,
      tokensOf,
      sendVisibleHybrid,
      logger,
      frDate,
      frTime,
    });

  return async function notifyGroupMatchCreated({
    groupId,
    group,
    matchId,
    creatorUid,
    creatorProfile = {},
    match = {},
  }) {
    return notifyEvent({
      event:
        GroupMatchNotificationEvent
          .CREATED,

      groupId,
      group,
      matchId,

      actorUid:
        creatorUid,

      actorProfile:
        creatorProfile,

      match,
    });
  };
}


export function buildNotifyGroupMatchUpdated({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  const notifyEvent =
    buildLegacyEventNotifier({
      event:
        GroupMatchNotificationEvent
          .UPDATED,

      getEligibleGroupRecipients,
      getEligibleMatchRecipients,
      tokensOf,
      sendVisibleHybrid,
      logger,
      frDate,
      frTime,
    });

  return async function notifyGroupMatchUpdated({
    groupId,
    matchId,
    actorUid,
    actorProfile = {},
    previousMatch = {},
    match = {},
    changedKeys = [],
  }) {
    return notifyEvent({
      event:
        GroupMatchNotificationEvent
          .UPDATED,

      groupId,
      matchId,
      actorUid,
      actorProfile,
      previousMatch,
      match,
      changedKeys,
    });
  };
}



function buildNotifyGroupMatchParticipationEvent({
  event,
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  const notifyEvent =
    buildLegacyEventNotifier({
      event,
      getEligibleGroupRecipients,
      getEligibleMatchRecipients,
      tokensOf,
      sendVisibleHybrid,
      logger,
      frDate,
      frTime,
    });

  return async function notifyGroupMatchParticipationEvent({
    groupId,
    matchId,
    actorUid,
    actorProfile = {},
    previousMatch = {},
    match = {},
  }) {
    return notifyEvent({
      event,
      groupId,
      matchId,
      actorUid,
      actorProfile,
      previousMatch,
      match,
    });
  };
}


export function buildNotifyGroupMatchPlayerJoined({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  return buildNotifyGroupMatchParticipationEvent({
    event:
      GroupMatchNotificationEvent
        .PLAYER_JOINED,

    getEligibleGroupRecipients,
    getEligibleMatchRecipients,
    tokensOf,
    sendVisibleHybrid,
    logger,
    frDate,
    frTime,
  });
}


export function buildNotifyGroupMatchPlayerLeft({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  return buildNotifyGroupMatchParticipationEvent({
    event:
      GroupMatchNotificationEvent
        .PLAYER_LEFT,

    getEligibleGroupRecipients,
    getEligibleMatchRecipients,
    tokensOf,
    sendVisibleHybrid,
    logger,
    frDate,
    frTime,
  });
}


export function buildNotifyGroupMatchFull({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  return buildNotifyGroupMatchParticipationEvent({
    event:
      GroupMatchNotificationEvent
        .MATCH_FULL,

    getEligibleGroupRecipients,
    getEligibleMatchRecipients,
    tokensOf,
    sendVisibleHybrid,
    logger,
    frDate,
    frTime,
  });
}


export function buildNotifyGroupMatchSpotAvailable({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  return buildNotifyGroupMatchParticipationEvent({
    event:
      GroupMatchNotificationEvent
        .SPOT_AVAILABLE,

    getEligibleGroupRecipients,
    getEligibleMatchRecipients,
    tokensOf,
    sendVisibleHybrid,
    logger,
    frDate,
    frTime,
  });
}


export function buildNotifyGroupMatchCancelled({
  getEligibleGroupRecipients,
  getEligibleMatchRecipients,
  tokensOf,
  sendVisibleHybrid,
  logger,
  frDate,
  frTime,
}) {
  const notifyEvent =
    buildLegacyEventNotifier({
      event:
        GroupMatchNotificationEvent
          .CANCELLED,

      getEligibleGroupRecipients,
      getEligibleMatchRecipients,
      tokensOf,
      sendVisibleHybrid,
      logger,
      frDate,
      frTime,
    });

  return async function notifyGroupMatchCancelled({
    groupId,
    matchId,
    actorUid,
    actorProfile = {},
    match = {},
  }) {
    return notifyEvent({
      event:
        GroupMatchNotificationEvent
          .CANCELLED,

      groupId,
      matchId,
      actorUid,
      actorProfile,
      match,
    });
  };
}
