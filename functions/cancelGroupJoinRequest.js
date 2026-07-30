// Path: functions/cancelGroupJoinRequest.js
// ======================================================
// Padima — Groups
// Callable cancelGroupJoinRequest
// Annulation par le demandeur de sa demande en attente
// ======================================================

import {
  GroupJoinRequestError,
  GroupJoinRequestStatus,
  GroupJoinRequestValidationError,
  GroupValidationError,
  cancelGroupJoinRequest,
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

function mapCancelGroupJoinRequestError(
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
      case "JOIN_REQUEST_CANCELLATION_FORBIDDEN":
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
            "CANCEL_GROUP_JOIN_REQUEST_FAILED"
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
      return new HttpsError(
        "failed-precondition",
        error.code
      );

    case "JOIN_REQUEST_CANCELLATION_FORBIDDEN":
      return new HttpsError(
        "permission-denied",
        error.code
      );

    default:
      return new HttpsError(
        "internal",
        "CANCEL_GROUP_JOIN_REQUEST_INTERNAL"
      );
  }
}

export function buildCancelGroupJoinRequest({
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
    !FieldValue ||
    typeof FieldValue.increment !==
      "function"
  ) {
    throw new TypeError(
      "FIELD_VALUE_REQUIRED"
    );
  }

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

              if (
                !requesterUid ||
                requesterUid !== uid
              ) {
                throw codedError(
                  "JOIN_REQUEST_CANCELLATION_FORBIDDEN"
                );
              }

              const groupRef =
                db
                  .collection("groups")
                  .doc(groupId);

              const groupSnapshot =
                await transaction.get(
                  groupRef
                );

              if (
                !groupSnapshot.exists
              ) {
                throw codedError(
                  "GROUP_NOT_FOUND"
                );
              }

              const now = new Date();

              const cancelledRequest =
                cancelGroupJoinRequest({
                  request,
                  requesterUid: uid,
                  now,
                });

              transaction.update(
                requestRef,
                {
                  status:
                    cancelledRequest.status,
                  updatedAt:
                    cancelledRequest.updatedAt,
                  resolvedAt:
                    cancelledRequest.resolvedAt,
                  resolvedByUid:
                    cancelledRequest
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

              return {
                requestId,
                groupId,
                requesterUid,
              };
            }
          );

        logger?.info?.(
          "cancelGroupJoinRequest ok",
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
          requesterUid:
            result.requesterUid,
        };
      } catch (error) {
        logger?.error?.(
          "cancelGroupJoinRequest failed",
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

        throw mapCancelGroupJoinRequestError(
          error,
          HttpsError
        );
      }
    }
  );
}
