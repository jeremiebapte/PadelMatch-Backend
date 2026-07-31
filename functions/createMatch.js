// Path: functions/createMatch.js
// ======================================================
// Padima — Match creation V2
//
// Responsabilités :
// - préserver la callable historique createMatch ;
// - centraliser la validation et la création ;
// - supporter facultativement groupId ;
// - conserver les flux Player et Club existants ;
// - enregistrer l'activité et les statistiques Groups.
// ======================================================

import {

  GroupActivityType,
  GroupActivityVisibility,
  GroupPermissionError,
  assertCanCreateMatch,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateGroupId,
  recordMatchCreated,
} from "./domain/groups/index.js";


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function asNumber(value) {
  return (
    typeof value === "number"
    && !Number.isNaN(value)
  )
    ? value
    : null;
}


function normalizeDateMs(value) {
  if (typeof value !== "number") {
    return 0;
  }

  if (
    value > 0
    && value < 1_000_000_000_000
  ) {
    return value * 1000;
  }

  return value;
}


function validateCreateMatchInput(
  data,
  HttpsError
) {
  const createdByType =
    data?.createdByType === "club"
      ? "club"
      : "player";

  const placeId =
    asString(data?.placeId);

  const lieu =
    asString(
      data?.lieu
      || data?.placeName
      || "Club"
    );

  const dateHeure =
    normalizeDateMs(
      data?.dateHeure
    );

  const lat =
    asNumber(data?.lat)
    ?? asNumber(data?.latitude);

  const lng =
    asNumber(data?.lng)
    ?? asNumber(data?.longitude);

  const niveauRaw =
    data?.niveau
    ?? data?.level;

  const niveau =
    typeof niveauRaw === "number"
      ? Math.round(niveauRaw)
      : Number(niveauRaw);

  const descriptionRaw =
    asString(data?.description);

  const description =
    descriptionRaw
      ? descriptionRaw.trim()
      : "";

  const joueursManquants =
    data?.joueursManquants === 1
    || data?.joueursManquants === 2
      ? data.joueursManquants
      : null;

  const clubId =
    asString(data?.clubId)
    || null;

  const rawGroupId =
    asString(data?.groupId);

  let groupId = null;

  if (rawGroupId) {
    try {
      groupId =
        validateGroupId(rawGroupId);
    } catch {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_GROUP_ID"
      );
    }
  }

  if (!placeId) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_ARGUMENT: placeId missing"
    );
  }

  if (!dateHeure) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_ARGUMENT: dateHeure missing"
    );
  }

  if (dateHeure <= Date.now()) {
    throw new HttpsError(
      "failed-precondition",
      "MATCH_PAST"
    );
  }

  if (
    lat === null
    || lng === null
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_ARGUMENT: lat/lng missing"
    );
  }

  if (
    !Number.isFinite(niveau)
    || niveau < 1
    || niveau > 10
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_ARGUMENT: niveau invalid"
    );
  }

  if (joueursManquants === null) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_ARGUMENT: joueursManquants must be 1 or 2"
    );
  }

  if (
    createdByType === "club"
    && !clubId
  ) {
    throw new HttpsError(
      "invalid-argument",
      "INVALID_ARGUMENT: clubId missing"
    );
  }

  return {
    createdByType,
    placeId,
    lieu,
    dateHeure,
    lat,
    lng,
    niveau,
    description,
    joueursManquants,
    clubId,
    groupId,
  };
}


async function validateClubContext({
  db,
  uid,
  input,
  data,
  HttpsError,
}) {
  if (
    input.createdByType
    !== "club"
  ) {
    return {
      clubName: "",
      clubLogoUrl: "",
      clubVerified: false,
    };
  }

  const clubSnapshot =
    await db
      .collection("clubs")
      .doc(input.clubId)
      .get();

  if (!clubSnapshot.exists) {
    throw new HttpsError(
      "failed-precondition",
      "CLUB_NOT_FOUND"
    );
  }

  const club =
    clubSnapshot.data()
    || {};

  if (
    asString(club.adminUid)
    !== uid
  ) {
    throw new HttpsError(
      "permission-denied",
      "NOT_CLUB_OWNER"
    );
  }

  if (
    asString(club.status)
    !== "approved"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "CLUB_NOT_APPROVED"
    );
  }

  return {
    clubName:
      asString(club.name)
      || asString(data?.clubName)
      || input.lieu,

    clubLogoUrl:
      asString(club.logoUrl),

    clubVerified: true,
  };
}


