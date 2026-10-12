/**
 * Padima — Match Completion V1
 *
 * La réservation est privée et server-authoritative.
 *
 * Stockage :
 * matchCompletions/{matchId}
 *
 * Le document public matches/{matchId} ne contient
 * jamais le lien de réservation.
 */


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function creatorUidOf(match = {}) {
  return (
    asString(match.createurUid)
    || asString(match.creatorUid)
    || (
      match.createdByType === "player"
        ? asString(match.createdById)
        : ""
    )
  );
}


function realParticipantUids(match = {}) {
  const participants =
    Array.isArray(match.participants)
      ? match.participants
      : [];

  return [
    ...new Set(
      participants
        .filter(
          (value) =>
            typeof value === "string"
        )
        .map(asString)
        .filter(Boolean)
        .filter(
          (uid) =>
            !uid.startsWith("ami_de_")
            && !uid.includes(":")
        )
    ),
  ];
}


function capacityOf(match = {}) {
  const raw =
    Number(match.capacity ?? 4);

  return (
    Number.isFinite(raw)
    && raw > 0
  )
    ? Math.floor(raw)
    : 4;
}


function isFullMatch(match = {}) {
  const participants =
    Array.isArray(match.participants)
      ? match.participants
      : [];

  return (
    participants.length
    >= capacityOf(match)
  );
}


function millisOf(value) {
  if (!value) {
    return 0;
  }

  if (
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value.toDate === "function"
  ) {
    return value.toDate().getTime();
  }

  if (
    typeof value === "number"
    && Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    const parsed =
      Date.parse(value);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  return 0;
}


function assertFutureMatch(
  match,
  HttpsError
) {
  const dateMs =
    millisOf(match.dateHeure);

  if (
    dateMs > 0
    && dateMs <= Date.now()
  ) {
    throw new HttpsError(
      "failed-precondition",
      "MATCH_PAST"
    );
  }
}


function normalizeHttpsUrl(
  value,
  HttpsError
) {
  const raw =
    asString(value);

  if (!raw) {
    throw new HttpsError(
      "invalid-argument",
      "RESERVATION_URL_REQUIRED"
    );
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "RESERVATION_URL_INVALID"
    );
  }

  if (
    parsed.protocol !== "https:"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "RESERVATION_URL_MUST_BE_HTTPS"
    );
  }

  if (!parsed.hostname) {
    throw new HttpsError(
      "invalid-argument",
      "RESERVATION_URL_INVALID"
    );
  }

  if (raw.length > 2048) {
    throw new HttpsError(
      "invalid-argument",
      "RESERVATION_URL_TOO_LONG"
    );
  }

  return parsed.toString();
}


function providerForUrl(url) {
  let hostname = "";

  try {
    hostname =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(/^www\./, "");
  } catch {
    return "external";
  }

  if (hostname.includes("4padel")) {
    return "4padel";
  }

  if (hostname.includes("matchi")) {
    return "matchi";
  }

  if (hostname.includes("anybuddy")) {
    return "anybuddy";
  }

  return "external";
}


function confirmedUidsOf(
  completion = {}
) {
  return [
    ...new Set(
      (
        Array.isArray(
          completion
            .reservationConfirmedUids
        )
          ? completion
              .reservationConfirmedUids
          : []
      )
        .filter(
          (value) =>
            typeof value === "string"
        )
        .map(asString)
        .filter(Boolean)
    ),
  ];
}


function completionOf(
  value = {}
) {
  const source =
    (
      value
      && typeof value === "object"
      && !Array.isArray(value)
    )
      ? value
      : {};

  const reservationUrl =
    asString(
      source.reservationUrl
    );

  const reservationStatus =
    (
      asString(
        source.reservationStatus
      ) === "reserved"
      && reservationUrl
    )
      ? "reserved"
      : "awaiting_reservation";

  return {
    reservationStatus,

    reservationUrl:
      reservationUrl || null,

    reservationProvider:
      asString(
        source.reservationProvider
      ) || null,

    reservationSharedAt:
      source.reservationSharedAt
      ?? null,

    reservationSharedByUid:
      asString(
        source.reservationSharedByUid
      ) || null,

    reservationConfirmedUids:
      confirmedUidsOf(source),
  };
}


