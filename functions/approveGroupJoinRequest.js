// Path: functions/approveGroupJoinRequest.js
// ======================================================
// Padima — Groups
// Callable approveGroupJoinRequest
// Approbation Owner/Admin d’une demande d’adhésion
// ======================================================

import {
  GroupActivityType,
  GroupActivityVisibility,
  GroupJoinRequestError,
  GroupJoinRequestStatus,
  GroupJoinRequestValidationError,
  GroupMembershipStatus,
  GroupValidationError,
  approveGroupJoinRequest,
  assertCanManageJoinRequests,
  buildMembershipFromApprovedJoinRequest,
  createGroupActivityRecorder,
  membershipDocumentId,
  validateResolveGroupJoinRequestInput,
} from "./domain/groups/index.js";

function codedError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function asTrimmedString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function timestampToDate(value) {
  if (value instanceof Date) {
    return value;
  }

  if (
    value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate();
  }

  if (
    value &&
    typeof value.toMillis === "function"
  ) {
    return new Date(value.toMillis());
  }

  if (
    value &&
    typeof value.seconds === "number"
  ) {
    return new Date(
      value.seconds * 1000
    );
  }

  return null;
}

function mapApproveGroupJoinRequestError(
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
      case "JOIN_REQUEST_NOT_APPROVED":
        return new HttpsError(
          "failed-precondition",
          error.code
        );

      default:
        return new HttpsError(
          "failed-precondition",
          error.code ??
            "APPROVE_GROUP_JOIN_REQUEST_FAILED"
        );
    }
  }

  switch (error?.code) {
    case "GROUP_JOIN_REQUEST_NOT_FOUND":
    case "GROUP_NOT_FOUND":
    case "REQUESTER_PROFILE_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    case "JOIN_REQUEST_EXPIRED":
    case "JOIN_REQUEST_NOT_PENDING":
    case "GROUP_NOT_ACTIVE":
      return new HttpsError(
        "failed-precondition",
        error.code
      );

    case "REQUESTER_ALREADY_MEMBER":
      return new HttpsError(
        "already-exists",
        error.code,
        {
          membershipId:
            error.membershipId ??
            null,
        }
      );

    case "REQUESTER_BANNED_FROM_GROUP":
      return new HttpsError(
        "permission-denied",
        error.code
      );

    default:
      return new HttpsError(
        "internal",
        "APPROVE_GROUP_JOIN_REQUEST_INTERNAL"
      );
  }
}