async function validateGroupContext({
  db,
  uid,
  groupId,
  HttpsError,
}) {
  if (!groupId) {
    return null;
  }

  const membershipId =
    membershipDocumentId(
      groupId,
      uid
    );

  const [
    groupSnapshot,
    membershipSnapshot,
  ] = await Promise.all([
    db
      .collection("groups")
      .doc(groupId)
      .get(),

    db
      .collection(
        "groupMemberships"
      )
      .doc(membershipId)
      .get(),
  ]);

  if (!groupSnapshot.exists) {
    throw new HttpsError(
      "not-found",
      "GROUP_NOT_FOUND"
    );
  }

  if (!membershipSnapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "GROUP_MEMBERSHIP_NOT_FOUND"
    );
  }

  const group =
    groupSnapshot.data()
    || {};

  const membership =
    membershipSnapshot.data()
    || {};

  try {
    assertCanCreateMatch(
      group,
      membership
    );
  } catch (error) {
    if (
      error instanceof
      GroupPermissionError
    ) {
      switch (error.code) {
        case "GROUP_NOT_ACTIVE":
          throw new HttpsError(
            "failed-precondition",
            "GROUP_NOT_ACTIVE"
          );

        case "MATCH_CREATION_NOT_ALLOWED":
        case "ACTIVE_MEMBERSHIP_REQUIRED":
          throw new HttpsError(
            "permission-denied",
            error.code
          );

        default:
          throw new HttpsError(
            "permission-denied",
            "GROUP_PERMISSION_DENIED"
          );
      }
    }

    throw error;
  }

  return {
    group,
    membership,
    membershipId,
  };
}


async function validateScheduling({
  uid,
  input,
  hasTimeOverlap,
  hasReservationOverlap,
  hasPlaceConflictKm1,
  logger,
  HttpsError,
}) {
  if (
    input.createdByType
    !== "player"
  ) {
    return;
  }

  let overlap = false;

  try {
    overlap =
      await hasTimeOverlap(
        uid,
        input.dateHeure
      );
  } catch (error) {
    logger?.error?.(
      "createMatch hasTimeOverlap crash",
      {
        uid,
        dateHeure:
          input.dateHeure,
        err: String(
          error?.message
          ?? error
        ),
      }
    );

    throw new HttpsError(
      "internal",
      "TIME_OVERLAP_INTERNAL"
    );
  }

  if (overlap) {
    throw new HttpsError(
      "failed-precondition",
      "TIME_OVERLAP"
    );
  }

  let reservationOverlap = false;

  try {
    reservationOverlap =
      await hasReservationOverlap(
        uid,
        input.dateHeure
      );
  } catch (error) {
    logger?.error?.(
      "createMatch hasReservationOverlap crash",
      {
        uid,
        dateHeure:
          input.dateHeure,
        err: String(
          error?.message
          ?? error
        ),
      }
    );

    throw new HttpsError(
      "internal",
      "RESERVATION_OVERLAP_INTERNAL"
    );
  }

  if (reservationOverlap) {
    throw new HttpsError(
      "failed-precondition",
      "RESERVATION_TIME_OVERLAP"
    );
  }

  let placeConflict = false;

  try {
    placeConflict =
      await hasPlaceConflictKm1(
        input.lat,
        input.lng,
        input.dateHeure
      );
  } catch (error) {
    logger?.error?.(
      "createMatch hasPlaceConflictKm1 crash",
      {
        uid,
        placeId:
          input.placeId,
        lat: input.lat,
        lng: input.lng,
        dateHeure:
          input.dateHeure,
        err: String(
          error?.message
          ?? error
        ),
      }
    );

    throw new HttpsError(
      "internal",
      "PLACE_CONFLICT_INTERNAL"
    );
  }

  if (placeConflict) {
    throw new HttpsError(
      "failed-precondition",
      "PLACE_CONFLICT"
    );
  }
}


function buildParticipants(
  uid,
  joueursManquants
) {
  const participants = [uid];

  if (joueursManquants === 1) {
    participants.push(
      `ami_de_${uid}:Joueur 1`,
      `ami_de_${uid}:Joueur 2`
    );
  } else {
    participants.push(
      `ami_de_${uid}:Joueur 1`
    );
  }

  return participants;
}


