// Path:
// functions/domain/playerInvites/PlayerInviteEngagementService.js
//
// Padima — Player Invite To Play V1
// Projection Activity Center + push.
//
// Important :
// playerInvitations reste la source métier.
// Une erreur Activity/push ne doit jamais annuler
// une action métier déjà validée.
// ======================================================


function asString(
  value
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function pseudo(
  value
) {
  return asString(value)
    || "Un joueur";
}


function optionalAvatar(
  value
) {
  return asString(value)
    || null;
}


function scheduleSubtitle(
  invitation = {}
) {
  const place =
    asString(
      invitation.clubNameSnapshot
    )
    || asString(
      invitation.placeLabel
    );

  const preference =
    asString(
      invitation.timePreference
    );

  let moment =
    "";

  switch (preference) {
    case "morning":
      moment =
        "Le matin";
      break;

    case "afternoon":
      moment =
        "L’après-midi";
      break;

    case "evening":
      moment =
        "Le soir";
      break;

    default:
      moment =
        "";
      break;
  }

  if (
    moment
    && place
  ) {
    return `${moment} · ${place}`;
  }

  return moment
    || place
    || "Une partie de padel";
}


export function buildPlayerInviteEngagementService({
  db,
  recordUserActivity,
  tokensOf,
  sendVisibleHybrid,
  logger = console,
}) {
  if (!db) {
    throw new TypeError(
      "PLAYER_INVITE_ENGAGEMENT_DB_REQUIRED"
    );
  }

  if (
    typeof recordUserActivity
    !== "function"
  ) {
    throw new TypeError(
      "PLAYER_INVITE_RECORD_ACTIVITY_REQUIRED"
    );
  }

  if (
    typeof tokensOf
    !== "function"
  ) {
    throw new TypeError(
      "PLAYER_INVITE_TOKENS_OF_REQUIRED"
    );
  }

  if (
    typeof sendVisibleHybrid
    !== "function"
  ) {
    throw new TypeError(
      "PLAYER_INVITE_SEND_VISIBLE_REQUIRED"
    );
  }


  async function loadInvitation(
    invitationId
  ) {
    const cleanId =
      asString(
        invitationId
      );

    if (!cleanId) {
      throw new Error(
        "PLAYER_INVITE_ID_REQUIRED"
      );
    }

    const snapshot =
      await db
        .collection(
          "playerInvitations"
        )
        .doc(cleanId)
        .get();

    if (!snapshot.exists) {
      throw new Error(
        "PLAYER_INVITE_NOT_FOUND"
      );
    }

    return {
      id:
        snapshot.id,

      ...(
        snapshot.data()
        ?? {}
      ),
    };
  }


  async function safeActivity(
    payload
  ) {
    try {
      return await recordUserActivity(
        payload
      );

    } catch (error) {
      logger?.warn?.(
        "player invite Activity ignored failure",
        {
          type:
            payload?.type,

          inviteId:
            payload?.inviteId,

          userId:
            payload?.userId,

          error:
            String(
              error?.message
              ?? error
            ),
        }
      );

      return null;
    }
  }


  async function safePush({
    userId,
    title,
    body,
    data,
  }) {
    try {
      const tokens =
        await tokensOf(
          userId
        );

      if (
        !Array.isArray(tokens)
        || !tokens.length
      ) {
        return {
          sent:
            false,

          reason:
            "no_tokens",
        };
      }

      await sendVisibleHybrid(
        tokens,
        {
          title,
          body,
          data,
        }
      );

      return {
        sent:
          true,
      };

    } catch (error) {
      logger?.warn?.(
        "player invite push ignored failure",
        {
          userId,

          type:
            data?.type,

          inviteId:
            data?.inviteId,

          error:
            String(
              error?.message
              ?? error
            ),
        }
      );

      return {
        sent:
          false,

        reason:
          "error",
      };
    }
  }


  async function invitationReceived(
    invitationId
  ) {
    const invitation =
      await loadInvitation(
        invitationId
      );

    const actorPseudo =
      pseudo(
        invitation
          .inviterPseudoSnapshot
      );

    const actorAvatar =
      optionalAvatar(
        invitation
          .inviterAvatarSnapshot
      );

    const title =
      `${actorPseudo} t’invite à jouer`;

    const subtitle =
      scheduleSubtitle(
        invitation
      );

    await safeActivity({
      userId:
        invitation.inviteeUid,

      type:
        "player_invite_received",

      entityType:
        "player_invite",

      entityId:
        invitation.id,

      title,

      subtitle,

      sourceType:
        "player_invite",

      inviteId:
        invitation.id,

      actorUid:
        invitation.inviterUid,

      actorPseudoSnapshot:
        actorPseudo,

      ...(actorAvatar
        ? {
            actorAvatarSnapshot:
              actorAvatar,
          }
        : {}),

      metadata: {
        status:
          invitation.status,

        scheduleKind:
          asString(
            invitation.scheduleKind
          ),

        timePreference:
          asString(
            invitation.timePreference
          ),

        pairKey:
          asString(
            invitation.pairKey
          ),
      },
    });


    await safePush({
      userId:
        invitation.inviteeUid,

      title,

      body:
        subtitle,

      data: {
        type:
          "player_invite_received",

        entityType:
          "player_invite",

        entityId:
          invitation.id,

        inviteId:
          invitation.id,

        actorUid:
          invitation.inviterUid,
      },
    });


    return invitation;
  }


  async function invitationAccepted(
    invitationId
  ) {
    const invitation =
      await loadInvitation(
        invitationId
      );

    const actorPseudo =
      pseudo(
        invitation
          .inviteePseudoSnapshot
      );

    const actorAvatar =
      optionalAvatar(
        invitation
          .inviteeAvatarSnapshot
      );

    const title =
      "Invitation acceptée";

    const subtitle =
      `${actorPseudo} a accepté ton invitation à jouer.`;

    await safeActivity({
      userId:
        invitation.inviterUid,

      type:
        "player_invite_accepted",

      entityType:
        "player_invite",

      entityId:
        invitation.id,

      title,

      subtitle,

      sourceType:
        "player_invite",

      inviteId:
        invitation.id,

      actorUid:
        invitation.inviteeUid,

      actorPseudoSnapshot:
        actorPseudo,

      ...(actorAvatar
        ? {
            actorAvatarSnapshot:
              actorAvatar,
          }
        : {}),

      metadata: {
        status:
          invitation.status,

        conversationId:
          asString(
            invitation
              .conversationId
          ),

        pairKey:
          asString(
            invitation.pairKey
          ),
      },
    });


    await safePush({
      userId:
        invitation.inviterUid,

      title,

      body:
        subtitle,

      data: {
        type:
          "player_invite_accepted",

        entityType:
          "player_invite",

        entityId:
          invitation.id,

        inviteId:
          invitation.id,

        conversationId:
          asString(
            invitation
              .conversationId
          ),

        actorUid:
          invitation.inviteeUid,
      },
    });


    return invitation;
  }


  async function invitationDeclined(
    invitationId
  ) {
    const invitation =
      await loadInvitation(
        invitationId
      );

    const actorPseudo =
      pseudo(
        invitation
          .inviteePseudoSnapshot
      );

    const actorAvatar =
      optionalAvatar(
        invitation
          .inviteeAvatarSnapshot
      );

    const title =
      "Invitation non acceptée";

    const subtitle =
      `${actorPseudo} ne peut pas accepter cette invitation.`;

    /*
     * Choix V1 :
     * Activity Center oui,
     * push visible non.
     *
     * Un refus n'a pas besoin d'interrompre
     * immédiatement l'utilisateur.
     */
    await safeActivity({
      userId:
        invitation.inviterUid,

      type:
        "player_invite_declined",

      entityType:
        "player_invite",

      entityId:
        invitation.id,

      title,

      subtitle,

      sourceType:
        "player_invite",

      inviteId:
        invitation.id,

      actorUid:
        invitation.inviteeUid,

      actorPseudoSnapshot:
        actorPseudo,

      ...(actorAvatar
        ? {
            actorAvatarSnapshot:
              actorAvatar,
          }
        : {}),

      metadata: {
        status:
          invitation.status,

        pairKey:
          asString(
            invitation.pairKey
          ),
      },
    });


    return invitation;
  }


  return {
    invitationReceived,
    invitationAccepted,
    invitationDeclined,
  };
}
