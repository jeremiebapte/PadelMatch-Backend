// Path: functions/listGroupJoinRequests.js
// ======================================================
// Padima — Groups
// Callable listGroupJoinRequests
// Liste Owner/Admin des demandes d’adhésion pending
// ======================================================

import {
  GroupJoinRequestError,
  GroupValidationError,
  assertCanManageJoinRequests,
  membershipDocumentId,
  validateGroupId,
} from "./domain/groups/index.js";


function mapListGroupJoinRequestsError(
  error,
  HttpsError
) {
  if (error instanceof HttpsError) {
    return error;
  }

  if (error instanceof GroupValidationError) {
    return new HttpsError(
      "invalid-argument",
      error.code,
      {
        field: error.field,
        code: error.code,
      }
    );
  }

  if (error instanceof GroupJoinRequestError) {
    if (
      error.code ===
      "JOIN_REQUEST_MANAGEMENT_FORBIDDEN"
    ) {
      return new HttpsError(
        "permission-denied",
        error.code
      );
    }

    return new HttpsError(
      "failed-precondition",
      error.code ??
        "LIST_GROUP_JOIN_REQUESTS_FAILED"
    );
  }

  switch (error?.code) {
    case "GROUP_NOT_FOUND":
      return new HttpsError(
        "not-found",
        error.code
      );

    case "GROUP_NOT_ACTIVE":
      return new HttpsError(
        "failed-precondition",
        error.code
      );

    default:
      return new HttpsError(
        "internal",
        "LIST_GROUP_JOIN_REQUESTS_INTERNAL"
      );
  }
}


function serializeTimestamp(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value.toDate === "function"
  ) {
    return value.toDate().getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return null;
}


export function buildListGroupJoinRequests({
  onCall,
  HttpsError,
  runtime,
  db,
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
          db.collection("groups")
            .doc(groupId);

        const membershipRef =
          db.collection(
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
          membershipSnapshot,
        ] = await Promise.all([
          groupRef.get(),
          membershipRef.get(),
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

        const group =
          groupSnapshot.data() ?? {};

        if (group.status !== "active") {
          const error =
            new Error(
              "GROUP_NOT_ACTIVE"
            );

          error.code =
            "GROUP_NOT_ACTIVE";

          throw error;
        }

        const membership =
          membershipSnapshot.exists
            ? membershipSnapshot.data()
            : null;

        assertCanManageJoinRequests({
          membership,
        });

        const snapshot =
          await db
            .collection(
              "groupJoinRequests"
            )
            .where(
              "groupId",
              "==",
              groupId
            )
            .where(
              "status",
              "==",
              "pending"
            )
            .orderBy(
              "createdAt",
              "desc"
            )
            .get();

        const requests =
          snapshot.docs.map(
            (document) => {
              const data =
                document.data() ?? {};

              return {
                requestId:
                  document.id,

                groupId:
                  data.groupId ??
                  groupId,

                requesterUid:
                  data.requesterUid ??
                  null,

                status:
                  data.status ??
                  null,

                requesterPseudoSnapshot:
                  data
                    .requesterPseudoSnapshot
                    ?? "Joueur Padima",

                requesterAvatarSnapshot:
                  data
                    .requesterAvatarSnapshot
                    ?? null,

                requesterLevelSnapshot:
                  Number.isInteger(
                    data
                      .requesterLevelSnapshot
                  )
                    ? data
                        .requesterLevelSnapshot
                    : null,

                groupNameSnapshot:
                  data
                    .groupNameSnapshot
                    ?? null,

                createdAt:
                  serializeTimestamp(
                    data.createdAt
                  ),

                expiresAt:
                  serializeTimestamp(
                    data.expiresAt
                  ),
              };
            }
          );

        logger?.info?.(
          "listGroupJoinRequests ok",
          {
            uid,
            groupId,
            count:
              requests.length,
          }
        );

        return {
          ok: true,
          groupId,
          requests,
        };

      } catch (error) {
        logger?.error?.(
          "listGroupJoinRequests failed",
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

        throw mapListGroupJoinRequestsError(
          error,
          HttpsError
        );
      }
    }
  );
}
