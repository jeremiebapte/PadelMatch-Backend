/**
 * Padima — Match Views V1
 *
 * Stats:
 *   matchViews/{matchId}
 *
 * Viewers:
 *   matchViews/{matchId}/users/{uid}
 *
 * Important:
 * - aucune écriture sur matches/{matchId} lors d'une vue;
 * - le créateur n'est pas compté;
 * - une vue unique par utilisateur;
 * - toutes les ouvertures restent comptabilisées;
 * - liste nominative réservée au créateur du match.
 */

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function creatorUidOf(match) {
  if (!match || typeof match !== "object") {
    return "";
  }

  const candidates = [
    match.createurUid,
    match.creatorUid,
    match.createdByType === "player"
      ? match.createdById
      : null,
  ];

  for (const value of candidates) {
    const uid = cleanString(value);

    if (uid) {
      return uid;
    }
  }

  return "";
}

function normalizePositiveInteger(value) {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
  ) {
    return 0;
  }

  return Math.floor(value);
}

function timestampMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  if (
    typeof value === "number"
    && Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  return 0;
}

function publicViewerProfile({
  uid,
  user,
  view,
  hasJoinedMatch,
}) {
  const pseudo =
    cleanString(user?.pseudo)
    || cleanString(user?.displayName)
    || "Joueur Padima";

  const avatarUrl =
    cleanString(user?.photoUrl)
    || cleanString(user?.avatar)
    || cleanString(user?.avatarUrl)
    || "";

  const levelRaw =
    user?.niveau ?? user?.level ?? null;

  const level =
    typeof levelRaw === "number"
      && Number.isFinite(levelRaw)
      ? levelRaw
      : null;

  return {
    uid,
    pseudo,
    avatarUrl,
    level,
    firstViewedAt: view?.firstViewedAt ?? null,
    lastViewedAt: view?.lastViewedAt ?? null,
    viewCount: normalizePositiveInteger(
      view?.viewCount
    ),
    hasJoinedMatch: Boolean(hasJoinedMatch),
  };
}

export function buildRecordMatchView({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid = request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Authentification requise."
        );
      }

      const matchId =
        cleanString(request.data?.matchId);

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "matchId est requis."
        );
      }

      const matchRef =
        db.collection("matches").doc(matchId);

      const statsRef =
        db.collection("matchViews").doc(matchId);

      const viewerRef =
        statsRef.collection("users").doc(uid);

      const result = await db.runTransaction(
        async (transaction) => {
          /*
           * Toutes les lectures sont faites avant
           * la première écriture de transaction.
           */
          const matchSnap =
            await transaction.get(matchRef);

          const statsSnap =
            await transaction.get(statsRef);

          const viewerSnap =
            await transaction.get(viewerRef);

          if (!matchSnap.exists) {
            throw new HttpsError(
              "not-found",
              "Match introuvable."
            );
          }

          const match =
            matchSnap.data() ?? {};

          const creatorUid =
            creatorUidOf(match);

          const stats =
            statsSnap.exists
              ? statsSnap.data() ?? {}
              : {};

          if (
            creatorUid
            && creatorUid === uid
          ) {
            return {
              recorded: false,
              isCreator: true,
              isUnique: false,
              uniqueViewCount:
                normalizePositiveInteger(
                  stats.uniqueViewCount
                ),
              totalViewCount:
                normalizePositiveInteger(
                  stats.totalViewCount
                ),
            };
          }

          const isUnique =
            !viewerSnap.exists;

          const previousViewCount =
            normalizePositiveInteger(
              viewerSnap.data()?.viewCount
            );

          const uniqueViewCount =
            normalizePositiveInteger(
              stats.uniqueViewCount
            ) + (isUnique ? 1 : 0);

          const totalViewCount =
            normalizePositiveInteger(
              stats.totalViewCount
            ) + 1;

          const now =
            FieldValue.serverTimestamp();

          if (isUnique) {
            transaction.set(
              viewerRef,
              {
                uid,
                firstViewedAt: now,
                lastViewedAt: now,
                viewCount: 1,
              }
            );
          } else {
            transaction.update(
              viewerRef,
              {
                lastViewedAt: now,
                viewCount:
                  previousViewCount + 1,
              }
            );
          }

          transaction.set(
            statsRef,
            {
              matchId,
              uniqueViewCount,
              totalViewCount,
              updatedAt: now,
            },
            { merge: true }
          );

          return {
            recorded: true,
            isCreator: false,
            isUnique,
            uniqueViewCount,
            totalViewCount,
          };
        }
      );

      return {
        ok: true,
        matchId,
        ...result,
      };
    }
  );
}

