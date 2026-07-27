import {
  buildInviteSnapshots,
  buildUserSnapshot,
} from "./GroupSnapshotBuilder.js";

export function buildGroupInviteSnapshots({
  group,
  inviterUser,
  targetUser,
  targetUserId,
}) {
  const snapshots = buildInviteSnapshots(group, inviterUser);

  if (!targetUserId) {
    return snapshots;
  }

  const target = buildUserSnapshot(targetUser, targetUserId);

  return {
    ...snapshots,
    targetPseudoSnapshot: target.pseudo,
    ...(target.avatar
      ? { targetAvatarSnapshot: target.avatar }
      : {}),
    ...(target.level !== undefined
      ? { targetLevelSnapshot: target.level }
      : {}),
  };
}
