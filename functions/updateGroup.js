// Path: functions/updateGroup.js
// ======================================================
// Padima — Mes Groupes V1
// Callable updateGroup
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupPermissionError,
  GroupType,
  GroupValidationError,
  assertAdminOrOwner,
  assertGroupActive,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateGroupId,
  validateUpdateGroupInput,
} from "./domain/groups/index.js";

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function mapUpdateGroupError(
  error,
  HttpsError
) {
  if (error instanceof HttpsError) {
    return error;
  }

  if (
    error instanceof GroupValidationError
  ) {
    return new HttpsError(
      "invalid-argument",
      error.code,
      {
        field: error.field,
        code: error.code,
      }
    );
  }

  if (
    error instanceof GroupPermissionError
  ) {
    switch (error.code) {
      case "GROUP_NOT_ACTIVE":
        return new HttpsError(
          "failed-precondition",
          "GROUP_NOT_ACTIVE"
        );

      case "ADMIN_REQUIRED":
      case "OWNER_REQUIRED":
      case "ACTIVE_MEMBERSHIP_REQUIRED":
        return new HttpsError(
          "permission-denied",
          error.code
        );

      default:
        return new HttpsError(
          "permission-denied",
          "GROUP_PERMISSION_DENIED"
        );
    }
  }

  switch (error?.code) {
    case "GROUP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "GROUP_NOT_FOUND"
      );

    case "MEMBERSHIP_NOT_FOUND":
      return new HttpsError(
        "permission-denied",
        "MEMBERSHIP_NOT_FOUND"
      );

    case "CLUB_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "CLUB_NOT_FOUND"
      );

    default:
      return new HttpsError(
        "internal",
        "UPDATE_GROUP_INTERNAL"
      );
  }
}

