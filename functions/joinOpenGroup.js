// Path: functions/joinOpenGroup.js
//
// Callable joinOpenGroup
// Adhésion immédiate à un groupe réellement ouvert.

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupJoinPolicy,
  GroupMembershipSource,
  GroupMembershipStatus,
  GroupStatus,
} from "./domain/groups/GroupEnums.js";

import {
  buildActiveMembership,
  membershipDocumentId,
} from "./domain/groups/GroupMembershipService.js";

import {
  createGroupActivityRecorder,
} from "./domain/groups/GroupActivityRecorder.js";


function asTrimmedString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}


function codedError(code, metadata = {}) {
  const error = new Error(code);

  error.code = code;

  Object.assign(
    error,
    metadata
  );

  return error;
}


function mapJoinOpenGroupError(
  error,
  HttpsError
) {
  const code =
    error?.code ??
    error?.message ??
    "UNKNOWN_ERROR";

  switch (code) {
    case "GROUP_ID_REQUIRED":
      return new HttpsError(
        "invalid-argument",
        "GROUP_ID_REQUIRED"
      );

    case "GROUP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "GROUP_NOT_FOUND"
      );

    case "USER_PROFILE_NOT_FOUND":
      return new HttpsError(
        "failed-precondition",
        "USER_PROFILE_NOT_FOUND"
      );

    case "GROUP_NOT_ACTIVE":
      return new HttpsError(
        "failed-precondition",
        "GROUP_NOT_ACTIVE"
      );

    case "GROUP_NOT_OPEN":
      return new HttpsError(
        "failed-precondition",
        "GROUP_NOT_OPEN"
      );

    case "ALREADY_GROUP_MEMBER":
      return new HttpsError(
        "already-exists",
        "ALREADY_GROUP_MEMBER"
      );

    case "BANNED_FROM_GROUP":
      return new HttpsError(
        "permission-denied",
        "BANNED_FROM_GROUP"
      );

    default:
      return new HttpsError(
        "internal",
        "JOIN_OPEN_GROUP_FAILED"
      );
  }
}


export function buildJoinOpenGroup({
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

  if (typeof HttpsError !== "function") {
    throw new TypeError(
      "HTTPS_ERROR_REQUIRED"
    );
  }

  if (!db?.collection) {
    throw new TypeError(
      "FIRESTORE_REQUIRED"
    );
  }

  if (!FieldValue?.increment) {
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
      const uid =
        req.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "UNAUTHENTICATED"
        );
      }

      try {
        const groupId =
          asTrimmedString(
            req.data?.groupId
          );

        if (!groupId) {
          throw codedError(
            "GROUP_ID_REQUIRED"
          );
        }

        const groupRef =
          db
            .collection("groups")
            .doc(groupId);

        const userRef =
          db
            .collection("users")
            .doc(uid);

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

        const result =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                userSnapshot,
                membershipSnapshot,
              ] = await Promise.all([
                transaction.get(
                  groupRef
                ),
                transaction.get(
                  userRef
                ),
                transaction.get(
                  membershipRef
                ),
              ]);

              if (
                !groupSnapshot.exists
              ) {
                throw codedError(
                  "GROUP_NOT_FOUND"
                );
              }

              if (
                !userSnapshot.exists
              ) {
                throw codedError(
                  "USER_PROFILE_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() ??
                {};

              if (
                group.status !==
                GroupStatus.ACTIVE
              ) {
                throw codedError(
                  "GROUP_NOT_ACTIVE"
                );
              }

              /*
               * Important:
               * searchable détermine si le groupe apparaît
               * dans Explorer.
               *
               * Le droit d'adhésion immédiate dépend,
               * lui, uniquement de joinPolicy=open.
               */
              if (
                group.joinPolicy !==
                GroupJoinPolicy.OPEN
              ) {
                throw codedError(
                  "GROUP_NOT_OPEN"
                );
              }

              const previousMembership =
                membershipSnapshot.exists
                  ? membershipSnapshot.data() ??
                    {}
                  : null;

              if (
                previousMembership?.status ===
                GroupMembershipStatus.ACTIVE
              ) {
                throw codedError(
                  "ALREADY_GROUP_MEMBER",
                  {
                    membershipId,
                  }
                );
              }

              if (
                previousMembership?.status ===
                GroupMembershipStatus.BANNED
              ) {
                throw codedError(
                  "BANNED_FROM_GROUP"
                );
              }

              const now =
                new Date();

              const user =
                userSnapshot.data() ??
                {};

              const membership =
                buildActiveMembership({
                  groupId,
                  userId: uid,
                  role: "member",
                  source:
                    GroupMembershipSource
                      .OPEN_JOIN,
                  now,
                  user,
                });

              transaction.set(
                membershipRef,
                membership
              );

              transaction.update(
                groupRef,
                {
                  "stats.memberCount":
                    FieldValue.increment(1),
                  updatedAt: now,
                }
              );

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .MEMBER_JOINED,
                    actorUid: uid,
                    targetUserId: uid,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,

                    actorPseudoSnapshot:
                      membership
                        .userPseudoSnapshot ??
                      "Joueur",

                    ...(membership
                      .userAvatarSnapshot
                      ? {
                          actorAvatarSnapshot:
                            membership
                              .userAvatarSnapshot,
                        }
                      : {}),

                    targetPseudoSnapshot:
                      membership
                        .userPseudoSnapshot ??
                      "Joueur",

                    metadata: {
                      membershipId,
                      source:
                        GroupMembershipSource
                          .OPEN_JOIN,
                    },

                    deduplicationKey:
                      `member_joined:open:${groupId}:${uid}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                groupId,
                membershipId,
                activityId,
              };
            }
          );

        logger?.info?.(
          "joinOpenGroup ok",
          {
            uid,
            groupId:
              result.groupId,
            membershipId:
              result.membershipId,
          }
        );

        return {
          ok: true,
          groupId:
            result.groupId,
          membershipId:
            result.membershipId,
        };
      } catch (error) {
        logger?.error?.(
          "joinOpenGroup failed",
          {
            uid,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            message:
              String(
                error?.message ??
                error
              ),
          }
        );

        throw mapJoinOpenGroupError(
          error,
          HttpsError
        );
      }
    }
  );
}
