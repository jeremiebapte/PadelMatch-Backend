const COLLECTION_AVAILABILITY =
  "weeklyAvailabilities";

const COLLECTION_SHARES =
  "weeklyAvailabilityShares";

const COLLECTION_MEMBERSHIPS =
  "groupMemberships";

const COLLECTION_GROUPS =
  "groups";

const COLLECTION_USERS =
  "users";

const COLLECTION_MATCH_NOTIFICATIONS =
  "weeklyAvailabilityNotifications";

const MAX_GROUPS = 10;
const MAX_SLOTS = 28;
const MAX_HOME_GROUPS = 20;
const MAX_HOME_RESULTS = 10;

const ACTIVE = "active";

const MIN_PUSH_AVAILABLE_PLAYERS = 3;


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function assertAuthenticated(
  req,
  HttpsError
) {
  const uid =
    asString(req?.auth?.uid);

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "AUTH_REQUIRED"
    );
  }

  return uid;
}


export function weekKeyForDate(
  value,
  timeZone = "Europe/Paris"
) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new TypeError(
      "INVALID_DATE"
    );
  }

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      }
    );

  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter(
          (part) =>
            part.type
              !== "literal"
        )
        .map(
          (part) => [
            part.type,
            part.value,
          ]
        )
    );

  const localDate =
    new Date(
      `${parts.year}-${parts.month}-${parts.day}T12:00:00.000Z`
    );

  const weekdayIndex = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  }[parts.weekday];

  if (
    weekdayIndex === undefined
  ) {
    throw new TypeError(
      "INVALID_WEEKDAY"
    );
  }

  localDate.setUTCDate(
    localDate.getUTCDate()
      - weekdayIndex
  );

  const year =
    localDate.getUTCFullYear();

  const month =
    String(
      localDate.getUTCMonth()
        + 1
    ).padStart(2, "0");

  const day =
    String(
      localDate.getUTCDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


export function availabilityDocumentId(
  uid,
  weekKey
) {
  return `${uid}_${weekKey}`;
}


export function availabilityShareDocumentId(
  weekKey,
  groupId,
  uid
) {
  return `${weekKey}_${groupId}_${uid}`;
}


export function normalizeWeekKey(
  value,
  HttpsError
) {
  const weekKey =
    asString(value);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      weekKey
    )
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_WEEK_KEY"
    );
  }

  const date =
    new Date(
      `${weekKey}T12:00:00.000Z`
    );

  if (
    Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== weekKey
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_WEEK_KEY"
    );
  }

  /*
   * weekKey représente toujours
   * le lundi de la semaine.
   *
   * getUTCDay():
   * 0 dimanche
   * 1 lundi
   */
  if (date.getUTCDay() !== 1) {
    throw new HttpsError(
      "invalid-argument",
      "WEEK_KEY_MUST_BE_MONDAY"
    );
  }

  return weekKey;
}


function normalizeTimeZone(
  value,
  HttpsError
) {
  const timeZone =
    asString(value)
    || "Europe/Paris";

  if (
    timeZone !== "Europe/Paris"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_TIMEZONE"
    );
  }

  return timeZone;
}


export function normalizeSlots(
  rawSlots,
  HttpsError
) {
  if (!Array.isArray(rawSlots)) {
    throw new HttpsError(
      "invalid-argument",
      "SLOTS_REQUIRED"
    );
  }

  if (
    rawSlots.length === 0
    || rawSlots.length > MAX_SLOTS
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_SLOTS_COUNT"
    );
  }

  const parsed =
    rawSlots.map((raw) => {
      const weekday =
        Number(raw?.weekday);

      const startMinutes =
        Number(raw?.startMinutes);

      const endMinutes =
        Number(raw?.endMinutes);

      if (
        !Number.isInteger(weekday)
        || weekday < 1
        || weekday > 7
      ) {
        throw new HttpsError(
          "invalid-argument",
          "INVALID_SLOT_WEEKDAY"
        );
      }

      if (
        !Number.isInteger(
          startMinutes
        )
        || !Number.isInteger(
          endMinutes
        )
        || startMinutes < 0
        || endMinutes > 1440
        || endMinutes <= startMinutes
      ) {
        throw new HttpsError(
          "invalid-argument",
          "INVALID_SLOT_TIME"
        );
      }

      if (
        endMinutes
          - startMinutes
        < 30
      ) {
        throw new HttpsError(
          "invalid-argument",
          "SLOT_TOO_SHORT"
        );
      }

      return {
        weekday,
        startMinutes,
        endMinutes,
      };
    });

  parsed.sort(
    (left, right) =>
      left.weekday - right.weekday
      || left.startMinutes
        - right.startMinutes
      || left.endMinutes
        - right.endMinutes
  );

  /*
   * Fusionne les créneaux
   * qui se chevauchent / se touchent
   * le même jour.
   */
  const merged = [];

  for (const slot of parsed) {
    const previous =
      merged[
        merged.length - 1
      ];

    if (
      previous
      && previous.weekday
        === slot.weekday
      && slot.startMinutes
        <= previous.endMinutes
    ) {
      previous.endMinutes =
        Math.max(
          previous.endMinutes,
          slot.endMinutes
        );

      continue;
    }

    merged.push({
      ...slot,
    });
  }

  return merged;
}