function emptyCompletion() {
  return {
    reservationStatus:
      "awaiting_reservation",

    reservationUrl:
      null,

    reservationProvider:
      null,

    reservationSharedAt:
      null,

    reservationSharedByUid:
      null,

    reservationConfirmedUids:
      [],
  };
}


function canReadCompletion(
  match,
  uid
) {
  if (!uid) {
    return false;
  }

  if (
    creatorUidOf(match) === uid
  ) {
    return true;
  }

  return realParticipantUids(match)
    .includes(uid);
}


export function reconcileMatchCompletionAfterParticipantsChange({
  completion,
  participants,
}) {
  const safeCompletion =
    completionOf(completion);

  if (
    safeCompletion
      .reservationStatus
      !== "reserved"
  ) {
    return {
      changed: false,
      reservationConfirmedUids:
        confirmedUidsOf(
          safeCompletion
        ),
    };
  }

  const participantUids =
    new Set(
      (
        Array.isArray(participants)
          ? participants
          : []
      )
        .filter(
          (value) =>
            typeof value === "string"
        )
        .map(asString)
        .filter(Boolean)
        .filter(
          (uid) =>
            !uid.startsWith("ami_de_")
            && !uid.includes(":")
        )
    );

  const previousConfirmed =
    confirmedUidsOf(
      safeCompletion
    );

  const nextConfirmed =
    previousConfirmed.filter(
      (uid) =>
        participantUids.has(uid)
    );

  return {
    changed:
      nextConfirmed.length
      !== previousConfirmed.length,

    reservationConfirmedUids:
      nextConfirmed,
  };
}


async function notifyUsers({
  recipientUids,
  tokensOf,
  sendVisibleHybrid,
  logger,
  title,
  body,
  data,
}) {
  let sentUserCount = 0;

  for (
    const recipientUid
    of recipientUids
  ) {
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
          title,
          body,
          data,
        }
      );

      sentUserCount += 1;

    } catch (error) {
      logger?.warn?.(
        "match completion notification ignored recipient failure",
        {
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

  return sentUserCount;
}


export function buildNotifyMatchCompletionAfterJoin({
  tokensOf,
  sendVisibleHybrid,
  logger,
}) {
  if (
    typeof tokensOf !== "function"
  ) {
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

  return async function notifyMatchCompletionAfterJoin({
    matchId,
    match = {},
    completion = {},
    joinedUid,
    becameFull = false,
  }) {
    const actorUid =
      asString(joinedUid);

    const creatorUid =
      creatorUidOf(match);

    const safeCompletion =
      completionOf(completion);

    const hasReservation =
      safeCompletion
        .reservationStatus
        === "reserved"
      && !!safeCompletion
        .reservationUrl;

    const place =
      asString(
        match.lieu
        || match.placeName
      );

    if (
      actorUid
      && hasReservation
      && actorUid !== creatorUid
    ) {
      const sentUserCount =
        await notifyUsers({
          recipientUids: [
            actorUid,
          ],

          tokensOf,
          sendVisibleHybrid,
          logger,

          title:
            "🎾 Terrain déjà réservé",

          body:
            place
              ? `Le terrain pour ton match à ${place} est déjà réservé. Rejoins la réservation pour confirmer ta place.`
              : "Le terrain de ton match est déjà réservé. Rejoins la réservation pour confirmer ta place.",

          data: {
            type:
              "match_reservation",

            subtype:
              "reservation_available",

            matchId:
              asString(matchId),

            entityType:
              "match",

            entityId:
              asString(matchId),
          },
        });

      return {
        type:
          "reservation_available",

        sentUserCount,
      };
    }

    if (
      becameFull
      && creatorUid
      && !hasReservation
    ) {
      const sentUserCount =
        await notifyUsers({
          recipientUids: [
            creatorUid,
          ],

          tokensOf,
          sendVisibleHybrid,
          logger,

          title:
            "🎾 Ton match est complet",

          body:
            place
              ? `Les joueurs sont trouvés pour ton match à ${place}. Réserve maintenant le terrain pour confirmer la partie.`
              : "Les joueurs sont trouvés. Réserve maintenant le terrain pour confirmer la partie.",

          data: {
            type:
              "match_reservation",

            subtype:
              "reservation_required",

            matchId:
              asString(matchId),

            entityType:
              "match",

            entityId:
              asString(matchId),
          },
        });

      return {
        type:
          "reservation_required",

        sentUserCount,
      };
    }

    return {
      type: null,
      sentUserCount: 0,
    };
  };
}


export function buildGetMatchCompletion({
  onCall,
  HttpsError,
  runtime,
  db,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "AUTH_REQUIRED"
        );
      }

      const matchId =
        asString(
          request.data?.matchId
        );

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "MATCH_ID_REQUIRED"
        );
      }

      const matchRef =
        db.collection("matches")
          .doc(matchId);

      const completionRef =
        db.collection(
          "matchCompletions"
        )
          .doc(matchId);

      const [
        matchSnap,
        completionSnap,
      ] = await Promise.all([
        matchRef.get(),
        completionRef.get(),
      ]);

      if (!matchSnap.exists) {
        throw new HttpsError(
          "not-found",
          "MATCH_NOT_FOUND"
        );
      }

      const match =
        matchSnap.data() ?? {};

      if (
        !canReadCompletion(
          match,
          uid
        )
      ) {
        throw new HttpsError(
          "permission-denied",
          "NOT_MATCH_PARTICIPANT"
        );
      }

      return {
        ok: true,
        matchId,

        completion:
          completionOf(
            completionSnap.exists
              ? completionSnap.data()
              : {}
          ),
      };
    }
  );
}