async function loadCreatorProfile({
  db,
  uid,
  createdByType,
  logger,
}) {
  if (
    createdByType
    !== "player"
  ) {
    return {
      pseudo: "",
      avatar: "",
    };
  }

  try {
    const snapshot =
      await db
        .collection("users")
        .doc(uid)
        .get();

    if (!snapshot.exists) {
      return {
        pseudo: "",
        avatar: "",
      };
    }

    return {
      pseudo:
        asString(
          snapshot.get("pseudo")
          || snapshot.get("username")
        ),

      avatar:
        asString(
          snapshot.get("avatar")
          || snapshot.get("photoUrl")
        ),
    };
  } catch (error) {
    logger?.warn?.(
      "createMatch: user profile read failed",
      {
        uid,
        err: String(
          error?.message
          ?? error
        ),
      }
    );

    return {
      pseudo: "",
      avatar: "",
    };
  }
}


function buildMatchDocument({
  uid,
  createdById,
  input,
  clubContext,
  creatorProfile,
  participants,
  FieldValue,
}) {

  const document = {
    lieu: input.lieu,
    placeName: input.lieu,
    placeId: input.placeId,

    latitude: input.lat,
    longitude: input.lng,
    lat: input.lat,
    lng: input.lng,

    dateHeure:
      input.dateHeure,

    niveau:
      input.niveau,

    level:
      input.niveau,

    createurUid: uid,

    createdByType:
      input.createdByType,

    createdById,

    participants,

    ...(input.groupId
      ? {
          groupId:
            input.groupId,
        }
      : {}),

    ...(input.createdByType
      === "club"
      ? {
          clubId:
            input.clubId,

          clubName:
            clubContext.clubName,

          clubVerified:
            clubContext.clubVerified,

          ...(clubContext.clubLogoUrl
            ? {
                clubLogoUrl:
                  clubContext
                    .clubLogoUrl,
              }
            : {}),
        }
      : {}),

    ...(input.createdByType
      === "player"
      && creatorProfile.pseudo
      ? {
          createurPseudo:
            creatorProfile.pseudo,
        }
      : {}),

    ...(input.createdByType
      === "player"
      && creatorProfile.avatar
      ? {
          createurAvatar:
            creatorProfile.avatar,
        }
      : {}),

    createdAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp(),
  };

  if (
    input.description.length > 0
  ) {
    document.description =
      input.description;
  }

  return document;
}




