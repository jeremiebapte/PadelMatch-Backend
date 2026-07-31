// Path: functions/domain/groups/GroupNotificationRecipientService.js
// ======================================================
// Padima — sélection centralisée des destinataires Groups
//
// Responsabilités :
// - charger les membres actifs d'un groupe ;
// - respecter les préférences générales ;
// - respecter la préférence liée au type de notification ;
// - permettre l'exclusion d'un ou plusieurs utilisateurs ;
// - fournir une base commune aux notifications matchs,
//   messages et futurs événements Groups.
// ======================================================

const GroupNotificationPreference = Object.freeze({
  GENERAL: "general",
  MATCH: "match",
  MESSAGE: "message",
});


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function normalizedExcludedUserIds(value) {
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(
    value
      .map(asString)
      .filter(Boolean)
  );
}


function hasEnabledPreference(
  membership,
  preference
) {
  if (
    membership.notificationsEnabled
    === false
  ) {
    return false;
  }

  switch (preference) {
    case GroupNotificationPreference.MATCH:
      return (
        membership
          .matchNotificationsEnabled
        !== false
      );

    case GroupNotificationPreference.MESSAGE:
      return (
        membership
          .messageNotificationsEnabled
        !== false
      );

    case GroupNotificationPreference.GENERAL:
      return true;

    default:
      throw new TypeError(
        "INVALID_GROUP_NOTIFICATION_PREFERENCE"
      );
  }
}


export function buildGetEligibleGroupRecipients({
  db,
  logger,
}) {
  if (!db) {
    throw new TypeError("DB_REQUIRED");
  }

  return async function getEligibleGroupRecipients({
    groupId,
    preference =
      GroupNotificationPreference.GENERAL,
    excludedUserIds = [],
  }) {
    const normalizedGroupId =
      asString(groupId);

    if (!normalizedGroupId) {
      throw new TypeError("GROUP_ID_REQUIRED");
    }

    const excluded =
      normalizedExcludedUserIds(
        excludedUserIds
      );

    const snapshot =
      await db
        .collection("groupMemberships")
        .where(
          "groupId",
          "==",
          normalizedGroupId
        )
        .get();

    const recipients =
      snapshot.docs
        .map((document) => ({
          membershipId:
            document.id,
          ...(document.data() || {}),
        }))
        .filter((membership) => {
          const userId =
            asString(
              membership.userId
            );

          return (
            membership.status
              === "active"
            && Boolean(userId)
            && !excluded.has(userId)
            && hasEnabledPreference(
              membership,
              preference
            )
          );
        });

    logger?.info?.(
      "eligible group notification recipients loaded",
      {
        groupId:
          normalizedGroupId,
        preference,
        membershipCount:
          snapshot.size,
        recipientCount:
          recipients.length,
        excludedUserCount:
          excluded.size,
      }
    );

    return recipients;
  };
}


export {
  GroupNotificationPreference,
};
