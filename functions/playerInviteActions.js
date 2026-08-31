// Path: functions/playerInviteActions.js

import {
  HttpsError,
} from "firebase-functions/v2/https";

import {
  PlayerInviteServiceError,
  buildAcceptPlayerInvite,
  buildDeclinePlayerInvite,
  buildCancelPlayerInvite,
} from "./domain/playerInvites/index.js";


function cleanId(
  value
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function mapActionError(
  error
) {
  const code =
    error?.code
    || "PLAYER_INVITE_ACTION_FAILED";

  switch (code) {
    case "PLAYER_INVITE_ID_REQUIRED":
      return new HttpsError(
        "invalid-argument",
        code
      );

    case "PLAYER_INVITE_NOT_FOUND":
      return new HttpsError(
        "not-found",
        code
      );

    case "PLAYER_INVITE_FORBIDDEN":
      return new HttpsError(
        "permission-denied",
        code
      );

    case "PLAYER_INVITE_EXPIRED":
    case "PLAYER_INVITE_NOT_PENDING":
      return new HttpsError(
        "failed-precondition",
        code
      );

    default:
      return new HttpsError(
        "internal",
        "PLAYER_INVITE_ACTION_FAILED"
      );
  }
}


function makeCallable({
  action,
  onSuccess = null,
}) {
  return async function handle(
    req
  ) {
    const actorUid =
      req.auth?.uid;

    if (!actorUid) {
      throw new HttpsError(
        "unauthenticated",
        "AUTH_REQUIRED"
      );
    }

    const invitationId =
      cleanId(
        req.data?.invitationId
      );

    try {
      const result =
        await action({
          actorUid,
          invitationId,
        });

      if (
        typeof onSuccess
        === "function"
      ) {
        try {
          await onSuccess(
            result.invitationId
          );
        } catch (sideEffectError) {
          console.warn(
            "Player Invite action side effect ignored",
            sideEffectError
          );
        }
      }

      return result;

    } catch (error) {
      if (
        error instanceof
          PlayerInviteServiceError
      ) {
        throw mapActionError(
          error
        );
      }

      console.error(
        "Player Invite action failed",
        error
      );

      throw new HttpsError(
        "internal",
        "PLAYER_INVITE_ACTION_FAILED"
      );
    }
  };
}


export function buildAcceptPlayerInviteCallable({
  db,
  onInvitationAccepted = null,
}) {
  return makeCallable({
    action:
      buildAcceptPlayerInvite({
        db,
      }),

    onSuccess:
      onInvitationAccepted,
  });
}


export function buildDeclinePlayerInviteCallable({
  db,
  onInvitationDeclined = null,
}) {
  return makeCallable({
    action:
      buildDeclinePlayerInvite({
        db,
      }),

    onSuccess:
      onInvitationDeclined,
  });
}


export function buildCancelPlayerInviteCallable({
  db,
}) {
  return makeCallable({
    action:
      buildCancelPlayerInvite({
        db,
      }),
  });
}