export function buildSetMatchReservation({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  tokensOf,
  sendVisibleHybrid,
  logger,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "AUTH_REQUIRED"
        );
      }

      const matchId =
        asString(
          request.data?.matchId
        );

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "MATCH_ID_REQUIRED"
        );
      }

      const reservationUrl =
        normalizeHttpsUrl(
          request.data
            ?.reservationUrl,
          HttpsError
        );

      const reservationProvider =
        providerForUrl(
          reservationUrl
        );

      const matchRef =
        db.collection("matches")
          .doc(matchId);

      const completionRef =
        db.collection(
          "matchCompletions"
        )
          .doc(matchId);

      let notificationRecipients = [];
      let notificationPlace = "";
      let changed = false;
      let responseCompletion = null;

      await db.runTransaction(
        async (transaction) => {
          const matchSnap =
            await transaction.get(
              matchRef
            );

          const completionSnap =
            await transaction.get(
              completionRef
            );

          if (!matchSnap.exists) {
            throw new HttpsError(
              "not-found",
              "MATCH_NOT_FOUND"
            );
          }

          const match =
            matchSnap.data() ?? {};

          const creatorUid =
            creatorUidOf(match);

          if (
            !creatorUid
            || creatorUid !== uid
          ) {
            throw new HttpsError(
              "permission-denied",
              "ONLY_CREATOR_CAN_SET_RESERVATION"
            );
          }

          assertFutureMatch(
            match,
            HttpsError
          );

          if (!isFullMatch(match)) {
            throw new HttpsError(
              "failed-precondition",
              "MATCH_NOT_FULL"
            );
          }

          const currentCompletion =
            completionOf(
              completionSnap.exists
                ? completionSnap.data()
                : {}
            );

          if (
            currentCompletion
              .reservationStatus
              === "reserved"
            && currentCompletion
              .reservationUrl
              === reservationUrl
          ) {
            responseCompletion =
              currentCompletion;

            return;
          }

          const participants =
            realParticipantUids(
              match
            );

          const confirmedUids =
            participants.includes(
              creatorUid
            )
              ? [creatorUid]
              : [];

          const now =
            FieldValue
              .serverTimestamp();

          const completion = {
            matchId,

            reservationStatus:
              "reserved",

            reservationUrl,

            reservationProvider,

            reservationSharedAt:
              now,

            reservationSharedByUid:
              uid,

            reservationConfirmedUids:
              confirmedUids,

            updatedAt:
              now,
          };

          transaction.set(
            completionRef,
            completion
          );

          changed = true;

          responseCompletion = {
            ...completionOf(
              completion
            ),

            reservationSharedAt:
              null,
          };

          notificationRecipients =
            participants.filter(
              (participantUid) =>
                participantUid
                !== creatorUid
            );

          notificationPlace =
            asString(
              match.lieu
              || match.placeName
            );
        }
      );

      let sentUserCount = 0;

      if (changed) {
        const body =
          notificationPlace
            ? `Le terrain pour ton match à ${notificationPlace} est réservé. Rejoins la réservation pour confirmer ta place.`
            : "Le terrain de ton match est réservé. Rejoins la réservation pour confirmer ta place.";

        sentUserCount =
          await notifyUsers({
            recipientUids:
              notificationRecipients,

            tokensOf,
            sendVisibleHybrid,
            logger,

            title:
              "🎾 Terrain réservé",

            body,

            data: {
              type:
                "match_reservation",

              subtype:
                "reservation_shared",

              matchId,

              entityType:
                "match",

              entityId:
                matchId,
            },
          });
      }

      return {
        ok: true,
        changed,
        matchId,

        completion:
          responseCompletion,

        notifiedUserCount:
          sentUserCount,
      };
    }
  );
}