export function buildCreateMatch({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
  hasTimeOverlap,
  hasReservationOverlap,
  hasPlaceConflictKm1,
  recordClubActivity,
  notifyGroupMatchCreated,
  frDate,
  frTime,
}) {
  if (
    typeof onCall
    !== "function"
  ) {
    throw new TypeError(
      "ON_CALL_REQUIRED"
    );
  }

  if (
    typeof HttpsError
    !== "function"
  ) {
    throw new TypeError(
      "HTTPS_ERROR_REQUIRED"
    );
  }

  if (!db) {
    throw new TypeError(
      "DB_REQUIRED"
    );
  }

  if (
    !FieldValue
      ?.serverTimestamp
  ) {
    throw new TypeError(
      "FIELD_VALUE_REQUIRED"
    );
  }

  if (
    typeof hasTimeOverlap
    !== "function"
  ) {
    throw new TypeError(
      "HAS_TIME_OVERLAP_REQUIRED"
    );
  }

  if (
    typeof hasReservationOverlap
    !== "function"
  ) {
    throw new TypeError(
      "HAS_RESERVATION_OVERLAP_REQUIRED"
    );
  }

  if (
    typeof hasPlaceConflictKm1
    !== "function"
  ) {
    throw new TypeError(
      "HAS_PLACE_CONFLICT_REQUIRED"
    );
  }

  const recordGroupActivity =
    createGroupActivityRecorder({
      db,
      logger,
    });

  return onCall(
    runtime,
    async (req) => {
      const uid =
        req.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "UNAUTHENTICATED"
        );
      }

      const data =
        req.data
        ?? {};

      try {
        const input =
          validateCreateMatchInput(
            data,
            HttpsError
          );

        const createdById =
          asString(
            data?.createdById
          )
          || uid;

        const [
          clubContext,
          groupContext,
        ] = await Promise.all([
          validateClubContext({
            db,
            uid,
            input,
            data,
            HttpsError,
          }),

          validateGroupContext({
            db,
            uid,
            groupId:
              input.groupId,
            HttpsError,
          }),
        ]);

        await validateScheduling({
          uid,
          input,
          hasTimeOverlap,
          hasReservationOverlap,
          hasPlaceConflictKm1,
          logger,
          HttpsError,
        });

        const [
          creatorProfile,
          participants,
        ] = await Promise.all([
          loadCreatorProfile({
            db,
            uid,
            createdByType:
              input.createdByType,
            logger,
          }),

          Promise.resolve(
            buildParticipants(
              uid,
              input.joueursManquants
            )
          ),
        ]);

        const document =
          buildMatchDocument({
            uid,
            createdById,
            input,
            clubContext,
            creatorProfile,
            participants,
            FieldValue,
  });

        let matchReference;

        try {
          matchReference =
            await db
              .collection("matches")
              .add(document);
        } catch (error) {
          logger?.error?.(
            "createMatch Firestore add failed",
            {
              uid,
              createdByType:
                input.createdByType,
              createdById,
              clubId:
                input.clubId,
              groupId:
                input.groupId,
              placeId:
                input.placeId,
              dateHeure:
                input.dateHeure,
              niveau:
                input.niveau,
              err: String(
                error?.message
                ?? error
              ),
            }
          );

          throw new HttpsError(
            "internal",
            "FIRESTORE_WRITE_FAILED"
          );
        }

        logger?.info?.(
          "createMatch ok",
          {
            matchId:
              matchReference.id,
            uid,
            createdByType:
              input.createdByType,
            createdById,
            clubId:
              input.clubId,
            groupId:
              input.groupId,
            groupMembershipId:
              groupContext
                ?.membershipId
                ?? null,
            placeId:
              input.placeId,
            dateHeure:
              input.dateHeure,
            niveau:
              input.niveau,
            joueursManquants:
              input
                .joueursManquants,
          }
        );

        if (
          input.createdByType
          === "club"
          && input.clubId
          && typeof recordClubActivity
            === "function"
        ) {
          await recordClubActivity({
            clubId:
              input.clubId,

            type:
              "MATCH_CREATED",

            displayType:
              "match",

            entityType:
              "match",

            entityId:
              matchReference.id,

            actorUid: uid,

            actorName:
              clubContext.clubName
              || "Club",

            title:
              "Nouveau match publié",

            subtitle:
              `${input.lieu} · ${
                frDate(input.dateHeure)
              } à ${
                frTime(input.dateHeure)
              }`,

            metadata: {
              dateHeure:
                input.dateHeure,

              niveau:
                input.niveau,

              lieu:
                input.lieu,
            },
          });
        }

        await recordMatchCreated({
          groupId:
            input.groupId,

          matchId:
            matchReference.id,

          uid,
          input,
          creatorProfile,
          recordGroupActivity,
          db,
          FieldValue,
          logger,
        });

        if (
          input.groupId
          && typeof notifyGroupMatchCreated
            === "function"
        ) {
          try {
            await notifyGroupMatchCreated({
              groupId:
                input.groupId,

              group:
                groupContext?.group
                ?? {},

              matchId:
                matchReference.id,

              creatorUid:
                uid,

              creatorProfile,

              match: {
                ...document,
                matchId:
                  matchReference.id,
              },
            });
          } catch (error) {
            logger?.warn?.(
              "createMatch group notification ignored failure",
              {
                groupId:
                  input.groupId,

                matchId:
                  matchReference.id,

                uid,

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
          ok: true,
          matchId:
            matchReference.id,
        };
      } catch (error) {
        if (
          error instanceof
          HttpsError
        ) {
          throw error;
        }

        logger?.error?.(
          "createMatch UNHANDLED INTERNAL",
          {
            err: String(
              error?.message
              ?? error
            ),

            code:
              error?.code
              ?? error?.name
              ?? "UNKNOWN_ERROR",

            dataKeys:
              Object.keys(data),

            uid,
          }
        );

        throw new HttpsError(
          "internal",
          "CREATE_MATCH_INTERNAL"
        );
      }
    }
  );
}
