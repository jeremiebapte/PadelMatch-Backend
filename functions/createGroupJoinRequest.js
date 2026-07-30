// Path: functions/createGroupJoinRequest.js
// ======================================================
// Padima — Groups
// Callable createGroupJoinRequest
// Création d’une demande d’adhésion à approuver
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupJoinRequestError,
  GroupJoinRequestValidationError,
  GroupRole,
  GroupValidationError,
  assertRequestCanBeCreated,
  buildPendingGroupJoinRequest,
  createGroupActivityRecorder,
  deterministicJoinRequestId,
  membershipDocumentId,
  validateCreateGroupJoinRequestInput,
} from "./domain/groups/index.js";

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function codedError(
  code,
  extra = {}
) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function mapCreateGroupJoinRequestError(
  error,
  HttpsError
) {
  if (error instanceof HttpsError) {
    return error;
  }

  if (
    error instanceof
      GroupJoinRequestValidationError ||
    error instanceof
      GroupValidationError
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
    error instanceof
      GroupJoinRequestError
  ) {
    switch (error.code) {
      case "ALREADY_GROUP_MEMBER":
      case "JOIN_REQUEST_ALREADY_PENDING":
        return new HttpsError(
          "already-exists",
          error.code,
          {
            requestId:
              error.requestId ?? null,
          }
        );

      case "USER_BANNED_FROM_GROUP":
        return new HttpsError(
          "permission-denied",
          error.code
        );

      case "GROUP_NOT_ACTIVE":
      case "GROUP_DOES_NOT_REQUIRE_APPROVAL":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      default:
        return new HttpsError(
          "failed-precondition",
          error.code ??
            "CREATE_GROUP_JOIN_REQUEST_FAILED"
        );
    }
  }

  switch (error?.code) {
    case "GROUP_NOT_FOUND":
    case "REQUESTER_PROFILE_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    default:
      return new HttpsError(
        "internal",
        "CREATE_GROUP_JOIN_REQUEST_INTERNAL"
      );
  }
}

