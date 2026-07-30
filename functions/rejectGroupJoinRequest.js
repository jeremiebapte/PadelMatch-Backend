// Path: functions/rejectGroupJoinRequest.js
// ======================================================
// Padima — Groups
// Callable rejectGroupJoinRequest
// Refus Owner/Admin d’une demande d’adhésion
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupJoinRequestError,
  GroupJoinRequestStatus,
  GroupJoinRequestValidationError,
  GroupValidationError,
  assertCanManageJoinRequests,
  createGroupActivityRecorder,
  membershipDocumentId,
  rejectGroupJoinRequest,
  validateResolveGroupJoinRequestInput,
} from "./domain/groups/index.js";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function mapRejectGroupJoinRequestError(
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
      case "JOIN_REQUEST_MANAGEMENT_FORBIDDEN":
        return new HttpsError(
          "permission-denied",
          error.code
        );

      case "JOIN_REQUEST_NOT_FOUND":
        return new HttpsError(
          "not-found",
          error.code
        );

      case "INVALID_JOIN_REQUEST_TRANSITION":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      default:
        return new HttpsError(
          "failed-precondition",
          error.code ??
            "REJECT_GROUP_JOIN_REQUEST_FAILED"
        );
    }
  }

  switch (error?.code) {
    case "GROUP_JOIN_REQUEST_NOT_FOUND":
    case "GROUP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    case "JOIN_REQUEST_NOT_PENDING":
    case "GROUP_NOT_ACTIVE":
      return new HttpsError(
        "failed-precondition",
        error.code
      );

    default:
      return new HttpsError(
        "internal",
        "REJECT_GROUP_JOIN_REQUEST_INTERNAL"
      );
  }
}

export function buildRejectGroupJoinRequest({
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
        const {
          requestId,
        } =
          validateResolveGroupJoinRequestInput(
            req.data ?? {}
          );

        const requestRef =
          db
            .collection(
              "groupJoinRequests"
            )
            .doc(requestId);

        const result =
          await db.runTransaction(
            async (transaction) => {
              const requestSnapshot =
                await transaction.get(
                  requestRef
                );

              if (
                !requestSnapshot.exists
              ) {
                throw codedError(
                  "GROUP_JOIN_REQUEST_NOT_FOUND"
                );
              }

              const request = {
                requestId:
                  requestSnapshot.id,
                ...(requestSnapshot.data() ??
                  {}),
              };

              if (
                request.status !==
                GroupJoinRequestStatus.PENDING
              ) {
                throw codedError(
                  "JOIN_REQUEST_NOT_PENDING"
                );
              }

              const groupId =
                asTrimmedString(
                  request.groupId
                );

              const requesterUid =
                asTrimmedString(
                  request.requesterUid
                );

              if (!groupId) {
                throw codedError(
                  "GROUP_NOT_FOUND"
                );
              }

              const groupRef =
                db
                  .collection("groups")
                  .doc(groupId);

              const managerMembershipRef =
                db
                  .collection(
                    "groupMemberships"
                  )
                  .doc(
                    membershipDocumentId(
                      groupId,
                      uid
                    )
                  );

              const [
                groupSnapshot,
                managerMembershipSnapshot,
              ] = await Promise.all([
                transaction.get(
                  groupRef
                ),
                transaction.get(
                  managerMembershipRef
                ),
              ]);

              if (
                !groupSnapshot.exists
              ) {
                throw codedError(
                  "GROUP_NOT_FOUND"
                );
              }

              const group =
                groupSnapshot.data() ?? {};

              if (
                group.status !== "active"
              ) {
                throw codedError(
                  "GROUP_NOT_ACTIVE"
                );
              }

              const managerMembership =
                managerMembershipSnapshot.exists
                  ? managerMembershipSnapshot
                      .data()
                  : null;

              assertCanManageJoinRequests({
                membership:
                  managerMembership,
              });

              const now = new Date();

              const rejectedRequest =
                rejectGroupJoinRequest({
                  request,
                  rejectedByUid: uid,
                  now,
                });

              transaction.update(
                requestRef,
                {
                  status:
                    rejectedRequest.status,
                  updatedAt:
                    rejectedRequest.updatedAt,
                  resolvedAt:
                    rejectedRequest.resolvedAt,
                  resolvedByUid:
                    rejectedRequest
                      .resolvedByUid,
                }
              );

              transaction.update(
                groupRef,
                {
                  "stats.pendingRequestCount":
                    FieldValue.increment(-1),
                  updatedAt: now,
                }
              );

              const activityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .MEMBER_REQUEST_REJECTED,
                    actorUid: uid,
                    targetUserId:
                      requesterUid,
                    joinRequestId:
                      requestId,
                    visibility:
                      GroupActivityVisibility
                        .ADMINS,
                    createdAt: now,

                    targetPseudoSnapshot:
                      asTrimmedString(
                        request
                          .requesterPseudoSnapshot
                      ) || "Joueur",

                    metadata: {
                      resolvedByUid: uid,
                    },

                    deduplicationKey:
                      `member_request_rejected:${requestId}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                requestId,
                groupId,
                requesterUid,
                activityId,

                groupName:
                  asTrimmedString(
                    group.name ??
                      group.title ??
                      request
                        .groupNameSnapshot
                  ) || "Groupe Padima",
              };
            }
          );

        if (result.requesterUid) {
          try {
            const tokens =
              await tokensOf(
                result.requesterUid
              );

            await sendVisibleHybrid(
              tokens,
              {
                title:
                  "Demande d’adhésion refusée",
                body:
                  `Votre demande pour rejoindre « ${result.groupName} » n’a pas été acceptée.`,
                data: {
                  type: "group",
                  subtype:
                    "join_request_rejected",
                  requestId:
                    result.requestId,
                  groupId:
                    result.groupId,
                  groupName:
                    result.groupName,
                },
              }
            );

            logger?.info?.(
              "rejectGroupJoinRequest notification processed",
              {
                requestId:
                  result.requestId,
                requesterUid:
                  result.requesterUid,
                tokenCount:
                  tokens.length,
              }
            );
          } catch (notificationError) {
            logger?.warn?.(
              "rejectGroupJoinRequest notification ignored failure",
              {
                requestId:
                  result.requestId,
                requesterUid:
                  result.requesterUid,
                error: String(
                  notificationError?.message ??
                    notificationError
                ),
              }
            );
          }
        }

        logger?.info?.(
          "rejectGroupJoinRequest ok",
          {
            uid,
            requestId:
              result.requestId,
            groupId:
              result.groupId,
            requesterUid:
              result.requesterUid,
          }
        );

        return {
          ok: true,
          requestId:
            result.requestId,
          groupId:
            result.groupId,
          requesterUid:
            result.requesterUid,
        };
      } catch (error) {
        logger?.error?.(
          "rejectGroupJoinRequest failed",
          {
            uid,
            code:
              error?.code ??
              error?.name ??
              "UNKNOWN_ERROR",
            field:
              error?.field,
            message: String(
              error?.message ??
                error
            ),
          }
        );

        throw mapRejectGroupJoinRequestError(
          error,
          HttpsError
        );
      }
    }
  );
}
