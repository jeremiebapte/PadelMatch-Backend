// Path: functions/syncGroupMembershipSnapshots.js
// ======================================================
// Padima Groups — Synchronisation des snapshots utilisateur
// ======================================================

import {
  buildMembershipUserSnapshot,
} from "./domain/groups/GroupSnapshotBuilder.js";

const MAX_BATCH_WRITES = 450;

function sameOptionalValue(first, second) {
  return (first ?? null) === (second ?? null);
}

function membershipSnapshotChanged(
  beforeUser,
  afterUser,
  userId
) {
  const beforeSnapshot =
    buildMembershipUserSnapshot(
      beforeUser,
      userId
    );

  const afterSnapshot =
    buildMembershipUserSnapshot(
      afterUser,
      userId
    );

  return (
    beforeSnapshot.userPseudoSnapshot !==
      afterSnapshot.userPseudoSnapshot ||
    !sameOptionalValue(
      beforeSnapshot.userAvatarSnapshot,
      afterSnapshot.userAvatarSnapshot
    ) ||
    !sameOptionalValue(
      beforeSnapshot.userLevelSnapshot,
      afterSnapshot.userLevelSnapshot
    )
  );
}

function buildMembershipPatch(
  user,
  userId,
  FieldValue
) {
  const snapshot =
    buildMembershipUserSnapshot(
      user,
      userId
    );

  return {
    userPseudoSnapshot:
      snapshot.userPseudoSnapshot,

    userAvatarSnapshot:
      snapshot.userAvatarSnapshot ??
      FieldValue.delete(),

    userLevelSnapshot:
      snapshot.userLevelSnapshot ??
      FieldValue.delete(),

    updatedAt:
      FieldValue.serverTimestamp(),
  };
}

function documentNeedsUpdate(
  membershipData,
  patch
) {
  const currentPseudo =
    typeof membershipData?.userPseudoSnapshot ===
    "string"
      ? membershipData.userPseudoSnapshot
      : "";

  if (
    currentPseudo !==
    patch.userPseudoSnapshot
  ) {
    return true;
  }

  const nextHasAvatar =
    typeof patch.userAvatarSnapshot ===
    "string";

  const currentHasAvatar =
    typeof membershipData?.userAvatarSnapshot ===
      "string" &&
    membershipData.userAvatarSnapshot.trim() !== "";

  if (nextHasAvatar) {
    if (
      membershipData?.userAvatarSnapshot !==
      patch.userAvatarSnapshot
    ) {
      return true;
    }
  } else if (currentHasAvatar) {
    return true;
  }

  const nextHasLevel =
    Number.isInteger(
      patch.userLevelSnapshot
    );

  const currentHasLevel =
    Number.isInteger(
      membershipData?.userLevelSnapshot
    );

  if (nextHasLevel) {
    if (
      membershipData?.userLevelSnapshot !==
      patch.userLevelSnapshot
    ) {
      return true;
    }
  } else if (currentHasLevel) {
    return true;
  }

  return false;
}

async function commitInChunks(
  db,
  documents,
  patch
) {
  let updatedCount = 0;

  for (
    let startIndex = 0;
    startIndex < documents.length;
    startIndex += MAX_BATCH_WRITES
  ) {
    const chunk = documents.slice(
      startIndex,
      startIndex + MAX_BATCH_WRITES
    );

    const batch = db.batch();

    for (const document of chunk) {
      batch.update(
        document.ref,
        patch
      );
    }

    await batch.commit();
    updatedCount += chunk.length;
  }

  return updatedCount;
}

export function buildSyncGroupMembershipSnapshots({
  onDocumentUpdated,
  db,
  FieldValue,
  logger,
  region = "europe-west1",
}) {
  if (
    typeof onDocumentUpdated !==
    "function"
  ) {
    throw new Error(
      "buildSyncGroupMembershipSnapshots: onDocumentUpdated missing"
    );
  }

  if (!db) {
    throw new Error(
      "buildSyncGroupMembershipSnapshots: db missing"
    );
  }

  if (!FieldValue) {
    throw new Error(
      "buildSyncGroupMembershipSnapshots: FieldValue missing"
    );
  }

  return onDocumentUpdated(
    {
      document: "users/{userId}",
      region,
    },
    async (event) => {
      const userId =
        typeof event.params?.userId ===
        "string"
          ? event.params.userId.trim()
          : "";

      if (!userId) {
        logger?.warn(
          "syncGroupMembershipSnapshots ignored: missing userId"
        );
        return;
      }

      const beforeData =
        event.data?.before?.data();

      const afterData =
        event.data?.after?.data();

      if (!beforeData || !afterData) {
        logger?.warn(
          "syncGroupMembershipSnapshots ignored: incomplete event",
          { userId }
        );
        return;
      }

      if (
        !membershipSnapshotChanged(
          beforeData,
          afterData,
          userId
        )
      ) {
        return;
      }

      const patch =
        buildMembershipPatch(
          afterData,
          userId,
          FieldValue
        );

      const membershipSnapshot =
        await db
          .collection(
            "groupMemberships"
          )
          .where(
            "userId",
            "==",
            userId
          )
          .get();

      if (membershipSnapshot.empty) {
        logger?.info(
          "syncGroupMembershipSnapshots completed: no memberships",
          { userId }
        );
        return;
      }

      const documentsToUpdate =
        membershipSnapshot.docs.filter(
          (document) =>
            documentNeedsUpdate(
              document.data(),
              patch
            )
        );

      if (!documentsToUpdate.length) {
        logger?.info(
          "syncGroupMembershipSnapshots completed: already aligned",
          {
            userId,
            membershipCount:
              membershipSnapshot.size,
          }
        );
        return;
      }

      const updatedCount =
        await commitInChunks(
          db,
          documentsToUpdate,
          patch
        );

      logger?.info(
        "syncGroupMembershipSnapshots completed",
        {
          userId,
          membershipCount:
            membershipSnapshot.size,
          updatedCount,
        }
      );
    }
  );
}
