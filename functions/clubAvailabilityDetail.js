// Path: functions/clubAvailabilityDetail.js

export function buildGetClubAvailabilityDetail({
  onCall,
  HttpsError,
  runtime,
  db,
  asString,
  normalizeDateMs,
}) {
  function assertAuth(req) {
    if (!req.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "UNAUTHENTICATED"
      );
    }

    return req.auth.uid;
  }

  function toMillisOrNull(value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value?.toMillis === "function") {
      return value.toMillis();
    }

    if (typeof value?.seconds === "number") {
      return value.seconds * 1000;
    }

    const normalized = normalizeDateMs(value);
    return normalized || null;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : null;
  }

  function isFriendMarker(value) {
    return (
      typeof value === "string" &&
      value.startsWith("ami_de_")
    );
  }

  function parseFriendMarker(marker) {
    const separatorIndex = marker.indexOf(":");

    const ownerPart =
      separatorIndex >= 0
        ? marker.slice(0, separatorIndex)
        : marker;

    const ownerUid = asString(
      ownerPart.replace(/^ami_de_/, "")
    );

    const friendName =
      separatorIndex >= 0
        ? asString(marker.slice(separatorIndex + 1))
        : "";

    return {
      ownerUid,
      friendName: friendName || "Ami",
    };
  }

  return onCall(runtime, async (req) => {
    const uid = assertAuth(req);

    const availabilityId = asString(
      req.data?.availabilityId
    );

    if (!availabilityId) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_ARGUMENT: availabilityId missing"
      );
    }

    const availabilityRef = db
      .collection("clubAvailabilities")
      .doc(availabilityId);

    const availabilitySnap =
      await availabilityRef.get();

    if (!availabilitySnap.exists) {
      throw new HttpsError(
        "not-found",
        "AVAILABILITY_NOT_FOUND"
      );
    }

    const availability =
      availabilitySnap.data() || {};

    const clubId = asString(
      availability.clubId
    );

    if (!clubId) {
      throw new HttpsError(
        "failed-precondition",
        "AVAILABILITY_CLUB_MISSING"
      );
    }

    const clubSnap = await db
      .collection("clubs")
      .doc(clubId)
      .get();

    if (!clubSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "CLUB_NOT_FOUND"
      );
    }

    const club = clubSnap.data() || {};

    if (asString(club.adminUid) !== uid) {
      throw new HttpsError(
        "permission-denied",
        "NOT_CLUB_OWNER"
      );
    }

    const rawParticipants =
      Array.isArray(availability.participants)
        ? availability.participants.filter(
            (participant) =>
              typeof participant === "string"
          )
        : [];

    const playerUids = [
      ...new Set(
        rawParticipants.filter(
          (participant) =>
            !isFriendMarker(participant)
        )
      ),
    ];

    const playerSnaps = await Promise.all(
      playerUids.map((playerUid) =>
        db.collection("users")
          .doc(playerUid)
          .get()
      )
    );

    const playersByUid = new Map();

    playerSnaps.forEach((playerSnap, index) => {
      const playerUid = playerUids[index];
      const player = playerSnap.exists
        ? playerSnap.data() || {}
        : {};

      playersByUid.set(playerUid, {
        playerUid,
        playerName:
          asString(
            player.pseudo ||
            player.username ||
            player.displayName
          ) || "Joueur",
        avatar: asString(player.avatar),
        avatarUrl: asString(
          player.avatarUrl ||
          player.photoUrl
        ),
      });
    });

    const participants =
      rawParticipants.map(
        (participant, index) => {
          if (isFriendMarker(participant)) {
            const friend =
              parseFriendMarker(participant);

            return {
              id: `friend_${index}`,
              type: "friend",
              playerUid: "",
              ownerUid: friend.ownerUid,
              playerName: friend.friendName,
              friendName: friend.friendName,
              avatar: "",
              avatarUrl: "",
              marker: participant,
              position: index,
            };
          }

          const player =
            playersByUid.get(participant);

          return {
            id: participant,
            type: "player",
            playerUid: participant,
            ownerUid: "",
            playerName:
              player?.playerName ||
              "Joueur",
            friendName: "",
            avatar:
              player?.avatar || "",
            avatarUrl:
              player?.avatarUrl || "",
            marker: "",
            position: index,
          };
        }
      );

    const reservationsSnap = await db
      .collection("clubReservations")
      .where(
        "availabilityId",
        "==",
        availabilityId
      )
      .limit(100)
      .get();

    const reservations =
      reservationsSnap.docs
        .map((doc) => {
          const reservation =
            doc.data() || {};

          return {
            id: doc.id,

            availabilityId,

            clubId:
              asString(
                reservation.clubId
              ) || clubId,

            clubName:
              asString(
                reservation.clubName
              ),

            playerUid:
              asString(
                reservation.playerUid
              ),

            playerName:
              asString(
                reservation.playerName
              ) || "Joueur",

            playerPhone:
              asString(
                reservation.playerPhone
              ),

            courtLabel:
              asString(
                reservation.courtLabel
              ),

            dateHeure:
              toMillisOrNull(
                reservation.dateHeure
              ),

            durationMinutes:
              numberOrNull(
                reservation.durationMinutes
              ),

            price:
              numberOrNull(
                reservation.price
              ),

            status:
              asString(
                reservation.status
              ) || "pending",

            rejectionReason:
              asString(
                reservation.rejectionReason
              ),

            createdAt:
              toMillisOrNull(
                reservation.createdAt
              ),

            updatedAt:
              toMillisOrNull(
                reservation.updatedAt
              ),

            confirmedAt:
              toMillisOrNull(
                reservation.confirmedAt
              ),

            rejectedAt:
              toMillisOrNull(
                reservation.rejectedAt
              ),

            cancelledAt:
              toMillisOrNull(
                reservation.cancelledAt
              ),
          };
        })
        .sort(
          (left, right) =>
            (right.createdAt || 0) -
            (left.createdAt || 0)
        );

    const reservationSummary = {
      total: reservations.length,
      pending: 0,
      confirmed: 0,
      rejected: 0,
      cancelled: 0,
    };

    reservations.forEach((reservation) => {
      if (
        Object.prototype.hasOwnProperty.call(
          reservationSummary,
          reservation.status
        )
      ) {
        reservationSummary[
          reservation.status
        ] += 1;
      }
    });

    const dateHeure =
      toMillisOrNull(
        availability.dateHeure
      );

    const durationMinutes =
      numberOrNull(
        availability.durationMinutes
      );

    const theoreticalEndAt =
      dateHeure !== null &&
      durationMinutes !== null
        ? dateHeure +
          durationMinutes * 60 * 1000
        : null;

    return {
      ok: true,

      availability: {
        id: availabilityId,

        clubId,

        clubName:
          asString(
            availability.clubName
          ) ||
          asString(club.name),

        clubLogoUrl:
          asString(
            availability.clubLogoUrl ||
            club.logoUrl
          ),

        clubCoverUrl:
          asString(
            availability.clubCoverUrl ||
            club.coverUrl
          ),

        courtLabel:
          asString(
            availability.courtLabel
          ) || "Terrain",

        dateHeure,

        durationMinutes,

        theoreticalEndAt,

        price:
          numberOrNull(
            availability.price
          ),

        description:
          asString(
            availability.description
          ),

        joinPlayers:
          availability.joinPlayers === true,

        reserveFullCourt:
          availability.reserveFullCourt === true,

        status:
          asString(
            availability.status
          ) || "open",

        participantCount:
          rawParticipants.length,

        maxPlayers: 4,

        confirmedReservationId:
          asString(
            availability.confirmedReservationId
          ),

        reservedByUid:
          asString(
            availability.reservedByUid
          ),

        createdByUid:
          asString(
            availability.createdByUid
          ),

        createdAt:
          toMillisOrNull(
            availability.createdAt
          ),

        updatedAt:
          toMillisOrNull(
            availability.updatedAt
          ),

        completedAt:
          toMillisOrNull(
            availability.completedAt
          ),

        reopenedAt:
          toMillisOrNull(
            availability.reopenedAt
          ),

        closedAt:
          toMillisOrNull(
            availability.closedAt
          ),

        reservedAt:
          toMillisOrNull(
            availability.reservedAt
          ),
      },

      club: {
        id: clubId,

        name:
          asString(club.name),

        city:
          asString(club.city),

        logoUrl:
          asString(club.logoUrl),

        coverUrl:
          asString(club.coverUrl),

        verified:
          asString(club.status) ===
          "approved",
      },

      participants,

      reservations,

      summary: {
        participantCount:
          rawParticipants.length,

        directPlayerCount:
          playerUids.length,

        friendCount:
          rawParticipants.filter(
            isFriendMarker
          ).length,

        availableSlots:
          Math.max(
            0,
            4 - rawParticipants.length
          ),

        reservations:
          reservationSummary,
      },
    };
  });
}
