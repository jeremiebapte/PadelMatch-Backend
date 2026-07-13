// Path: functions/clubActivity.js

const COLLECTION = "clubActivityEvents";

const VALID_ENTITY_TYPES = new Set([
  "match",
  "availability",
  "reservation",
]);

const VALID_DISPLAY_TYPES = new Set([
  "info",
  "success",
  "warning",
  "match",
  "availability",
  "reservation",
]);

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanNullableString(value) {
  const clean = cleanString(value);
  return clean || null;
}

function cleanMetadata(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  const result = {};

  for (const [key, item] of Object.entries(value)) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      result[key] = item;
    }
  }

  return result;
}

function timestampToMillis(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  if (typeof value === "number") {
    return value > 1_000_000_000_000
      ? value
      : value * 1000;
  }

  return null;
}

export function createClubActivityWriter({
  db,
  FieldValue,
  logger,
}) {
  if (!db) {
    throw new Error(
      "createClubActivityWriter: db missing"
    );
  }

  if (!FieldValue) {
    throw new Error(
      "createClubActivityWriter: FieldValue missing"
    );
  }

  return async function writeClubActivityEvent(input) {
    const clubId =
      cleanString(input?.clubId);

    const type =
      cleanString(input?.type)
        .toUpperCase();

    const entityType =
      cleanString(input?.entityType)
        .toLowerCase();

    const entityId =
      cleanString(input?.entityId);

    const title =
      cleanString(input?.title);

    const subtitle =
      cleanString(input?.subtitle);

    const displayTypeRaw =
      cleanString(input?.displayType)
        .toLowerCase();

    const displayType =
      VALID_DISPLAY_TYPES.has(displayTypeRaw)
        ? displayTypeRaw
        : "info";

    if (!clubId) {
      throw new Error(
        "writeClubActivityEvent: clubId missing"
      );
    }

    if (!type) {
      throw new Error(
        "writeClubActivityEvent: type missing"
      );
    }

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw new Error(
        `writeClubActivityEvent: invalid entityType ${entityType}`
      );
    }

    if (!entityId) {
      throw new Error(
        "writeClubActivityEvent: entityId missing"
      );
    }

    if (!title) {
      throw new Error(
        "writeClubActivityEvent: title missing"
      );
    }

    const payload = {
      clubId,
      type,
      displayType,

      entityType,
      entityId,

      title,

      actorUid:
        cleanNullableString(
          input?.actorUid
        ),

      actorName:
        cleanNullableString(
          input?.actorName
        ),

      actorAvatar:
        cleanNullableString(
          input?.actorAvatar
        ),

      subtitle:
        subtitle || null,

      metadata:
        cleanMetadata(
          input?.metadata
        ),

      schemaVersion: 1,

      createdAt:
        FieldValue.serverTimestamp(),

      updatedAt:
        FieldValue.serverTimestamp(),
    };

    try {
      const ref = await db
        .collection(COLLECTION)
        .add(payload);

      return {
        ok: true,
        eventId: ref.id,
      };
    } catch (error) {
      logger?.warn?.(
        "writeClubActivityEvent failed",
        {
          clubId,
          type,
          entityType,
          entityId,
          error:
            String(
              error?.message ?? error
            ),
        }
      );

      throw error;
    }
  };
}

export function buildGetClubActivityFeed({
  onCall,
  HttpsError,
  runtime,
  db,
}) {
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

      const user =
        userSnap.data() || {};

      const role =
        cleanString(user.role);

      const clubId =
        cleanString(user.clubId);

      if (role !== "club_admin") {
        throw new HttpsError(
          "permission-denied",
          "NOT_CLUB_ADMIN"
        );
      }

      if (!clubId) {
        throw new HttpsError(
          "failed-precondition",
          "CLUB_ID_MISSING"
        );
      }

      const requestedLimit =
        Number(req.data?.limit);

      const limit =
        Number.isFinite(requestedLimit)
          ? Math.max(
              1,
              Math.min(
                30,
                Math.trunc(requestedLimit)
              )
            )
          : 10;

      let snapshot;

      try {
        snapshot = await db
          .collection(COLLECTION)
          .where(
            "clubId",
            "==",
            clubId
          )
          .orderBy(
            "createdAt",
            "desc"
          )
          .limit(limit)
          .get();
      } catch (error) {
        /*
         * Ce fallback permet de démarrer sans bloquer
         * si l’index composite Firestore n’est pas encore créé.
         */
        snapshot = await db
          .collection(COLLECTION)
          .where(
            "clubId",
            "==",
            clubId
          )
          .limit(100)
          .get();
      }

      const events =
        snapshot.docs
          .map((doc) => {
            const data =
              doc.data() || {};

            return {
              id: doc.id,

              clubId:
                cleanString(
                  data.clubId
                ),

              type:
                cleanString(
                  data.type
                ),

              displayType:
                cleanString(
                  data.displayType
                ) || "info",

              entityType:
                cleanString(
                  data.entityType
                ),

              entityId:
                cleanString(
                  data.entityId
                ),

              actorUid:
                cleanNullableString(
                  data.actorUid
                ),

              actorName:
                cleanNullableString(
                  data.actorName
                ),

              actorAvatar:
                cleanNullableString(
                  data.actorAvatar
                ),

              title:
                cleanString(
                  data.title
                ),

              subtitle:
                cleanNullableString(
                  data.subtitle
                ),

              metadata:
                cleanMetadata(
                  data.metadata
                ),

              createdAt:
                timestampToMillis(
                  data.createdAt
                ),

              schemaVersion:
                Number.isFinite(
                  Number(
                    data.schemaVersion
                  )
                )
                  ? Number(
                      data.schemaVersion
                    )
                  : 1,
            };
          })
          .sort(
            (left, right) =>
              (right.createdAt || 0) -
              (left.createdAt || 0)
          )
          .slice(
            0,
            limit
          );

      return {
        ok: true,
        clubId,
        events,
      };
    }
  );
}