export function buildCreateGroupJoinRequest({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
  tokensOf,
  sendVisibleHybrid,
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
    !FieldValue ||
    typeof FieldValue.increment !==
      "function"
  ) {
    throw new TypeError(
      "FIELD_VALUE_REQUIRED"
    );
  }

  if (typeof tokensOf !== "function") {
    throw new TypeError(
      "TOKENS_OF_REQUIRED"
    );
  }

  if (
    typeof sendVisibleHybrid !==
    "function"
  ) {
    throw new TypeError(
      "SEND_VISIBLE_HYBRID_REQUIRED"
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
        const input =
          validateCreateGroupJoinRequestInput(
            req.data ?? {}
          );

        const {
          groupId,
        } = input;

        const requestId =
          deterministicJoinRequestId({
            groupId,
            requesterUid: uid,
          });

        const membershipId =
          membershipDocumentId(
            groupId,
            uid
          );

        const groupRef =
          db
            .collection("groups")
            .doc(groupId);

        const requesterRef =
          db
            .collection("users")
            .doc(uid);

        const membershipRef =
          db
            .collection(
              "groupMemberships"
            )
            .doc(membershipId);

        const requestRef =
          db
            .collection(
              "groupJoinRequests"
            )
            .doc(requestId);

        const managersQuery =
          db
            .collection(
              "groupMemberships"
            )
            .where(
              "groupId",
              "==",
              groupId
            )
            .where(
              "status",
              "==",
              "active"
            );

        const result =
          await db.runTransaction(
            async (transaction) => {
              const [
                groupSnapshot,
                requesterSnapshot,
                membershipSnapshot,
                requestSnapshot,
                managersSnapshot,
              ] = await Promise.all([
                transaction.get(
                  groupRef
                ),
                transaction.get(
                  requesterRef
                ),
                transaction.get(
                  membershipRef
                ),
                transaction.get(
                  requestRef
                ),
                transaction.get(
                  managersQuery
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
                !requesterSnapshot.exists
              ) {
                throw codedError(
                  "REQUESTER_PROFILE_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() ?? {};

              const requester =
                requesterSnapshot.data() ?? {};

              const existingMembership =
                membershipSnapshot.exists
                  ? membershipSnapshot.data()
                  : null;

              const existingRequest =
                requestSnapshot.exists
                  ? requestSnapshot.data()
                  : null;

              try {
                assertRequestCanBeCreated({
                  group,
                  existingMembership,
                  existingRequest,
                });
              } catch (error) {
                if (
                  error?.code ===
                  "JOIN_REQUEST_ALREADY_PENDING"
                ) {
                  error.requestId =
                    requestId;
                }

                throw error;
              }

              const now = new Date();

              const joinRequest =
                buildPendingGroupJoinRequest({
                  requestId,
                  groupId,
                  requesterUid: uid,
                  group,
                  requesterUser:
                    requester,
                  now,
                });

              /*
               Le document est déterministe :
               groupId_requesterUid.

               Une ancienne demande terminale
               peut donc être remplacée par une
               nouvelle demande pending, tandis
               qu’un doublon pending est refusé.
              */
              transaction.set(
                requestRef,
                joinRequest
              );

              transaction.update(
                groupRef,
                {
                  "stats.pendingRequestCount":
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
                        .MEMBER_JOIN_REQUESTED,
                    actorUid: uid,
                    targetUserId: uid,
                    joinRequestId:
                      requestId,
                    visibility:
                      GroupActivityVisibility
                        .ADMINS,
                    createdAt: now,

                    actorPseudoSnapshot:
                      joinRequest
                        .requesterPseudoSnapshot,

                    ...(joinRequest
                      .requesterAvatarSnapshot
                      ? {
                          actorAvatarSnapshot:
                            joinRequest
                              .requesterAvatarSnapshot,
                        }
                      : {}),

                    targetPseudoSnapshot:
                      joinRequest
                        .requesterPseudoSnapshot,

                    metadata: {
                      expiresAt:
                        joinRequest.expiresAt,
                    },

                    deduplicationKey:
                      `member_join_requested:${requestId}:${now.getTime()}`,
                  },
                  {
                    transaction,
                  }
                );

              const managerUids =
                managersSnapshot.docs
                  .map((document) => {
                    const membership =
                      document.data() ?? {};

                    const role =
                      membership.role;

                    const userId =
                      asTrimmedString(
                        membership.userId
                      );

                    if (
                      !userId ||
                      userId === uid
                    ) {
                      return null;
                    }

                    if (
                      role !==
                        GroupRole.OWNER &&
                      role !==
                        GroupRole.ADMIN
                    ) {
                      return null;
                    }

                    return userId;
                  })
                  .filter(Boolean);

              return {
                requestId,
                groupId,
                activityId,
                expiresAt:
                  joinRequest.expiresAt,

                requesterPseudo:
                  joinRequest
                    .requesterPseudoSnapshot,

                groupName:
                  asTrimmedString(
                    group.name ??
                      group.title
                  ) || "Groupe Padima",

                managerUids:
                  [...new Set(
                    managerUids
                  )],
              };
            }
          );

        const notificationResults =
          await Promise.allSettled(
            result.managerUids.map(
              async (managerUid) => {
                const tokens =
                  await tokensOf(
                    managerUid
                  );

                await sendVisibleHybrid(
                  tokens,
                  {
                    title:
                      "Nouvelle demande d’adhésion",
                    body:
                      `${result.requesterPseudo} souhaite rejoindre « ${result.groupName} ».`,
                    data: {
                      type: "group",
                      subtype:
                        "join_request",
                      requestId:
                        result.requestId,
                      groupId:
                        result.groupId,
                      groupName:
                        result.groupName,
                      requesterUid:
                        uid,
                    },
                  }
                );

                return {
                  managerUid,
                  tokenCount:
                    tokens.length,
                };
              }
            )
          );

        const notificationFailures =
          notificationResults.filter(
            (item) =>
              item.status ===
              "rejected"
          );

        if (
          notificationFailures.length > 0
        ) {
          logger?.warn?.(
            "createGroupJoinRequest notification partial failure",
            {
              requestId:
                result.requestId,
              groupId:
                result.groupId,
              managerCount:
                result.managerUids.length,
              failureCount:
                notificationFailures.length,
            }
          );
        } else {
          logger?.info?.(
            "createGroupJoinRequest notifications processed",
            {
              requestId:
                result.requestId,
              groupId:
                result.groupId,
              managerCount:
                result.managerUids.length,
            }
          );
        }

        logger?.info?.(
          "createGroupJoinRequest ok",
          {
            uid,
            requestId:
              result.requestId,
            groupId:
              result.groupId,
          }
        );

        return {
          ok: true,
          requestId:
            result.requestId,
          groupId:
            result.groupId,
          expiresAt:
            result.expiresAt
              .toISOString(),
        };
      } catch (error) {
        logger?.error?.(
          "createGroupJoinRequest failed",
          {
            uid,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            field:
              error?.field,
            requestId:
              error?.requestId,
            message: String(
              error?.message ??
                error
            ),
          }
        );

        throw mapCreateGroupJoinRequestError(
          error,
          HttpsError
        );
      }
    }
  );
}
