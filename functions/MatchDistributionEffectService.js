// ======================================================
// Padima — Match Distribution V2
//
// Outbox processor for group distribution expansion.
//
// Guarantees:
// - deterministic event id
// - activity + group stats committed atomically
// - core effects are retry-safe / idempotent
// - notification delivery is retried independently
//
// Firestore + FCM cannot provide a true cross-system
// exactly-once guarantee. notificationSentAt prevents
// ordinary retries from resending once acknowledged.
// ======================================================

import {
  buildGroupActivity,
  GroupActivityType,
  GroupActivityVisibility,
} from "./domain/groups/index.js";


export const MATCH_DISTRIBUTION_EVENT_TYPE =
  "group_distribution_added";


export const MATCH_PUBLIC_DISTRIBUTION_EVENT_TYPE =
  "public_distribution_added";


export function matchDistributionEventId(
  matchId,
  groupId
) {
  return `match_distribution__${matchId}__${groupId}`;
}


export function matchPublicDistributionEventId(
  matchId
) {
  return `match_distribution__${matchId}__public`;
}


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function timestampMs(value) {
  if (
    value
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

  return null;
}


export function buildProcessMatchDistributionEvent({
  db,
  FieldValue,
  logger,
  notifyGroupMatchCreated,
  notifyPublicMatchCreated,
}) {
  if (!db) {
    throw new Error("DB_REQUIRED");
  }

  return async function processMatchDistributionEvent(
    event
  ) {
    const eventId =
      asString(
        event?.params?.eventId
      );

    if (!eventId) {
      throw new Error(
        "MATCH_DISTRIBUTION_EVENT_ID_REQUIRED"
      );
    }

    const eventRef =
      db
        .collection(
          "matchDistributionEvents"
        )
        .doc(eventId);

    // --------------------------------------------------
    // Phase 1
    // Activity + group stats are committed atomically.
    // --------------------------------------------------

    const coreResult =
      await db.runTransaction(
        async (tx) => {
          const eventSnapshot =
            await tx.get(
              eventRef
            );

          if (!eventSnapshot.exists) {
            return {
              exists: false,
              processedNow: false,
            };
          }

          const effect =
            eventSnapshot.data()
            || {};

          const effectType =
            asString(
              effect.type
            );

          const supportedType =
            effectType
              === MATCH_DISTRIBUTION_EVENT_TYPE
            || effectType
              === MATCH_PUBLIC_DISTRIBUTION_EVENT_TYPE;

          if (!supportedType) {
            return {
              exists: true,
              ignored: true,
              processedNow: false,
            };
          }

          if (effect.coreProcessedAt) {
            return {
              exists: true,
              processedNow: false,
              effect,
            };
          }

          const groupId =
            asString(
              effect.groupId
            );

          const matchId =
            asString(
              effect.matchId
            );

          const actorUid =
            asString(
              effect.actorUid
            );

          if (
            !matchId
            || !actorUid
          ) {
            throw new Error(
              "INVALID_MATCH_DISTRIBUTION_EVENT"
            );
          }

          if (
            effectType
            === MATCH_PUBLIC_DISTRIBUTION_EVENT_TYPE
          ) {
            tx.set(
              eventRef,
              {
                status:
                  "core_processed",

                coreProcessedAt:
                  FieldValue
                    .serverTimestamp(),
              },
              {
                merge: true,
              }
            );

            return {
              exists: true,
              processedNow: true,
              effect,
            };
          }

          if (!groupId) {
            throw new Error(
              "INVALID_MATCH_DISTRIBUTION_EVENT"
            );
          }

          const groupRef =
            db
              .collection("groups")
              .doc(groupId);

          const groupSnapshot =
            await tx.get(
              groupRef
            );

          if (!groupSnapshot.exists) {
            throw new Error(
              "MATCH_DISTRIBUTION_GROUP_NOT_FOUND"
            );
          }

          const activityRef =
            db
              .collection(
                "groupActivities"
              )
              .doc(eventId);

          const activity =
            buildGroupActivity({
              groupId,

              type:
                GroupActivityType
                  .MATCH_CREATED,

              visibility:
                GroupActivityVisibility
                  .MEMBERS,

              actorUid,

              createdAt:
                effect.createdAt
                || FieldValue
                  .serverTimestamp(),

              matchId,

              actorPseudoSnapshot:
                asString(
                  effect
                    .creatorProfile
                    ?.pseudo
                )
                || undefined,

              actorAvatarSnapshot:
                asString(
                  effect
                    .creatorProfile
                    ?.avatar
                )
                || undefined,

              matchPlaceNameSnapshot:
                asString(
                  effect
                    .matchSnapshot
                    ?.lieu
                )
                || undefined,

              matchDateSnapshot:
                effect
                  .matchSnapshot
                  ?.dateHeure
                || undefined,

              metadata: {
                source:
                  "match_distribution",
              },

              deduplicationKey:
                eventId,
            });

          // Deterministic activity ID.
          // The activity and the stats live in the
          // same Firestore transaction.
          tx.create(
            activityRef,
            {
              activityId:
                eventId,
              ...activity,
            }
          );

          tx.update(
            groupRef,
            {
              "stats.upcomingMatchCount":
                FieldValue.increment(1),

              "stats.matchesCreated30d":
                FieldValue.increment(1),

              "stats.lastActivityAt":
                FieldValue
                  .serverTimestamp(),

              updatedAt:
                FieldValue
                  .serverTimestamp(),
            }
          );

          tx.set(
            eventRef,
            {
              status:
                "core_processed",

              coreProcessedAt:
                FieldValue
                  .serverTimestamp(),
            },
            {
              merge: true,
            }
          );

          return {
            exists: true,
            processedNow: true,
            effect,
          };
        }
      );

    if (
      coreResult.exists === false
      || coreResult.ignored === true
    ) {
      return coreResult;
    }

    // --------------------------------------------------
    // Phase 2
    // Notification.
    //
    // A claim prevents two normal concurrent workers
    // from sending the same notification.
    //
    // A stale claim can be recovered after five minutes.
    // --------------------------------------------------

    const notificationClaim =
      await db.runTransaction(
        async (tx) => {
          const snapshot =
            await tx.get(
              eventRef
            );

          if (!snapshot.exists) {
            return {
              send: false,
            };
          }

          const effect =
            snapshot.data()
            || {};

          if (
            effect.notificationSentAt
          ) {
            return {
              send: false,
              alreadySent: true,
            };
          }

          if (
            effect.notificationState
            === "sending"
          ) {
            const claimedMs =
              timestampMs(
                effect
                  .notificationClaimedAt
              );

            const claimStillFresh =
              claimedMs !== null
              && (
                Date.now()
                - claimedMs
              ) < 5 * 60 * 1000;

            if (claimStillFresh) {
              return {
                send: false,
                inProgress: true,
              };
            }
          }

          tx.set(
            eventRef,
            {
              notificationState:
                "sending",

              notificationClaimedAt:
                FieldValue
                  .serverTimestamp(),

              notificationAttempts:
                FieldValue
                  .increment(1),
            },
            {
              merge: true,
            }
          );

          return {
            send: true,
            effect,
          };
        }
      );

    if (
      notificationClaim
        .alreadySent
    ) {
      return {
        ...coreResult,
        notification:
          "already_sent",
      };
    }

    if (
      notificationClaim
        .inProgress
    ) {
      // Throw so retry:true schedules another attempt.
      throw new Error(
        "MATCH_DISTRIBUTION_NOTIFICATION_IN_PROGRESS"
      );
    }

    if (
      !notificationClaim.send
    ) {
      return coreResult;
    }

    const latestSnapshot =
      await eventRef.get();

    if (!latestSnapshot.exists) {
      throw new Error(
        "MATCH_DISTRIBUTION_EVENT_DISAPPEARED"
      );
    }

    const effect =
      latestSnapshot.data()
      || {};

    const effectType =
      asString(
        effect.type
      );

    const groupId =
      asString(
        effect.groupId
      );

    const matchId =
      asString(
        effect.matchId
      );

    const actorUid =
      asString(
        effect.actorUid
      );

    try {
      if (
        effectType
          === MATCH_DISTRIBUTION_EVENT_TYPE
        && typeof notifyGroupMatchCreated
          === "function"
      ) {
        const groupSnapshot =
          await db
            .collection("groups")
            .doc(groupId)
            .get();

        const group =
          groupSnapshot.exists
            ? (
                groupSnapshot.data()
                || {}
              )
            : {};

        await notifyGroupMatchCreated({
          groupId,

          group,

          matchId,

          creatorUid:
            actorUid,

          creatorProfile:
            effect.creatorProfile
            || {},

          match:
            effect.matchSnapshot
            || {},
        });
      }

      if (
        effectType
          === MATCH_PUBLIC_DISTRIBUTION_EVENT_TYPE
        && typeof notifyPublicMatchCreated
          === "function"
      ) {
        await notifyPublicMatchCreated({
          matchId,

          creatorUid:
            actorUid,

          match:
            effect.matchSnapshot
            || {},
        });
      }

      await eventRef.set(
        {
          status:
            "processed",

          notificationState:
            "sent",

          notificationSentAt:
            FieldValue
              .serverTimestamp(),

          notificationLastError:
            null,
        },
        {
          merge: true,
        }
      );

      logger?.info?.(
        "match distribution event processed",
        {
          eventId,
          type:
            effectType,
          groupId:
            groupId || null,
          matchId,
        }
      );

      return {
        ...coreResult,
        notification:
          "sent",
      };
    } catch (error) {
      await eventRef.set(
        {
          notificationState:
            "pending",

          notificationLastFailedAt:
            FieldValue
              .serverTimestamp(),

          notificationLastError:
            String(
              error?.message
              ?? error
            ),
        },
        {
          merge: true,
        }
      );

      logger?.error?.(
        "match distribution notification failed",
        {
          eventId,
          groupId,
          matchId,
          error:
            String(
              error?.message
              ?? error
            ),
        }
      );

      throw error;
    }
  };
}