function normalizeGroupIds(
  rawGroupIds,
  HttpsError
) {
  if (!Array.isArray(rawGroupIds)) {
    throw new HttpsError(
      "invalid-argument",
      "SHARED_GROUP_IDS_REQUIRED"
    );
  }

  const unique =
    [
      ...new Set(
        rawGroupIds
          .map(asString)
          .filter(Boolean)
      ),
    ];

  if (
    unique.length === 0
    || unique.length > MAX_GROUPS
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_SHARED_GROUP_IDS"
    );
  }

  return unique;
}


function snapshotOfUser(
  uid,
  user
) {
  return {
    uid,

    pseudo:
      asString(
        user?.pseudo
        || user?.username
        || user?.displayName
      )
      || "Joueur Padima",

    avatar:
      asString(
        user?.avatar
        || user?.photoUrl
      ),
  };
}


function emptyAvailability(
  uid,
  weekKey
) {
  return {
    uid,
    weekKey,
    timeZone:
      "Europe/Paris",
    slots: [],
    sharedGroupIds: [],
  };
}


function publicAvailability(
  data,
  uid,
  weekKey
) {
  return {
    uid,
    weekKey,

    timeZone:
      asString(data?.timeZone)
      || "Europe/Paris",

    slots:
      Array.isArray(data?.slots)
        ? data.slots
        : [],

    sharedGroupIds:
      Array.isArray(
        data?.sharedGroupIds
      )
        ? data.sharedGroupIds
            .map(asString)
            .filter(Boolean)
        : [],
  };
}


async function assertActiveMemberships({
  db,
  uid,
  groupIds,
  HttpsError,
}) {
  const refs =
    groupIds.map(
      (groupId) =>
        db
          .collection(
            COLLECTION_MEMBERSHIPS
          )
          .doc(
            `${groupId}_${uid}`
          )
    );

  const snapshots =
    await Promise.all(
      refs.map(
        (ref) => ref.get()
      )
    );

  for (
    let index = 0;
    index < snapshots.length;
    index += 1
  ) {
    const snapshot =
      snapshots[index];

    const groupId =
      groupIds[index];

    const data =
      snapshot.exists
        ? snapshot.data() || {}
        : {};

    if (
      !snapshot.exists
      || asString(data.userId)
        !== uid
      || asString(data.groupId)
        !== groupId
      || asString(data.status)
        !== ACTIVE
    ) {
      throw new HttpsError(
        "permission-denied",
        "ACTIVE_GROUP_MEMBERSHIP_REQUIRED",
        {
          groupId,
        }
      );
    }
  }
}


async function activeMemberUidsForGroup({
  db,
  groupId,
}) {
  const snapshot =
    await db
      .collection(
        COLLECTION_MEMBERSHIPS
      )
      .where(
        "groupId",
        "==",
        groupId
      )
      .get();

  return new Set(
    snapshot.docs
      .map(
        (doc) =>
          doc.data() || {}
      )
      .filter(
        (membership) =>
          asString(
            membership.groupId
          ) === groupId
          && asString(
            membership.status
          ) === ACTIVE
      )
      .map(
        (membership) =>
          asString(
            membership.userId
          )
      )
      .filter(Boolean)
  );
}


