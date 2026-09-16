// Path: functions/createPlayerInvite.js
// ======================================================
// Padima — Player Invite To Play V1
// Wrapper callable createPlayerInvite.
// ======================================================

import {
  HttpsError,
} from "firebase-functions/v2/https";

import {
  PlayerInviteServiceError,
  PlayerInviteValidationError,
  buildCreatePlayerInvite,
} from "./domain/playerInvites/index.js";


function mapPlayerInviteError(
  error
) {
  const code =
    error?.code
    || "PLAYER_INVITE_UNKNOWN_ERROR";

  switch (code) {
    case "PLAYER_INVITEE_UID_REQUIRED":
    case "PLAYER_INVITE_INVALID_SCHEDULE_KIND":
    case "PLAYER_INVITE_INVALID_TIME_PREFERENCE":
    case "PLAYER_INVITE_MESSAGE_TOO_LONG":
    case "PLAYER_INVITE_CLUB_NAME_TOO_LONG":
    case "PLAYER_INVITE_PLACE_LABEL_TOO_LONG":
    case "PLAYER_INVITE_START_REQUIRED":
    case "PLAYER_INVITE_DATE_RANGE_REQUIRED":
    case "PLAYER_INVITE_INVALID_DATE":
    case "PLAYER_INVITE_INVALID_DATE_RANGE":
    case "PLAYER_INVITE_SELF_NOT_ALLOWED":
    case "PLAYER_UID_REQUIRED":
      return new HttpsError(
        "invalid-argument",
        code
      );

    case "PLAYER_INVITER_NOT_FOUND":
    case "PLAYER_INVITEE_NOT_FOUND":
      return new HttpsError(
        "not-found",
        code
      );

    case "PLAYER_INVITEE_NOT_DISCOVERABLE":
      return new HttpsError(
        "failed-precondition",
        code
      );

    case "PLAYER_INVITE_ALREADY_PENDING":
      return new HttpsError(
        "already-exists",
        code
      );

    default:
      return new HttpsError(
        "internal",
        "PLAYER_INVITE_CREATE_FAILED"
      );
  }
}


export function buildCreatePlayerInviteCallable({
  db,
  onInvitationCreated = null,
}) {
  const createPlayerInvite =
    buildCreatePlayerInvite({
      db,
    });

  return async function handleCreatePlayerInvite(
    req
  ) {
    const inviterUid =
      req.auth?.uid;

    if (!inviterUid) {
      throw new HttpsError(
        "unauthenticated",
        "AUTH_REQUIRED"
      );
    }

    try {
      const result =
        await createPlayerInvite({
          inviterUid,
          input:
            req.data ?? {},
        });

      if (
        typeof onInvitationCreated
        === "function"
      ) {
        try {
          await onInvitationCreated(
            result.invitationId
          );
        } catch (sideEffectError) {
          console.warn(
            "createPlayerInvite side effect ignored",
            sideEffectError
          );
        }
      }

      return result;

    } catch (error) {
      if (
        error instanceof
          PlayerInviteServiceError
        || error instanceof
          PlayerInviteValidationError
      ) {
        throw mapPlayerInviteError(
          error
        );
      }

      console.error(
        "createPlayerInvite failed",
        error
      );

      throw new HttpsError(
        "internal",
        "PLAYER_INVITE_CREATE_FAILED"
      );
    }
  };
}