export function buildUpdateGroup({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
}) {
  if (typeof onCall !== "function") {
    throw new TypeError(
      "ON_CALL_REQUIRED"
    );
  }

  if (
    typeof HttpsError !== "function"
  ) {
    throw new TypeError(
      "HTTPS_ERROR_REQUIRED"
    );
  }

  if (!db) {
    throw new TypeError(
      "DB_REQUIRED"
    );
  }

  if (
    !FieldValue?.serverTimestamp
  ) {
    throw new TypeError(
      "FIELD_VALUE_REQUIRED"
    );
  }

  const recordGroupActivity =
    createGroupActivityRecorder({
      db,
      logger,
    });

  return onCall(
    runtime,
    async (req) => {
      const uid = req.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "UNAUTHENTICATED"
        );
      }

      try {
        const groupId =
          validateGroupId(
            req.data?.groupId
          );

        const groupRef =
          db
            .collection("groups")
            .doc(groupId);

        const membershipId =
          membershipDocumentId(
            groupId,
            uid
          );

        const membershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(membershipId);

        const userRef =
          db
            .collection("users")
            .doc(uid);

        const result =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                membershipSnapshot,
                userSnapshot,
              ] = await Promise.all([
                transaction.get(groupRef),
                transaction.get(
                  membershipRef
                ),
                transaction.get(userRef),
              ]);

              if (!groupSnapshot.exists) {
                const error =
                  new Error(
                    "GROUP_NOT_FOUND"
                  );

                error.code =
                  "GROUP_NOT_FOUND";

                throw error;
              }

              if (
                !membershipSnapshot.exists
              ) {
                const error =
                  new Error(
                    "MEMBERSHIP_NOT_FOUND"
                  );

                error.code =
                  "MEMBERSHIP_NOT_FOUND";

                throw error;
              }

              const currentGroup =
                groupSnapshot.data() ?? {};

              const membership =
                membershipSnapshot.data() ??
                {};

              const user =
                userSnapshot.exists
                  ? userSnapshot.data() ?? {}
                  : {};

              const actorAvatar =
                asTrimmedString(
                  user.avatar
                ) ||
                asTrimmedString(
                  user.photoUrl
                );

              assertGroupActive(
                currentGroup
              );

              assertAdminOrOwner(
                membership
              );

              const updates =
                validateUpdateGroupInput(
                  req.data ?? {},
                  currentGroup
                );

              let clubSnapshot = null;

              const finalType =
                updates.type ??
                currentGroup.type;

              const finalDefaultClubId =
                updates.defaultClubId ===
                null
                  ? undefined
                  : (
                      updates
                        .defaultClubId ??
                      currentGroup
                        .defaultClubId
                    );

              if (
                finalType ===
                  GroupType
                    .CLUB_COMMUNITY &&
                finalDefaultClubId
              ) {
                const clubRef =
                  db
                    .collection("clubs")
                    .doc(
                      finalDefaultClubId
                    );

                clubSnapshot =
                  await transaction.get(
                    clubRef
                  );

                if (
                  !clubSnapshot.exists
                ) {
                  const error =
                    new Error(
                      "CLUB_NOT_FOUND"
                    );

                  error.code =
                    "CLUB_NOT_FOUND";

                  throw error;
                }
              }

              const now =
                FieldValue
                  .serverTimestamp();

              const club =
                clubSnapshot?.data?.() ??
                {};

              if (
                finalType ===
                  GroupType
                    .CLUB_COMMUNITY &&
                finalDefaultClubId &&
                !updates
                  .defaultClubNameSnapshot
              ) {
                const clubName =
                  asTrimmedString(
                    club.name
                  );

                if (clubName) {
                  updates
                    .defaultClubNameSnapshot =
                    clubName;
                }
              }

              const explicitlyClearsClub =
                updates.defaultClubId ===
                null;

              const leavesClubCommunity =
                currentGroup.type ===
                  GroupType
                    .CLUB_COMMUNITY &&
                finalType !==
                  GroupType
                    .CLUB_COMMUNITY;

              if (
                explicitlyClearsClub ||
                leavesClubCommunity
              ) {
                updates.defaultClubId =
                  FieldValue.delete();

                updates
                  .defaultClubNameSnapshot =
                  FieldValue.delete();
              }

              if (
                updates.latitude === null &&
                updates.longitude === null
              ) {
                updates.latitude =
                  FieldValue.delete();

                updates.longitude =
                  FieldValue.delete();
              }

              if (
                Object.prototype
                  .hasOwnProperty.call(
                    updates,
                    "joinPolicy"
                  )
              ) {
                updates
                  .linkJoinEnabled =
                  updates.joinPolicy ===
                  "link_only";
              }

              updates.updatedAt = now;

              transaction.update(
                groupRef,
                updates
              );

              const changedFields =
                Object.keys(updates)
                  .filter(
                    (field) =>
                      field !==
                      "updatedAt"
                  )
                  .sort();

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .GROUP_UPDATED,
                    actorUid: uid,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,
                    actorPseudoSnapshot:
                      asTrimmedString(
                        user.pseudo
                      ) || "Joueur",

                    ...(actorAvatar
                      ? {
                          actorAvatarSnapshot:
                            actorAvatar,
                        }
                      : {}),

                    metadata: {
                      changedFields,
                    },

                    deduplicationKey:
                      `group_updated:${groupId}:${Date.now()}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                groupId,
                activityId,
                changedFields,
              };
            }
          );

        logger?.info?.(
          "updateGroup ok",
          {
            uid,
            groupId: result.groupId,
            changedFields:
              result.changedFields,
          }
        );

        return {
          ok: true,
          groupId: result.groupId,
          changedFields:
            result.changedFields,
        };
      } catch (error) {
        logger?.error?.(
          "updateGroup failed",
          {
            uid,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            field: error?.field,
            message: String(
              error?.message ??
                error
            ),
          }
        );

        throw mapUpdateGroupError(
          error,
          HttpsError
        );
      }
    }
  );
}