function filterSharesToActiveMembers(
  shares,
  activeMemberUids
) {
  return shares.filter(
    (share) =>
      activeMemberUids.has(
        asString(
          share?.uid
        )
      )
  );
}


function normalizeShare(
  data
) {
  return {
    uid:
      asString(data?.uid),

    groupId:
      asString(data?.groupId),

    weekKey:
      asString(data?.weekKey),

    pseudo:
      asString(
        data?.pseudoSnapshot
      )
      || "Joueur Padima",

    avatar:
      asString(
        data?.avatarSnapshot
      ),

    slots:
      Array.isArray(data?.slots)
        ? data.slots
        : [],
  };
}


export function computeGroupOpportunities({
  groupId,
  groupName,
  shares,
  currentUid,
}) {
  const normalized =
    shares
      .map(normalizeShare)
      .filter(
        (share) =>
          share.uid
          && share.groupId
            === groupId
          && share.slots.length > 0
      );

  const byUid =
    new Map();

  for (const share of normalized) {
    byUid.set(
      share.uid,
      share
    );
  }

  const uniqueShares =
    [...byUid.values()];

  const opportunities = [];

  for (
    let weekday = 1;
    weekday <= 7;
    weekday += 1
  ) {
    const boundaries =
      new Set();

    for (
      const share
      of uniqueShares
    ) {
      for (
        const slot
        of share.slots
      ) {
        if (
          Number(slot.weekday)
          !== weekday
        ) {
          continue;
        }

        boundaries.add(
          Number(
            slot.startMinutes
          )
        );

        boundaries.add(
          Number(
            slot.endMinutes
          )
        );
      }
    }

    const points =
      [...boundaries]
        .filter(
          Number.isFinite
        )
        .sort(
          (left, right) =>
            left - right
        );

    for (
      let index = 0;
      index < points.length - 1;
      index += 1
    ) {
      const startMinutes =
        points[index];

      const endMinutes =
        points[index + 1];

      if (
        endMinutes
        <= startMinutes
      ) {
        continue;
      }

      const activePlayers =
        uniqueShares
          .filter(
            (share) =>
              share.slots.some(
                (slot) =>
                  Number(
                    slot.weekday
                  ) === weekday
                  && Number(
                    slot.startMinutes
                  ) <= startMinutes
                  && Number(
                    slot.endMinutes
                  ) >= endMinutes
              )
          )
          .map(
            (share) => ({
              uid:
                share.uid,
              pseudo:
                share.pseudo,
              avatar:
                share.avatar,
            })
          );

      if (
        activePlayers.length < 2
      ) {
        continue;
      }

      opportunities.push({
        groupId,
        groupName,

        weekday,
        startMinutes,
        endMinutes,

        matchingMyAvailability:
          activePlayers.some(
            (player) =>
              player.uid
              === currentUid
          ),

        availablePlayers:
          activePlayers,

        totalAvailable:
          activePlayers.length,
      });
    }
  }

  /*
   * Recompose les segments adjacents
   * ayant exactement les mêmes joueurs.
   */
  const merged = [];

  for (const opportunity of opportunities) {
    const previous =
      merged[
        merged.length - 1
      ];

    const ids =
      opportunity
        .availablePlayers
        .map(
          (player) =>
            player.uid
        )
        .sort()
        .join("|");

    const previousIds =
      previous
        ? previous
            .availablePlayers
            .map(
              (player) =>
                player.uid
            )
            .sort()
            .join("|")
        : "";

    if (
      previous
      && previous.weekday
        === opportunity.weekday
      && previous.endMinutes
        === opportunity.startMinutes
      && previousIds === ids
    ) {
      previous.endMinutes =
        opportunity.endMinutes;

      continue;
    }

    merged.push({
      ...opportunity,
    });
  }

  return merged;
}



function opportunityPlayerKey(
  opportunity
) {
  return opportunity
    .availablePlayers
    .map(
      (player) =>
        asString(player.uid)
    )
    .filter(Boolean)
    .sort()
    .join(".");
}


export function availabilityMatchNotificationId({
  weekKey,
  groupId,
  recipientUid,
  opportunity,
}) {
  const playerKey =
    opportunityPlayerKey(
      opportunity
    );

  return [
    weekKey,
    groupId,
    opportunity.weekday,
    opportunity.startMinutes,
    opportunity.endMinutes,
    playerKey,
    recipientUid,
  ]
    .map(
      (value) =>
        String(value)
          .replace(
            /[^a-zA-Z0-9_.-]/g,
            "_"
          )
    )
    .join("__");
}