export function buildApproveGroupJoinRequest({
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

              if (!requesterUid) {
                throw codedError(
                  "REQUESTER_PROFILE_NOT_FOUND"
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

              const requesterMembershipId =
                membershipDocumentId(
                  groupId,
                  requesterUid
                );

              const requesterMembershipRef =
                db
                  .collection(
                    "groupMemberships"
                  )
                  .doc(
                    requesterMembershipId
                  );

              const requesterUserRef =
                db
                  .collection("users")
                  .doc(requesterUid);

              const [
                groupSnapshot,
                managerMembershipSnapshot,
                requesterMembershipSnapshot,
                requesterUserSnapshot,
              ] = await Promise.all([
                transaction.get(
                  groupRef
                ),
                transaction.get(
                  managerMembershipRef
                ),
                transaction.get(
                  requesterMembershipRef
                ),
                transaction.get(
                  requesterUserRef
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
                !requesterUserSnapshot.exists
              ) {
                throw codedError(
                  "REQUESTER_PROFILE_NOT_FOUND"
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

              const existingMembership =
                requesterMembershipSnapshot.exists
                  ? requesterMembershipSnapshot
                      .data()
                  : null;

              if (
                existingMembership?.status ===
                GroupMembershipStatus.ACTIVE
              ) {
                throw codedError(
                  "REQUESTER_ALREADY_MEMBER",
                  {
                    membershipId:
                      requesterMembershipId,
                  }
                );
              }

              if (
                existingMembership?.status ===
                GroupMembershipStatus.BANNED
              ) {
                throw codedError(
                  "REQUESTER_BANNED_FROM_GROUP"
                );
              }

              const now = new Date();

              const expirationDate =
                timestampToDate(
                  request.expiresAt
                );

              if (
                !expirationDate ||
                expirationDate.getTime() <=
                  now.getTime()
              ) {
                throw codedError(
                  "JOIN_REQUEST_EXPIRED"
                );
              }

              const approvedRequest =
                approveGroupJoinRequest({
                  request,
                  approverUid: uid,
                  now,
                });

              const membership =
                buildMembershipFromApprovedJoinRequest({
                  request:
                    approvedRequest,
                  approvedByUid: uid,
                  now,
                  previousMembership:
                    existingMembership,
                });

              transaction.set(
                requesterMembershipRef,
                membership
              );

              transaction.update(
                requestRef,
                {
                  status:
                    approvedRequest.status,
                  updatedAt:
                    approvedRequest.updatedAt,
                  resolvedAt:
                    approvedRequest.resolvedAt,
                  resolvedByUid:
                    approvedRequest
                      .resolvedByUid,
                }
              );

              transaction.update(
                groupRef,
                {
                  "stats.pendingRequestCount":
                    FieldValue.increment(-1),
                  "stats.memberCount":
                    FieldValue.increment(1),
                  updatedAt: now,
                }
              );

              const approvedActivityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .MEMBER_REQUEST_APPROVED,
                    actorUid: uid,
                    targetUserId:
                      requesterUid,
                    joinRequestId:
                      requestId,
                    visibility:
                      GroupActivityVisibility
                        .MEMBERS,
                    createdAt: now,

                    targetPseudoSnapshot:
                      membership
                        .userPseudoSnapshot ??
                      request
                        .requesterPseudoSnapshot ??
                      "Joueur",

                    metadata: {
                      membershipId:
                        requesterMembershipId,
                    },

                    deduplicationKey:
                      `member_request_approved:${requestId}`,
                  },
                  {
                    transaction,
                  }
                );

              const joinedActivityId =
                await recordGroupActivity(
                  {
                    groupId,
                    type:
                      GroupActivityType
                        .MEMBER_JOINED,
                    actorUid:
                      requesterUid,
                    targetUserId:
                      requesterUid,
                    joinRequestId:
                      requestId,
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
                      membershipId:
                        requesterMembershipId,
                      source:
                        membership.source,
                      approvedByUid: uid,
                    },

                    deduplicationKey:
                      `member_joined:join_request:${requestId}`,
                  },
                  {
                    transaction,
                  }
                );

              return {
                requestId,
                groupId,
                requesterUid,
                membershipId:
                  requesterMembershipId,
                approvedActivityId,
                joinedActivityId,

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

        try {
          const tokens =
            await tokensOf(
              result.requesterUid
            );

          await sendVisibleHybrid(
            tokens,
            {
              title:
                "Demande d’adhésion acceptée",
              body:
                `Vous avez rejoint « ${result.groupName} ».`,
              data: {
                type: "group",
                subtype:
                  "join_request_approved",
                requestId:
                  result.requestId,
                groupId:
                  result.groupId,
                groupName:
                  result.groupName,
                membershipId:
                  result.membershipId,
              },
            }
          );

          logger?.info?.(
            "approveGroupJoinRequest notification processed",
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
            "approveGroupJoinRequest notification ignored failure",
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

        logger?.info?.(
          "approveGroupJoinRequest ok",
          {
            uid,
            requestId:
              result.requestId,
            groupId:
              result.groupId,
            requesterUid:
              result.requesterUid,
            membershipId:
              result.membershipId,
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
          membershipId:
            result.membershipId,
        };
      } catch (error) {
        logger?.error?.(
          "approveGroupJoinRequest failed",
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

        throw mapApproveGroupJoinRequestError(
          error,
          HttpsError
        );
      }
    }
  );
}