export function buildGetMatchViewers({
  onCall,
  HttpsError,
  runtime,
  db,
}) {
  return onCall(
    runtime,
    async (request) => {
      const uid = request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Authentification requise."
        );
      }

      const matchId =
        cleanString(request.data?.matchId);

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "matchId est requis."
        );
      }

      const requestedLimit =
        Number(request.data?.limit);

      const limit = Math.max(
        1,
        Math.min(
          Number.isFinite(requestedLimit)
            ? Math.floor(requestedLimit)
            : 50,
          100
        )
      );

      const matchRef =
        db.collection("matches").doc(matchId);

      const statsRef =
        db.collection("matchViews").doc(matchId);

      const [
        matchSnap,
        statsSnap,
      ] = await Promise.all([
        matchRef.get(),
        statsRef.get(),
      ]);

      if (!matchSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Match introuvable."
        );
      }

      const match =
        matchSnap.data() ?? {};

      const stats =
        statsSnap.exists
          ? statsSnap.data() ?? {}
          : {};

      const creatorUid =
        creatorUidOf(match);

      if (
        !creatorUid
        || creatorUid !== uid
      ) {
        throw new HttpsError(
          "permission-denied",
          "Seul le créateur du match peut voir les viewers."
        );
      }

      const participants =
        Array.isArray(match.participants)
          ? match.participants.filter(
              (value) =>
                typeof value === "string"
            )
          : [];

      const participantUids =
        new Set(
          participants.filter(
            (value) =>
              !value.startsWith("ami_de_")
          )
        );

      const viewsSnap =
        await statsRef
          .collection("users")
          .orderBy("lastViewedAt", "desc")
          .limit(limit)
          .get();

      const rows =
        viewsSnap.docs.map((doc) => ({
          uid: doc.id,
          ...doc.data(),
        }));

      if (rows.length === 0) {
        return {
          ok: true,
          matchId,
          uniqueViewCount:
            normalizePositiveInteger(
              stats.uniqueViewCount
            ),
          totalViewCount:
            normalizePositiveInteger(
              stats.totalViewCount
            ),
          viewers: [],
        };
      }

      const userRefs =
        rows.map((row) =>
          db.collection("users").doc(row.uid)
        );

      const userSnaps =
        await db.getAll(...userRefs);

      const usersByUid =
        new Map();

      for (const userSnap of userSnaps) {
        usersByUid.set(
          userSnap.id,
          userSnap.exists
            ? userSnap.data() ?? {}
            : {}
        );
      }

      const viewers =
        rows
          .map((row) =>
            publicViewerProfile({
              uid: row.uid,
              user:
                usersByUid.get(row.uid)
                ?? {},
              view: row,
              hasJoinedMatch:
                participantUids.has(row.uid),
            })
          )
          .sort(
            (left, right) =>
              timestampMillis(
                right.lastViewedAt
              )
              - timestampMillis(
                left.lastViewedAt
              )
          );

      return {
        ok: true,
        matchId,
        uniqueViewCount:
          normalizePositiveInteger(
            stats.uniqueViewCount
          ),
        totalViewCount:
          normalizePositiveInteger(
            stats.totalViewCount
          ),
        viewers,
      };
    }
  );
}