export function buildConfirmMatchReservation({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  tokensOf,
  sendVisibleHybrid,
  logger,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "AUTH_REQUIRED"
        );
      }

      const matchId =
        asString(
          request.data?.matchId
        );

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "MATCH_ID_REQUIRED"
        );
      }

      const matchRef =
        db.collection("matches")
          .doc(matchId);

      const completionRef =
        db.collection(
          "matchCompletions"
        )
          .doc(matchId);

      let changed = false;
      let creatorUid = "";
      let actorPseudo = "";
      let confirmedCount = 0;
      let confirmableCount = 0;

      await db.runTransaction(
        async (transaction) => {
          const matchSnap =
            await transaction.get(
              matchRef
            );

          const userRef =
            db.collection("users")
              .doc(uid);

          const userSnap =
            await transaction.get(
              userRef
            );

          const completionSnap =
            await transaction.get(
              completionRef
            );

          if (!matchSnap.exists) {
            throw new HttpsError(
              "not-found",
              "MATCH_NOT_FOUND"
            );
          }

          const match =
            matchSnap.data() ?? {};

          assertFutureMatch(
            match,
            HttpsError
          );

          const participants =
            realParticipantUids(
              match
            );

          if (
            !participants.includes(uid)
          ) {
            throw new HttpsError(
              "permission-denied",
              "NOT_MATCH_PARTICIPANT"
            );
          }

          const completion =
            completionOf(
              completionSnap.exists
                ? completionSnap.data()
                : {}
            );

          if (
            completion
              .reservationStatus
              !== "reserved"
            || !completion
              .reservationUrl
          ) {
            throw new HttpsError(
              "failed-precondition",
              "RESERVATION_NOT_AVAILABLE"
            );
          }

          const confirmed =
            confirmedUidsOf(
              completion
            ).filter(
              (confirmedUid) =>
                participants.includes(
                  confirmedUid
                )
            );

          creatorUid =
            creatorUidOf(match);

          confirmableCount =
            participants.length;

          if (
            confirmed.includes(uid)
          ) {
            confirmedCount =
              confirmed.length;

            return;
          }

          const nextConfirmed = [
            ...confirmed,
            uid,
          ];

          const now =
            FieldValue
              .serverTimestamp();

          transaction.set(
            completionRef,
            {
              reservationConfirmedUids:
                nextConfirmed,

              updatedAt:
                now,
            },
            {
              merge: true,
            }
          );

          changed = true;

          confirmedCount =
            nextConfirmed.length;

          const user =
            userSnap.exists
              ? userSnap.data() ?? {}
              : {};

          actorPseudo =
            asString(
              user.pseudo
              || user.username
              || user.displayName
            )
            || "Un joueur";
        }
      );

      if (
        changed
        && creatorUid
        && creatorUid !== uid
      ) {
        await notifyUsers({
          recipientUids: [
            creatorUid,
          ],

          tokensOf,
          sendVisibleHybrid,
          logger,

          title:
            "Réservation confirmée ✓",

          body:
            `${actorPseudo} a rejoint la réservation (${confirmedCount}/${confirmableCount}).`,

          data: {
            type:
              "match_reservation",

            subtype:
              "reservation_confirmed",

            matchId,

            entityType:
              "match",

            entityId:
              matchId,
          },
        });
      }

      return {
        ok: true,
        changed,
        matchId,
        confirmedCount,
        confirmableCount,

        allConfirmed:
          confirmableCount > 0
          && confirmedCount
            >= confirmableCount,
      };
    }
  );
}