function availabilityMatchCopy({
  groupName,
  opportunity,
}) {
  const count =
    Number(
      opportunity
        ?.totalAvailable
      || 0
    );

  if (count >= 4) {
    return {
      title:
        `Vous êtes ${count} dispo 🎾`,

      body:
        `${groupName} : un match est possible sur ce créneau.`,
    };
  }

  const otherPlayers =
    opportunity
      .availablePlayers
      .slice(0, 2)
      .map(
        (player) =>
          asString(
            player.pseudo
          )
      )
      .filter(Boolean);

  return {
    title:
      "Ça matche 👀",

    body:
      otherPlayers.length
        ? `${otherPlayers.join(" et ")} sont aussi dispos dans ${groupName}.`
        : `${count} joueurs sont dispos dans ${groupName}.`,
  };
}


async function notifyNewAvailabilityMatches({
  db,
  FieldValue,
  weekKey,
  actorUid,
  groupIds,
  getEligibleGroupRecipients,
  tokensOf,
  sendVisibleHybrid,
  isPushAllowed,
  logger,
}) {
  if (
    typeof getEligibleGroupRecipients
      !== "function"
    || typeof tokensOf
      !== "function"
    || typeof sendVisibleHybrid
      !== "function"
  ) {
    return {
      attempted: 0,
      sent: 0,
    };
  }

  let attempted = 0;
  let sent = 0;

  for (
    const groupId
    of groupIds
  ) {
    try {
      const [
        groupSnapshot,
        sharesSnapshot,
        activeMemberUids,
      ] =
        await Promise.all([
          db
            .collection(
              COLLECTION_GROUPS
            )
            .doc(groupId)
            .get(),

          db
            .collection(
              COLLECTION_SHARES
            )
            .where(
              "groupId",
              "==",
              groupId
            )
            .where(
              "weekKey",
              "==",
              weekKey
            )
            .get(),

          activeMemberUidsForGroup({
            db,
            groupId,
          }),
        ]);

      const group =
        groupSnapshot.exists
          ? groupSnapshot.data()
            || {}
          : {};

      const groupName =
        asString(
          group.name
          || group.title
        )
        || "Groupe Padima";

      const shares =
        filterSharesToActiveMembers(
          sharesSnapshot.docs
            .map(
              (doc) =>
                doc.data() || {}
            ),
          activeMemberUids
        );

      const actorIsPresent =
        shares.some(
          (share) =>
            asString(share.uid)
              === actorUid
        );

      if (!actorIsPresent) {
        continue;
      }

      const opportunities =
        computeGroupOpportunities({
          groupId,
          groupName,
          shares,
          currentUid:
            actorUid,
        })
          .filter(
            (item) =>
              item
                .matchingMyAvailability
              && item
                .totalAvailable
                >= MIN_PUSH_AVAILABLE_PLAYERS
          );

      if (!opportunities.length) {
        continue;
      }

      const eligibleMemberships =
        await getEligibleGroupRecipients({
          groupId,
          preference:
            "general",
        });

      const eligibleUids =
        new Set(
          eligibleMemberships
            .map(
              (membership) =>
                asString(
                  membership.userId
                )
            )
            .filter(Boolean)
        );

      for (
        const opportunity
        of opportunities
      ) {
        const relevantUids =
          opportunity
            .availablePlayers
            .map(
              (player) =>
                asString(
                  player.uid
                )
            )
            .filter(
              (uid) =>
                uid
                && eligibleUids.has(
                  uid
                )
            );

        for (
          const recipientUid
          of relevantUids
        ) {
          if (
            typeof isPushAllowed === "function"
            && !(await isPushAllowed({
              uid: recipientUid,
              category: "availability",
              event: "availabilityOverlap",
            }))
          ) {
            continue;
          }

          const notificationId =
            availabilityMatchNotificationId({
              weekKey,
              groupId,
              recipientUid,
              opportunity,
            });

          const notificationRef =
            db
              .collection(
                COLLECTION_MATCH_NOTIFICATIONS
              )
              .doc(
                notificationId
              );

          let claimed = false;

          await db.runTransaction(
            async (tx) => {
              const existing =
                await tx.get(
                  notificationRef
                );

              if (
                existing.exists
              ) {
                return;
              }

              tx.create
                ? tx.create(
                    notificationRef,
                    {
                      notificationId,
                      weekKey,
                      groupId,
                      recipientUid,

                      weekday:
                        opportunity
                          .weekday,

                      startMinutes:
                        opportunity
                          .startMinutes,

                      endMinutes:
                        opportunity
                          .endMinutes,

                      participantUids:
                        opportunity
                          .availablePlayers
                          .map(
                            (player) =>
                              player.uid
                          )
                          .sort(),

                      totalAvailable:
                        opportunity
                          .totalAvailable,

                      triggeredByUid:
                        actorUid,

                      status:
                        "claimed",

                      createdAt:
                        FieldValue
                          .serverTimestamp(),

                      updatedAt:
                        FieldValue
                          .serverTimestamp(),
                    }
                  )
                : tx.set(
                    notificationRef,
                    {
                      notificationId,
                      weekKey,
                      groupId,
                      recipientUid,

                      weekday:
                        opportunity
                          .weekday,

                      startMinutes:
                        opportunity
                          .startMinutes,

                      endMinutes:
                        opportunity
                          .endMinutes,

                      participantUids:
                        opportunity
                          .availablePlayers
                          .map(
                            (player) =>
                              player.uid
                          )
                          .sort(),

                      totalAvailable:
                        opportunity
                          .totalAvailable,

                      triggeredByUid:
                        actorUid,

                      status:
                        "claimed",

                      createdAt:
                        FieldValue
                          .serverTimestamp(),

                      updatedAt:
                        FieldValue
                          .serverTimestamp(),
                    }
                  );

              claimed = true;
            }
          );

          if (!claimed) {
            continue;
          }

          attempted += 1;

          try {
            const tokens =
              await tokensOf(
                recipientUid
              );

            if (
              !Array.isArray(tokens)
              || !tokens.length
            ) {
              await notificationRef
                .set(
                  {
                    status:
                      "no_tokens",

                    updatedAt:
                      FieldValue
                        .serverTimestamp(),
                  },
                  {
                    merge: true,
                  }
                );

              continue;
            }

            const copy =
              availabilityMatchCopy({
                groupName,
                opportunity,
              });

            await sendVisibleHybrid(
              tokens,
              {
                title:
                  copy.title,

                body:
                  copy.body,

                data: {
                  type:
                    "weekly_availability",

                  subtype:
                    "match",

                  entityType:
                    "weekly_availability",

                  entityId:
                    notificationId,

                  groupId,
                  groupName,
                  weekKey,

                  weekday:
                    opportunity
                      .weekday,

                  startMinutes:
                    opportunity
                      .startMinutes,

                  endMinutes:
                    opportunity
                      .endMinutes,

                  totalAvailable:
                    opportunity
                      .totalAvailable,

                  destination:
                    "home_availability",
                },
              }
            );

            await notificationRef
              .set(
                {
                  status:
                    "sent",

                  sentAt:
                    FieldValue
                      .serverTimestamp(),

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                },
                {
                  merge: true,
                }
              );

            sent += 1;
          } catch (error) {
            await notificationRef
              .set(
                {
                  status:
                    "failed",

                  failure:
                    String(
                      error?.message
                      ?? error
                    )
                      .slice(
                        0,
                        300
                      ),

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                },
                {
                  merge: true,
                }
              );

            logger?.warn?.(
              "weekly availability match notification failed",
              {
                groupId,
                weekKey,
                recipientUid,
                notificationId,

                error:
                  String(
                    error?.message
                    ?? error
                  ),
              }
            );
          }
        }
      }
    } catch (error) {
      logger?.warn?.(
        "weekly availability overlap notification ignored group failure",
        {
          groupId,
          weekKey,
          actorUid,

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
    attempted,
    sent,
  };
}


export function rankHomeOpportunities(
  opportunities
) {
  return opportunities
    .slice()
    .sort(
      (left, right) => {
        if (
          left
            .matchingMyAvailability
          !== right
            .matchingMyAvailability
        ) {
          return left
            .matchingMyAvailability
            ? -1
            : 1;
        }

        if (
          left.totalAvailable
          !== right.totalAvailable
        ) {
          return (
            right.totalAvailable
            - left.totalAvailable
          );
        }

        if (
          left.weekday
          !== right.weekday
        ) {
          return (
            left.weekday
            - right.weekday
          );
        }

        return (
          left.startMinutes
          - right.startMinutes
        );
      }
    )
    .slice(
      0,
      MAX_HOME_RESULTS
    );
}


export function buildSetWeeklyAvailability({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  getEligibleGroupRecipients,
  tokensOf,
  sendVisibleHybrid,
  isPushAllowed,
  logger,
}) {
  return onCall(
    runtime,
    async (req) => {
      const uid =
        assertAuthenticated(
          req,
          HttpsError
        );

      const weekKey =
        normalizeWeekKey(
          req.data?.weekKey,
          HttpsError
        );

      const timeZone =
        normalizeTimeZone(
          req.data?.timeZone,
          HttpsError
        );

      const slots =
        normalizeSlots(
          req.data?.slots,
          HttpsError
        );

      const sharedGroupIds =
        normalizeGroupIds(
          req.data
            ?.sharedGroupIds,
          HttpsError
        );

      await assertActiveMemberships({
        db,
        uid,
        groupIds:
          sharedGroupIds,
        HttpsError,
      });

      const userRef =
        db
          .collection(
            COLLECTION_USERS
          )
          .doc(uid);

      const userSnapshot =
        await userRef.get();

      const profile =
        snapshotOfUser(
          uid,
          userSnapshot.exists
            ? userSnapshot.data()
            : {}
        );

      const availabilityRef =
        db
          .collection(
            COLLECTION_AVAILABILITY
          )
          .doc(
            availabilityDocumentId(
              uid,
              weekKey
            )
          );

      await db.runTransaction(
        async (tx) => {
          const previousSnapshot =
            await tx.get(
              availabilityRef
            );

          const previous =
            previousSnapshot.exists
              ? previousSnapshot
                  .data() || {}
              : {};

          const previousGroupIds =
            Array.isArray(
              previous.sharedGroupIds
            )
              ? previous
                  .sharedGroupIds
                  .map(asString)
                  .filter(Boolean)
              : [];

          const allGroupIds =
            [
              ...new Set([
                ...previousGroupIds,
                ...sharedGroupIds,
              ]),
            ];

          tx.set(
            availabilityRef,
            {
              uid,
              weekKey,
              timeZone,
              slots,
              sharedGroupIds,

              createdAt:
                previousSnapshot.exists
                  ? previous.createdAt
                    ?? FieldValue
                      .serverTimestamp()
                  : FieldValue
                      .serverTimestamp(),

              updatedAt:
                FieldValue
                  .serverTimestamp(),
            },
            {
              merge: true,
            }
          );

          for (
            const groupId
            of allGroupIds
          ) {
            const shareRef =
              db
                .collection(
                  COLLECTION_SHARES
                )
                .doc(
                  availabilityShareDocumentId(
                    weekKey,
                    groupId,
                    uid
                  )
                );

            if (
              sharedGroupIds
                .includes(groupId)
            ) {
              tx.set(
                shareRef,
                {
                  uid,
                  groupId,
                  weekKey,
                  timeZone,
                  slots,

                  pseudoSnapshot:
                    profile.pseudo,

                  avatarSnapshot:
                    profile.avatar,

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                },
                {
                  merge: true,
                }
              );
            } else {
              tx.delete(
                shareRef
              );
            }
          }
        }
      );

      const matchNotifications =
        await notifyNewAvailabilityMatches({
          db,
          FieldValue,
          weekKey,
          actorUid:
            uid,
          groupIds:
            sharedGroupIds,
          getEligibleGroupRecipients,
          tokensOf,
          sendVisibleHybrid,
          isPushAllowed,
          logger,
        });

      return {
        ok: true,

        availability:
          publicAvailability(
            {
              uid,
              weekKey,
              timeZone,
              slots,
              sharedGroupIds,
            },
            uid,
            weekKey
          ),

        matchNotifications,
      };
    }
  );
}


export function buildGetMyWeeklyAvailability({
  onCall,
  HttpsError,
  runtime,
  db,
}) {
  return onCall(
    runtime,
    async (req) => {
      const uid =
        assertAuthenticated(
          req,
          HttpsError
        );

      const weekKey =
        normalizeWeekKey(
          req.data?.weekKey,
          HttpsError
        );

      const snapshot =
        await db
          .collection(
            COLLECTION_AVAILABILITY
          )
          .doc(
            availabilityDocumentId(
              uid,
              weekKey
            )
          )
          .get();

      if (!snapshot.exists) {
        return {
          ok: true,
          availability:
            emptyAvailability(
              uid,
              weekKey
            ),
        };
      }

      return {
        ok: true,

        availability:
          publicAvailability(
            snapshot.data() || {},
            uid,
            weekKey
          ),
      };
    }
  );
}


export function buildClearWeeklyAvailability({
  onCall,
  HttpsError,
  runtime,
  db,
}) {
  return onCall(
    runtime,
    async (req) => {
      const uid =
        assertAuthenticated(
          req,
          HttpsError
        );

      const weekKey =
        normalizeWeekKey(
          req.data?.weekKey,
          HttpsError
        );

      const availabilityRef =
        db
          .collection(
            COLLECTION_AVAILABILITY
          )
          .doc(
            availabilityDocumentId(
              uid,
              weekKey
            )
          );

      await db.runTransaction(
        async (tx) => {
          const snapshot =
            await tx.get(
              availabilityRef
            );

          if (!snapshot.exists) {
            return;
          }

          const data =
            snapshot.data() || {};

          const sharedGroupIds =
            Array.isArray(
              data.sharedGroupIds
            )
              ? data
                  .sharedGroupIds
                  .map(asString)
                  .filter(Boolean)
              : [];

          tx.delete(
            availabilityRef
          );

          for (
            const groupId
            of sharedGroupIds
          ) {
            tx.delete(
              db
                .collection(
                  COLLECTION_SHARES
                )
                .doc(
                  availabilityShareDocumentId(
                    weekKey,
                    groupId,
                    uid
                  )
                )
            );
          }
        }
      );

      return {
        ok: true,
        weekKey,
      };
    }
  );
}


async function activeGroupIdsForUser({
  db,
  uid,
}) {
  const snapshot =
    await db
      .collection(
        COLLECTION_MEMBERSHIPS
      )
      .where(
        "userId",
        "==",
        uid
      )
      .where(
        "status",
        "==",
        ACTIVE
      )
      .limit(
        MAX_HOME_GROUPS
      )
      .get();

  return snapshot.docs
    .map(
      (doc) =>
        asString(
          doc.data()?.groupId
        )
    )
    .filter(Boolean);
}


export function buildGetWeeklyAvailabilityHome({
  onCall,
  HttpsError,
  runtime,
  db,
}) {
  return onCall(
    runtime,
    async (req) => {
      const uid =
        assertAuthenticated(
          req,
          HttpsError
        );

      const weekKey =
        normalizeWeekKey(
          req.data?.weekKey,
          HttpsError
        );

      const groupIds =
        await activeGroupIdsForUser({
          db,
          uid,
        });

      if (
        groupIds.length === 0
      ) {
        return {
          ok: true,
          weekKey,
          opportunities: [],
        };
      }

      const opportunities = [];

      for (
        const groupId
        of groupIds
      ) {
        const [
          groupSnapshot,
          sharesSnapshot,
          activeMemberUids,
        ] =
          await Promise.all([
            db
              .collection(
                COLLECTION_GROUPS
              )
              .doc(groupId)
              .get(),

            db
              .collection(
                COLLECTION_SHARES
              )
              .where(
                "groupId",
                "==",
                groupId
              )
              .where(
                "weekKey",
                "==",
                weekKey
              )
              .get(),

            activeMemberUidsForGroup({
              db,
              groupId,
            }),
          ]);

        const group =
          groupSnapshot.exists
            ? groupSnapshot.data()
              || {}
            : {};

        const groupName =
          asString(
            group.name
            || group.title
          )
          || "Groupe Padima";

        const filteredShares =
          filterSharesToActiveMembers(
            sharesSnapshot.docs
              .map(
                (doc) =>
                  doc.data() || {}
              ),
            activeMemberUids
          );

        opportunities.push(
          ...computeGroupOpportunities({
            groupId,
            groupName,

            shares:
              filteredShares,

            currentUid:
              uid,
          })
        );
      }

      return {
        ok: true,
        weekKey,

        opportunities:
          rankHomeOpportunities(
            opportunities
          ),
      };
    }
  );
}


export function buildWeeklyAvailabilityReminderCron({
  onSchedule,
  runtime,
  db,
  FieldValue,
  tokensOf,
  sendVisibleHybrid,
  isPushAllowed,
  logger,
  nowProvider =
    () => new Date(),
}) {
  if (
    typeof onSchedule
      !== "function"
  ) {
    throw new TypeError(
      "ON_SCHEDULE_REQUIRED"
    );
  }

  return onSchedule(
    {
      ...runtime,
      schedule:
        "0 9 * * 1",
      timeZone:
        "Europe/Paris",
    },
    async () => {
      const now =
        nowProvider();

      const weekKey =
        weekKeyForDate(
          now,
          "Europe/Paris"
        );

      const membershipsSnapshot =
        await db
          .collection(
            COLLECTION_MEMBERSHIPS
          )
          .where(
            "status",
            "==",
            ACTIVE
          )
          .get();

      const userIds =
        [
          ...new Set(
            membershipsSnapshot.docs
              .map(
                (doc) =>
                  asString(
                    doc
                      .data()
                      ?.userId
                  )
              )
              .filter(
                (uid) =>
                  uid
                  && !uid.startsWith(
                    "ami_de_"
                  )
              )
          ),
        ];

      let eligible = 0;
      let attempted = 0;
      let sent = 0;

      for (
        const uid
        of userIds
      ) {
        try {
          const availabilityRef =
            db
              .collection(
                COLLECTION_AVAILABILITY
              )
              .doc(
                availabilityDocumentId(
                  uid,
                  weekKey
                )
              );

          const availabilitySnapshot =
            await availabilityRef
              .get();

          if (
            availabilitySnapshot.exists
          ) {
            continue;
          }

          eligible += 1;

          if (
            typeof isPushAllowed === "function"
            && !(await isPushAllowed({
              uid,
              category: "availability",
              event: "availabilityReminder",
            }))
          ) {
            continue;
          }

          const notificationId =
            `weekly_reminder__${weekKey}__${uid}`;

          const notificationRef =
            db
              .collection(
                COLLECTION_MATCH_NOTIFICATIONS
              )
              .doc(
                notificationId
              );

          let claimed = false;

          await db.runTransaction(
            async (tx) => {
              const existing =
                await tx.get(
                  notificationRef
                );

              if (
                existing.exists
              ) {
                return;
              }

              tx.set(
                notificationRef,
                {
                  notificationId,

                  notificationType:
                    "weekly_reminder",

                  weekKey,
                  recipientUid:
                    uid,

                  status:
                    "claimed",

                  createdAt:
                    FieldValue
                      .serverTimestamp(),

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                }
              );

              claimed = true;
            }
          );

          if (!claimed) {
            continue;
          }

          attempted += 1;

          const tokens =
            await tokensOf(uid);

          if (
            !Array.isArray(tokens)
            || !tokens.length
          ) {
            await notificationRef
              .set(
                {
                  status:
                    "no_tokens",

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                },
                {
                  merge: true,
                }
              );

            continue;
          }

          await sendVisibleHybrid(
            tokens,
            {
              title:
                "Ta semaine padel commence ici 🎾",

              body:
                "Envoie tes dispos pour voir avec qui tu peux jouer cette semaine.",

              data: {
                type:
                  "weekly_availability",

                subtype:
                  "weekly_reminder",

                entityType:
                  "weekly_availability",

                entityId:
                  notificationId,

                weekKey,

                destination:
                  "availability_editor",
              },
            }
          );

          await notificationRef
            .set(
              {
                status:
                  "sent",

                sentAt:
                  FieldValue
                    .serverTimestamp(),

                updatedAt:
                  FieldValue
                    .serverTimestamp(),
              },
              {
                merge: true,
              }
            );

          sent += 1;
        } catch (error) {
          logger?.warn?.(
            "weekly availability reminder ignored user failure",
            {
              uid,
              weekKey,

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
        "weekly availability reminder completed",
        {
          weekKey,
          memberships:
            membershipsSnapshot.size,
          uniqueUsers:
            userIds.length,
          eligible,
          attempted,
          sent,
        }
      );

      return {
        weekKey,
        uniqueUsers:
          userIds.length,
        eligible,
        attempted,
        sent,
      };
    }
  );
}
