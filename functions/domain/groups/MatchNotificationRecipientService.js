// Path: functions/domain/groups/MatchNotificationRecipientService.js
// ======================================================
// Padima — destinataires des notifications d'un match
//
// Responsabilités :
// - extraire uniquement les utilisateurs réellement liés au match ;
// - ignorer les placeholders locaux de joueurs invités ;
// - vérifier que chaque joueur est encore membre actif du groupe ;
// - respecter les préférences de notifications de match ;
// - exclure l'auteur de l'action quand nécessaire.
// ======================================================

function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function normalizeExcludedUserIds(
  excludedUserIds
) {
  return new Set(
    Array.isArray(excludedUserIds)
      ? excludedUserIds
          .map(asString)
          .filter(Boolean)
      : []
  );
}


function isRealUserId(value) {
  const userId = asString(value);

  if (!userId) {
    return false;
  }

  // Les anciens participants invités localement sont stockés
  // sous la forme "ami_de_<uid>:Joueur X".
  if (
    userId.includes(":")
    || userId.startsWith("ami_de_")
  ) {
    return false;
  }

  return true;
}


function extractParticipantUserIds(
  match,
  excludedUserIds
) {
  const excluded =
    normalizeExcludedUserIds(
      excludedUserIds
    );

  const candidates = [
    ...(Array.isArray(match?.participants)
      ? match.participants
      : []),

    match?.createurUid,
    match?.creatorUid,

    match?.createdByType === "player"
      ? match?.createdById
      : null,
  ];

  return [
    ...new Set(
      candidates
        .map((candidate) => {
          if (
            typeof candidate
            === "string"
          ) {
            return asString(candidate);
          }

          if (
            candidate
            && typeof candidate
              === "object"
          ) {
            return asString(
              candidate.userId
              || candidate.uid
              || candidate.playerUid
            );
          }

          return "";
        })
        .filter(isRealUserId)
        .filter(
          (userId) =>
            !excluded.has(userId)
        )
    ),
  ];
}


function hasMatchNotificationsEnabled(
  membership
) {
  return (
    membership?.notificationsEnabled
      !== false
    && membership
      ?.matchNotificationsEnabled
      !== false
  );
}


export function buildGetEligibleMatchRecipients({
  db,
  logger,
}) {
  if (!db) {
    throw new TypeError("DB_REQUIRED");
  }

  return async function getEligibleMatchRecipients({
    groupId,
    match = {},
    excludedUserIds = [],
  }) {
    const normalizedGroupId =
      asString(groupId);

    if (!normalizedGroupId) {
      return [];
    }

    const participantUserIds =
      extractParticipantUserIds(
        match,
        excludedUserIds
      );

    if (!participantUserIds.length) {
      logger?.info?.(
        "eligible match notification recipients: no participants",
        {
          groupId:
            normalizedGroupId,
        }
      );

      return [];
    }

    const membershipReferences =
      participantUserIds.map(
        (userId) =>
          db
            .collection(
              "groupMemberships"
            )
            .doc(
              `${normalizedGroupId}_${userId}`
            )
      );

    const snapshots =
      typeof db.getAll === "function"
        ? await db.getAll(
            ...membershipReferences
          )
        : await Promise.all(
            membershipReferences.map(
              (reference) =>
                reference.get()
            )
          );

    const recipients =
      snapshots
        .filter(
          (snapshot) =>
            snapshot.exists
        )
        .map((snapshot) => ({
          membershipId:
            snapshot.id,

          ...(
            snapshot.data()
            || {}
          ),
        }))
        .filter((membership) => {
          const userId =
            asString(
              membership.userId
            );

          return (
            membership.status
              === "active"
            && participantUserIds
              .includes(userId)
            && hasMatchNotificationsEnabled(
              membership
            )
          );
        });

    logger?.info?.(
      "eligible match notification recipients loaded",
      {
        groupId:
          normalizedGroupId,

        participantCount:
          participantUserIds.length,

        recipientCount:
          recipients.length,

        excludedUserCount:
          normalizeExcludedUserIds(
            excludedUserIds
          ).size,
      }
    );

    return recipients;
  };
}
