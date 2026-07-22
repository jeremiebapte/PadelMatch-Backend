function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value) {
  const result = trim(value);
  return result || undefined;
}

function optionalLevel(user) {
  const raw = user?.level ?? user?.niveau;
  return Number.isInteger(raw) ? raw : undefined;
}

export function buildUserSnapshot(user, uid) {
  return {
    userId: uid,
    pseudo: trim(user?.pseudo) || "Joueur",
    ...(optionalString(user?.avatar ?? user?.photoUrl)
      ? { avatar: optionalString(user?.avatar ?? user?.photoUrl) }
      : {}),
    ...(optionalLevel(user) !== undefined ? { level: optionalLevel(user) } : {}),
  };
}

export function buildMembershipUserSnapshot(user, uid) {
  const snapshot = buildUserSnapshot(user, uid);
  return {
    userPseudoSnapshot: snapshot.pseudo,
    ...(snapshot.avatar ? { userAvatarSnapshot: snapshot.avatar } : {}),
    ...(snapshot.level !== undefined ? { userLevelSnapshot: snapshot.level } : {}),
  };
}

export function buildGroupSnapshot(group) {
  return {
    name: trim(group?.name),
    ...(optionalString(group?.imageUrl) ? { imageUrl: optionalString(group.imageUrl) } : {}),
    ...(optionalString(group?.city) ? { city: optionalString(group.city) } : {}),
    ...(Number.isInteger(group?.levelMin) ? { levelMin: group.levelMin } : {}),
    ...(Number.isInteger(group?.levelMax) ? { levelMax: group.levelMax } : {}),
  };
}

export function buildInviteSnapshots(group, inviterUser) {
  return {
    groupNameSnapshot: trim(group?.name),
    ...(optionalString(group?.imageUrl)
      ? { groupImageUrlSnapshot: optionalString(group.imageUrl) }
      : {}),
    inviterPseudoSnapshot: trim(inviterUser?.pseudo) || "Joueur",
    ...(optionalString(inviterUser?.avatar ?? inviterUser?.photoUrl)
      ? { inviterAvatarSnapshot: optionalString(inviterUser?.avatar ?? inviterUser?.photoUrl) }
      : {}),
  };
}
