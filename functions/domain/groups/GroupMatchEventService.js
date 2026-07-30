import {
  GroupActivityType,
  GroupActivityVisibility,
} from "./GroupEnums.js";

async function record({
  groupId,
  type,
  matchId,
  uid,
  actorProfile = {},
  match,
  recordGroupActivity,
  FieldValue,
  logger,
  metadata = {},
}) {
  if (!groupId || !recordGroupActivity) {
    return;
  }

  try {
    await recordGroupActivity({
      groupId,

      type,

      visibility:
        GroupActivityVisibility.MEMBERS,

      actorUid:
        uid ?? "system",

      createdAt:
        FieldValue.serverTimestamp(),

      matchId,

      ...(actorProfile.pseudo
        ? {
            actorPseudoSnapshot:
              actorProfile.pseudo,
          }
        : {}),

      ...(actorProfile.avatar
        ? {
            actorAvatarSnapshot:
              actorProfile.avatar,
          }
        : {}),

      ...(match?.lieu
        ? {
            matchPlaceNameSnapshot:
              match.lieu,
          }
        : {}),

      ...(match?.dateHeure
        ? {
            matchDateSnapshot:
              match.dateHeure,
          }
        : {}),

      metadata,

      deduplicationKey:
        `${type}:${matchId}:${uid ?? "system"}`,
    });
  } catch (error) {
    logger?.error?.(
      "GroupMatchEventService failed",
      {
        type,
        matchId,
        groupId,
        error:
          String(
            error?.message ?? error
          ),
      }
    );
  }
}



async function updateGroupMatchStats({
  groupId,
  db,
  FieldValue,
}) {
  if (!groupId || !db) {
    return;
  }

  await db
    .collection("groups")
    .doc(groupId)
    .update({
      "stats.upcomingMatchCount":
        FieldValue.increment(1),

      "stats.matchesCreated30d":
        FieldValue.increment(1),

      "stats.lastActivityAt":
        FieldValue.serverTimestamp(),

      updatedAt:
        FieldValue.serverTimestamp(),
    });
}

export async function recordMatchCreated(args) {
  await record({
    ...args,
    type:
      GroupActivityType.MATCH_CREATED,
  });

  try {
    await updateGroupMatchStats(args);
  } catch (error) {
    args.logger?.error?.(
      "updateGroupMatchStats failed",
      {
        groupId: args.groupId,
        matchId: args.matchId,
        error:
          String(
            error?.message ?? error
          ),
      }
    );
  }
}


export async function recordMatchUpdated(args) {
  return record({
    ...args,
    type:
      GroupActivityType.MATCH_UPDATED,
  });
}


export async function recordMatchDeleted(args) {
  return record({
    ...args,
    type:
      GroupActivityType.MATCH_DELETED,
  });
}


export async function recordMatchJoined(args) {
  return record({
    ...args,
    type:
      GroupActivityType.MATCH_JOINED,
  });
}


export async function recordMatchLeft(args) {
  return record({
    ...args,
    type:
      GroupActivityType.MATCH_LEFT,
  });
}


export async function recordMatchCompleted(args) {
  return record({
    ...args,
    uid: "system",
    type:
      GroupActivityType.MATCH_COMPLETED,
  });
}
