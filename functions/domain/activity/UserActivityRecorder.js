// Path: functions/domain/activity/UserActivityRecorder.js

const USER_ACTIVITY_SCHEMA_VERSION = 1;

function cleanString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function optionalString(value) {
  const cleaned = cleanString(value);
  return cleaned || undefined;
}

function requiredString(value, field) {
  const cleaned = cleanString(value);

  if (!cleaned) {
    throw new Error(`USER_ACTIVITY_${field.toUpperCase()}_MISSING`);
  }

  return cleaned;
}

/**
 * Projection personnelle destinée au centre d'activité.
 *
 * Important :
 * - ce document n'est PAS une source métier ;
 * - les objets sources restent matches, groupInvites,
 *   groupActivities, clubActivityEvents, etc. ;
 * - cette projection sert au feed utilisateur, au badge non lu
 *   et au routing vers l'objet métier.
 */
export function createUserActivityRecorder({
  db,
  logger = console,
}) {
  if (!db) {
    throw new Error("createUserActivityRecorder: db missing");
  }

  return async function recordUserActivity(
    input,
    { transaction } = {}
  ) {
    const userId =
      requiredString(input?.userId, "userId");

    const type =
      requiredString(input?.type, "type");

    const entityType =
      requiredString(
        input?.entityType,
        "entityType"
      ).toLowerCase();

    const entityId =
      requiredString(input?.entityId, "entityId");

    const title =
      requiredString(input?.title, "title");

    const sourceType =
      requiredString(
        input?.sourceType,
        "sourceType"
      ).toLowerCase();

    const payload = {
      schemaVersion:
        USER_ACTIVITY_SCHEMA_VERSION,

      userId,
      type,
      entityType,
      entityId,

      title,
      sourceType,

      createdAt:
        input?.createdAt
        ?? new Date(),

      readAt: null,
    };

    const optionalFields = {
      subtitle:
        optionalString(input?.subtitle),

      groupId:
        optionalString(input?.groupId),

      matchId:
        optionalString(input?.matchId),

      clubId:
        optionalString(input?.clubId),

      availabilityId:
        optionalString(input?.availabilityId),

      reservationId:
        optionalString(input?.reservationId),

      inviteId:
        optionalString(input?.inviteId),

      actorUid:
        optionalString(input?.actorUid),

      actorPseudoSnapshot:
        optionalString(
          input?.actorPseudoSnapshot
        ),

      actorAvatarSnapshot:
        optionalString(
          input?.actorAvatarSnapshot
        ),

      sourceId:
        optionalString(input?.sourceId),
    };

    for (const [key, value] of
      Object.entries(optionalFields)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }

    if (
      input?.metadata
      && typeof input.metadata === "object"
      && !Array.isArray(input.metadata)
    ) {
      payload.metadata = input.metadata;
    }

    const ref =
      db.collection("userActivities").doc();

    try {
      if (transaction) {
        transaction.create(
          ref,
          payload
        );
      } else {
        await ref.set(payload);
      }

      return {
        id: ref.id,
        ...payload,
      };
    } catch (error) {
      logger.error(
        "recordUserActivity failed",
        {
          userId,
          type,
          entityType,
          entityId,
          error:
            error?.message
            ?? String(error),
        }
      );

      throw error;
    }
  };
}

export {
  USER_ACTIVITY_SCHEMA_VERSION,
};
