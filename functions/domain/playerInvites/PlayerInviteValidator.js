// Path: functions/domain/playerInvites/PlayerInviteValidator.js
// ======================================================
// Padima — Player Invite To Play V1
// Validation et normalisation des entrées métier.
// ======================================================

import {
  PLAYER_INVITE_CLUB_NAME_MAX_LENGTH,
  PLAYER_INVITE_MESSAGE_MAX_LENGTH,
  PLAYER_INVITE_PLACE_LABEL_MAX_LENGTH,
} from "./PlayerInviteConstants.js";

import {
  PlayerInviteScheduleKind,
  PlayerInviteTimePreference,
} from "./PlayerInviteEnums.js";


export class PlayerInviteValidationError extends Error {
  constructor(
    code,
    field = null
  ) {
    super(code);

    this.name =
      "PlayerInviteValidationError";

    this.code =
      code;

    this.field =
      field;
  }
}


export function asTrimmedString(
  value
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


export function nullableTrimmedString(
  value
) {
  const normalized =
    asTrimmedString(value);

  return normalized.length > 0
    ? normalized
    : null;
}


export function buildPlayerPairKey(
  firstUid,
  secondUid
) {
  const a =
    asTrimmedString(firstUid);

  const b =
    asTrimmedString(secondUid);

  if (!a || !b) {
    throw new PlayerInviteValidationError(
      "PLAYER_UID_REQUIRED",
      "uid"
    );
  }

  if (a === b) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_SELF_NOT_ALLOWED",
      "inviteeUid"
    );
  }

  return [a, b]
    .sort()
    .join("_");
}


export function validateCreatePlayerInviteInput(
  input = {}
) {
  const inviteeUid =
    asTrimmedString(
      input.inviteeUid
    );

  if (!inviteeUid) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITEE_UID_REQUIRED",
      "inviteeUid"
    );
  }

  const scheduleKind =
    asTrimmedString(
      input.scheduleKind
    );

  if (
    !Object.values(
      PlayerInviteScheduleKind
    ).includes(scheduleKind)
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_INVALID_SCHEDULE_KIND",
      "scheduleKind"
    );
  }

  const timePreference =
    asTrimmedString(
      input.timePreference
    ) ||
    PlayerInviteTimePreference.ANY;

  if (
    !Object.values(
      PlayerInviteTimePreference
    ).includes(timePreference)
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_INVALID_TIME_PREFERENCE",
      "timePreference"
    );
  }

  const message =
    nullableTrimmedString(
      input.message
    );

  if (
    message
    && message.length >
      PLAYER_INVITE_MESSAGE_MAX_LENGTH
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_MESSAGE_TOO_LONG",
      "message"
    );
  }

  const clubId =
    nullableTrimmedString(
      input.clubId
    );

  const clubName =
    nullableTrimmedString(
      input.clubName
    );

  if (
    clubName
    && clubName.length >
      PLAYER_INVITE_CLUB_NAME_MAX_LENGTH
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_CLUB_NAME_TOO_LONG",
      "clubName"
    );
  }

  const placeLabel =
    nullableTrimmedString(
      input.placeLabel
    );

  if (
    placeLabel
    && placeLabel.length >
      PLAYER_INVITE_PLACE_LABEL_MAX_LENGTH
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_PLACE_LABEL_TOO_LONG",
      "placeLabel"
    );
  }

  const proposedStartAt =
    input.proposedStartAt ??
    null;

  const proposedEndAt =
    input.proposedEndAt ??
    null;

  if (
    scheduleKind ===
      PlayerInviteScheduleKind.EXACT_DATE
    && proposedStartAt == null
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_START_REQUIRED",
      "proposedStartAt"
    );
  }

  if (
    scheduleKind ===
      PlayerInviteScheduleKind.DATE_RANGE
    && (
      proposedStartAt == null
      || proposedEndAt == null
    )
  ) {
    throw new PlayerInviteValidationError(
      "PLAYER_INVITE_DATE_RANGE_REQUIRED",
      "proposedStartAt"
    );
  }

  return {
    inviteeUid,
    scheduleKind,
    proposedStartAt,
    proposedEndAt,
    timePreference,
    clubId,
    clubName,
    placeLabel,
    message,
  };
}
