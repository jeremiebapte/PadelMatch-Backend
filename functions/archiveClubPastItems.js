// Path: functions/archiveClubPastItems.js

export function buildArchiveClubPastItems({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  asString,
  normalizeDateMs,
}) {
  function assertAuth(req) {
    const uid = req.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "UNAUTHENTICATED"
      );
    }

    return uid;
  }

  function toMillis(value) {
    if (value === null || value === undefined) {
      return 0;
    }

    if (typeof value?.toMillis === "function") {
      return value.toMillis();
    }

    if (typeof value?.seconds === "number") {
      return value.seconds * 1000;
    }

    const normalized = normalizeDateMs(value);
    return normalized || 0;
  }

  function durationMs(value) {
    const duration = Number(value);

    return Number.isFinite(duration) && duration > 0
      ? duration * 60 * 1000
      : 90 * 60 * 1000;
  }

  return onCall(runtime, async (req) => {
    const uid = assertAuth(req);

    const userSnap = await db
      .collection("users")
      .doc(uid)
      .get();

    if (!userSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "USER_NOT_FOUND"
      );
    }

    const user = userSnap.data() || {};

    if (asString(user.role) !== "club_admin") {
      throw new HttpsError(
        "permission-denied",
        "NOT_CLUB_ADMIN"
      );
    }

    const clubId = asString(user.clubId);

    if (!clubId) {
      throw new HttpsError(
        "failed-precondition",
        "CLUB_ID_MISSING"
      );
    }

    const now = Date.now();

    const [
      matchesSnap,
      availabilitiesSnap,
      reservationsSnap,
    ] = await Promise.all([
      db.collection("matches")
        .where("clubId", "==", clubId)
        .get(),

      db.collection("clubAvailabilities")
        .where("clubId", "==", clubId)
        .get(),

      db.collection("clubReservations")
        .where("clubId", "==", clubId)
        .get(),
    ]);

    const batch = db.batch();

    let archivedMatches = 0;
    let archivedAvailabilities = 0;
    let archivedReservations = 0;

    for (const doc of matchesSnap.docs) {
      const data = doc.data() || {};
      const status = asString(data.status);

      if (status === "archived") {
        continue;
      }

      const startAt = toMillis(data.dateHeure);
      const endAt =
        startAt + durationMs(data.durationMinutes);

      if (startAt > 0 && endAt <= now) {
        batch.set(doc.ref, {
          status: "archived",
          previousStatus: status || "open",
          archivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        archivedMatches++;
      }
    }

    for (const doc of availabilitiesSnap.docs) {
      const data = doc.data() || {};
      const status = asString(data.status);

      if (
        status === "archived" ||
        status === "cancelled"
      ) {
        continue;
      }

      const startAt = toMillis(data.dateHeure);
      const endAt =
        startAt + durationMs(data.durationMinutes);

      if (startAt > 0 && endAt <= now) {
        batch.set(doc.ref, {
          status: "archived",
          previousStatus: status || "open",
          archivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        archivedAvailabilities++;
      }
    }

    for (const doc of reservationsSnap.docs) {
      const data = doc.data() || {};
      const status = asString(data.status);

      if (
        status === "archived" ||
        status !== "confirmed"
      ) {
        continue;
      }

      const startAt = toMillis(data.dateHeure);

      // Règle validée : visible jusqu'à 20 minutes
      // après la fin théorique de la réservation.
      const archiveAt =
        startAt +
        durationMs(data.durationMinutes) +
        20 * 60 * 1000;

      if (startAt > 0 && archiveAt <= now) {
        batch.set(doc.ref, {
          status: "archived",
          previousStatus: "confirmed",
          archivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        archivedReservations++;
      }
    }

    const total =
      archivedMatches +
      archivedAvailabilities +
      archivedReservations;

    if (total > 0) {
      await batch.commit();
    }

    return {
      ok: true,
      clubId,
      archivedMatches,
      archivedAvailabilities,
      archivedReservations,
      total,
    };
  });
}
