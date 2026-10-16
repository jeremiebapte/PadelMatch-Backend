import {
  isNotificationPushAllowed,
} from "./NotificationPreferencesV2.js";

import {
  notificationPreferencesDocumentPath,
  validateNotificationPreferencesV2,
} from "./NotificationPreferencesStoreV2.js";

// Lecture des préférences juste avant de décider
// si une notification push peut être envoyée.
// Aucun effet de bord : ni écriture ni envoi FCM.
export function buildNotificationPushGateV2({ db }) {
  if (!db || typeof db.doc !== "function") {
    throw new TypeError("DB_REQUIRED");
  }

  return async function isPushAllowed({
    uid,
    category,
    event,
    membership,
  }) {
    if (
      typeof uid !== "string"
      || !uid.trim()
      || uid.includes("/")
    ) {
      throw new TypeError("INVALID_USER_ID");
    }

    const userSnapshot = await db
      .doc(`users/${uid}`)
      .get();

    if (!userSnapshot.exists) {
      return false;
    }

    const user = userSnapshot.data() || {};

    // Le refus global reste prioritaire :
    // inutile de lire les préférences privées.
    if (user.notificationsEnabled === false) {
      return false;
    }

    const preferencesSnapshot = await db
      .doc(notificationPreferencesDocumentPath(uid))
      .get();

    let notificationPreferencesV2;

    if (preferencesSnapshot.exists) {
      notificationPreferencesV2 =
        validateNotificationPreferencesV2(
          preferencesSnapshot.data()
        );
    }

    return isNotificationPushAllowed({
      user: {
        ...user,
        notificationPreferencesV2,
      },
      category,
      event,
      membership,
    });
  };
}
