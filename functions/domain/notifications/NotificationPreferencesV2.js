// PADIMA — Notification Preferences V2
// Contrat partagé, sans effet de bord ni accès Firebase.

export const NOTIFICATION_CATEGORIES = Object.freeze({
  MATCHES: "matches",
  DISCOVERY: "discovery",
  GROUPS: "groups",
  MESSAGES: "messages",
  CLUBS: "clubs",
  NETWORK: "network",
  AVAILABILITY: "availability",
  NEWS: "news",
});

export const NOTIFICATION_EVENTS = Object.freeze({
  matchPlayerJoined: "matches",
  matchPlayerLeft: "matches",
  matchFull: "matches",
  matchUpdated: "matches",
  matchCancelled: "matches",
  matchReminder: "matches",

  nearbyMatch: "discovery",
  recommendedMatch: "discovery",
  matchAlmostFull: "discovery",

  groupInvitation: "groups",
  groupJoinRequest: "groups",
  groupMembershipUpdate: "groups",
  groupMatchCreated: "groups",
  groupMatchUpdated: "matches",
  groupMatchCancelled: "matches",
  groupMatchPlayerJoined: "matches",
  groupMatchPlayerLeft: "matches",
  groupMatchFull: "matches",
  groupMatchSpotAvailable: "matches",

  matchMessage: "messages",
  groupMessage: "messages",
  directMessage: "messages",

  nearbyCourt: "clubs",
  clubMatch: "clubs",
  bookingUpdate: "clubs",

  connectionRequest: "network",
  connectionAccepted: "network",
  networkActivity: "network",

  availabilityOverlap: "availability",
  availabilityReminder: "availability",

  productNews: "news",
  marketing: "news",
});

export const NOTIFICATION_PREFERENCES_VERSION = 2;

const validCategories = new Set(
  Object.values(NOTIFICATION_CATEGORIES)
);

export function isNotificationPushAllowed({
  user,
  category,
  event,
  membership,
}) {
  if (!validCategories.has(category)) {
    throw new TypeError("UNKNOWN_NOTIFICATION_CATEGORY");
  }

  if (event !== undefined) {
    if (
      !Object.hasOwn(NOTIFICATION_EVENTS, event)
      || NOTIFICATION_EVENTS[event] !== category
    ) {
      throw new TypeError("UNKNOWN_NOTIFICATION_EVENT");
    }
  }

  // Le refus global existant reste prioritaire.
  if (user?.notificationsEnabled === false) {
    return false;
  }

  const preferences = user?.notificationPreferencesV2;

  if (preferences?.categories?.[category] === false) {
    return false;
  }

  if (
    event
    && preferences?.events?.[event] === false
  ) {
    return false;
  }

  // Les réglages historiques par groupe sont conservés.
  if (membership) {
    if (membership.notificationsEnabled === false) {
      return false;
    }

    if (
      category === "groups"
      && membership.matchNotificationsEnabled === false
    ) {
      return false;
    }

    if (
      category === "messages"
      && membership.messageNotificationsEnabled === false
    ) {
      return false;
    }
  }

  return true;
}