export function buildUnconfirmMatchReservation({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "AUTH_REQUIRED"
        );
      }

      const matchId =
        asString(
          request.data?.matchId
        );

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "MATCH_ID_REQUIRED"
        );
      }

      const matchRef =
        db.collection("matches")
          .doc(matchId);

      const completionRef =
        db.collection(
          "matchCompletions"
        )
          .doc(matchId);

      let changed = false;
      let confirmedCount = 0;
      let confirmableCount = 0;

      await db.runTransaction(
        async (transaction) => {
          const matchSnap =
            await transaction.get(
              matchRef
            );

          const completionSnap =
            await transaction.get(
              completionRef
            );

          if (!matchSnap.exists) {
            throw new HttpsError(
              "not-found",
              "MATCH_NOT_FOUND"
            );
          }

          const match =
            matchSnap.data() ?? {};

          const creatorUid =
            creatorUidOf(match);

          if (
            creatorUid
            && creatorUid === uid
          ) {
            throw new HttpsError(
              "failed-precondition",
              "CREATOR_CONFIRMATION_LOCKED"
            );
          }

          const participants =
            realParticipantUids(
              match
            );

          if (
            !participants.includes(uid)
          ) {
            throw new HttpsError(
              "permission-denied",
              "NOT_MATCH_PARTICIPANT"
            );
          }

          const completion =
            completionOf(
              completionSnap.exists
                ? completionSnap.data()
                : {}
            );

          if (
            completion
              .reservationStatus
              !== "reserved"
          ) {
            throw new HttpsError(
              "failed-precondition",
              "RESERVATION_NOT_AVAILABLE"
            );
          }

          const confirmed =
            confirmedUidsOf(
              completion
            ).filter(
              (confirmedUid) =>
                participants.includes(
                  confirmedUid
                )
            );

          const nextConfirmed =
            confirmed.filter(
              (confirmedUid) =>
                confirmedUid !== uid
            );

          confirmedCount =
            nextConfirmed.length;

          confirmableCount =
            participants.length;

          if (
            nextConfirmed.length
            === confirmed.length
          ) {
            return;
          }

          transaction.set(
            completionRef,
            {
              reservationConfirmedUids:
                nextConfirmed,

              updatedAt:
                FieldValue
                  .serverTimestamp(),
            },
            {
              merge: true,
            }
          );

          changed = true;
        }
      );

      return {
        ok: true,
        changed,
        matchId,
        confirmedCount,
        confirmableCount,
      };
    }
  );
}


export function buildClearMatchReservation({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "AUTH_REQUIRED"
        );
      }

      const matchId =
        asString(
          request.data?.matchId
        );

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "MATCH_ID_REQUIRED"
        );
      }

      const matchRef =
        db.collection("matches")
          .doc(matchId);

      const completionRef =
        db.collection(
          "matchCompletions"
        )
          .doc(matchId);

      let changed = false;

      await db.runTransaction(
        async (transaction) => {
          const matchSnap =
            await transaction.get(
              matchRef
            );

          const completionSnap =
            await transaction.get(
              completionRef
            );

          if (!matchSnap.exists) {
            throw new HttpsError(
              "not-found",
              "MATCH_NOT_FOUND"
            );
          }

          const match =
            matchSnap.data() ?? {};

          const creatorUid =
            creatorUidOf(match);

          if (
            !creatorUid
            || creatorUid !== uid
          ) {
            throw new HttpsError(
              "permission-denied",
              "ONLY_CREATOR_CAN_CLEAR_RESERVATION"
            );
          }

          const current =
            completionOf(
              completionSnap.exists
                ? completionSnap.data()
                : {}
            );

          if (
            current
              .reservationStatus
              !== "reserved"
            && !current
              .reservationUrl
          ) {
            return;
          }

          transaction.set(
            completionRef,
            {
              matchId,
              ...emptyCompletion(),

              updatedAt:
                FieldValue
                  .serverTimestamp(),
            }
          );

          changed = true;
        }
      );

      return {
        ok: true,
        changed,
        matchId,
      };
    }
  );
}
