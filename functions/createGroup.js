// Path: functions/createGroup.js
// ======================================================
// Padima — Mes Groupes V1
// Callable createGroup
// ======================================================

import {
  GROUP_DEFAULT_SETTINGS,
  GROUP_INITIAL_HEALTH_COMPONENTS,
  GROUP_INITIAL_STATS,
  GROUP_SCHEMA_VERSION,
  GroupActivityType,
  GroupActivityVisibility,
  GroupType,
  GroupValidationError,
  buildOwnerMembership,
  calculateGroupHealth,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateCreateGroupInput,
} from "./domain/groups/index.js";

const ALLOWED_CREATED_BY_SOURCES = new Set([
  "ios",
  "android",
  "admin",
  "migration",
]);

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeCreatedBySource(value) {
  const source = asTrimmedString(value).toLowerCase();

  return ALLOWED_CREATED_BY_SOURCES.has(source)
    ? source
    : undefined;
}

function mapCreateGroupError(
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

  switch (error?.code) {
    case "USER_PROFILE_NOT_FOUND":
      return new HttpsError(
        "failed-precondition",
        "USER_PROFILE_NOT_FOUND"
      );

    case "CLUB_NOT_FOUND":
      return new HttpsError(
        "not-found",
        "CLUB_NOT_FOUND"
      );

    case "MEMBERSHIP_ALREADY_EXISTS":
      return new HttpsError(
        "already-exists",
        "MEMBERSHIP_ALREADY_EXISTS"
      );

    default:
      return new HttpsError(
        "internal",
        "CREATE_GROUP_INTERNAL"
      );
  }
}

export function buildCreateGroup({
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
        const validatedInput =
          validateCreateGroupInput(
            req.data ?? {}
          );

        const createdBySource =
          normalizeCreatedBySource(
            req.data?.createdBySource
          );

        const groupRef =
          db.collection("groups").doc();

        const groupId = groupRef.id;

        const membershipId =
          membershipDocumentId(
            groupId,
            uid
          );

        const userRef =
          db
            .collection("users")
            .doc(uid);

        const membershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(membershipId);

        const clubRef =
          validatedInput.type ===
          GroupType.CLUB_COMMUNITY
            ? db
                .collection("clubs")
                .doc(
                  validatedInput.defaultClubId
                )
            : null;

        const result =
          await db.runTransaction(
            async (transaction) => {
              const reads = [
                transaction.get(userRef),
                transaction.get(
                  membershipRef
                ),
              ];

              if (clubRef) {
                reads.push(
                  transaction.get(clubRef)
                );
              }

              const snapshots =
                await Promise.all(reads);

              const userSnapshot =
                snapshots[0];

              const membershipSnapshot =
                snapshots[1];

              const clubSnapshot =
                clubRef
                  ? snapshots[2]
                  : null;

              if (!userSnapshot.exists) {
                const error =
                  new Error(
                    "USER_PROFILE_NOT_FOUND"
                  );

                error.code =
                  "USER_PROFILE_NOT_FOUND";

                throw error;
              }

              if (
                membershipSnapshot.exists
              ) {
                const error =
                  new Error(
                    "MEMBERSHIP_ALREADY_EXISTS"
                  );

                error.code =
                  "MEMBERSHIP_ALREADY_EXISTS";

                throw error;
              }

              if (
                clubRef &&
                (
                  !clubSnapshot ||
                  !clubSnapshot.exists
                )
              ) {
                const error =
                  new Error(
                    "CLUB_NOT_FOUND"
                  );

                error.code =
                  "CLUB_NOT_FOUND";

                throw error;
              }

              const now =
                FieldValue
                  .serverTimestamp();

              const user =
                userSnapshot.data() ?? {};

              const club =
                clubSnapshot?.data?.() ??
                {};

              const
                defaultClubNameSnapshot =
                  validatedInput
                    .defaultClubNameSnapshot ||
                  asTrimmedString(
                    club.name
                  ) ||
                  undefined;

              const health =
                calculateGroupHealth({
                  components: {
                    ...GROUP_INITIAL_HEALTH_COMPONENTS,
                  },
                  calculatedAt: now,
                  hasEnoughData: false,
                });

              const group = {
                groupId,
                ...validatedInput,
                ownerUid: uid,

                settings: {
                  ...GROUP_DEFAULT_SETTINGS,
                },

                stats: {
                  ...GROUP_INITIAL_STATS,
                },

                health,
                schemaVersion:
                  GROUP_SCHEMA_VERSION,

                linkJoinEnabled:
                  validatedInput
                    .joinPolicy ===
                  "link_only",

                inviteCodeVersion: 1,

                ...(createdBySource
                  ? {
                      createdBySource,
                    }
                  : {}),

                ...(defaultClubNameSnapshot
                  ? {
                      defaultClubNameSnapshot,
                    }
                  : {}),

                createdAt: now,
                updatedAt: now,
              };

              const ownerMembership =
                buildOwnerMembership({
                  groupId,
                  userId: uid,
                  now,
                  user,
                });

              transaction.create(
                groupRef,
                group
              );

              transaction.create(
                membershipRef,
                ownerMembership
              );

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .GROUP_CREATED,
                    actorUid: uid,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,
                    actorPseudoSnapshot:
                      asTrimmedString(
                        user.pseudo
                      ) || "Joueur",

                    ...(asTrimmedString(
                      user.avatar ??
                        user.photoUrl
                    )
                      ? {
                          actorAvatarSnapshot:
                            asTrimmedString(
                              user.avatar ??
                                user.photoUrl
                            ),
                        }
                      : {}),

                    metadata: {
                      groupType:
                        group.type,
                      discoverability:
                        group
                          .discoverability,
                      joinPolicy:
                        group.joinPolicy,
                      createdBySource:
                        createdBySource ??
                        "unknown",
                    },

                    deduplicationKey:
                      `group_created:${groupId}`,
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
          "createGroup ok",
          {
            uid,
            groupId: result.groupId,
            membershipId:
              result.membershipId,
          }
        );

        return {
          ok: true,
          groupId: result.groupId,
          membershipId:
            result.membershipId,
        };
      } catch (error) {
        logger?.error?.(
          "createGroup failed",
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

        throw mapCreateGroupError(
          error,
          HttpsError
        );
      }
    }
  );
}

