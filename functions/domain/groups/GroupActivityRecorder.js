import {
  GroupActivityType,
  GroupActivityVisibility,
  isEnumValue,
} from "./GroupEnums.js";
import { GROUP_ACTIVITY_SCHEMA_VERSION } from "./GroupConstants.js";
import { validateGroupId, validateUserId } from "./GroupValidator.js";

export class GroupActivityError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GroupActivityError";
    this.code = code;
  }
}

function sanitizeMetadata(metadata) {
  if (metadata === undefined) return undefined;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new GroupActivityError("INVALID_ACTIVITY_METADATA");
  }
  return metadata;
}

export function buildGroupActivity({
  groupId,
  type,
  actorUid,
  visibility = GroupActivityVisibility.MEMBERS,
  createdAt,
  targetUserId,
  matchId,
  inviteId,
  joinRequestId,
  messageId,
  actorPseudoSnapshot,
  actorAvatarSnapshot,
  targetPseudoSnapshot,
  matchPlaceNameSnapshot,
  matchDateSnapshot,
  metadata,
  deduplicationKey,
}) {
  if (!isEnumValue(GroupActivityType, type)) {
    throw new GroupActivityError("INVALID_ACTIVITY_TYPE");
  }
  if (!isEnumValue(GroupActivityVisibility, visibility)) {
    throw new GroupActivityError("INVALID_ACTIVITY_VISIBILITY");
  }
  if (!createdAt) {
    throw new GroupActivityError("ACTIVITY_TIMESTAMP_REQUIRED");
  }

  const validatedActor =
    actorUid === "system" ? "system" : validateUserId(actorUid, "actorUid");

  return {
    groupId: validateGroupId(groupId),
    type,
    actorUid: validatedActor,
    visibility,
    schemaVersion: GROUP_ACTIVITY_SCHEMA_VERSION,
    createdAt,
    ...(targetUserId ? { targetUserId: validateUserId(targetUserId, "targetUserId") } : {}),
    ...(matchId ? { matchId } : {}),
    ...(inviteId ? { inviteId } : {}),
    ...(joinRequestId ? { joinRequestId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(actorPseudoSnapshot ? { actorPseudoSnapshot } : {}),
    ...(actorAvatarSnapshot ? { actorAvatarSnapshot } : {}),
    ...(targetPseudoSnapshot ? { targetPseudoSnapshot } : {}),
    ...(matchPlaceNameSnapshot ? { matchPlaceNameSnapshot } : {}),
    ...(matchDateSnapshot ? { matchDateSnapshot } : {}),
    ...(sanitizeMetadata(metadata) ? { metadata: sanitizeMetadata(metadata) } : {}),
    ...(deduplicationKey ? { deduplicationKey } : {}),
  };
}

export function createGroupActivityRecorder({ db, logger }) {
  if (!db) throw new GroupActivityError("DB_REQUIRED");

  return async function recordGroupActivity(payload, { transaction } = {}) {
    const activity = buildGroupActivity(payload);
    const ref = db.collection("groupActivities").doc();

    if (transaction) {
      transaction.create(ref, { activityId: ref.id, ...activity });
    } else {
      await ref.create({ activityId: ref.id, ...activity });
    }

    logger?.info?.("group activity recorded", {
      activityId: ref.id,
      groupId: activity.groupId,
      type: activity.type,
    });

    return ref.id;
  };
}
