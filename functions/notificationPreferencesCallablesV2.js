import {
  validateNotificationPreferencesV2,
  notificationPreferencesDocumentPath,
} from "./domain/notifications/NotificationPreferencesStoreV2.js";

function authenticatedUid(req, HttpsError) {
  const uid = req?.auth?.uid;

  if (typeof uid !== "string" || !uid.trim()) {
    throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
  }

  return uid;
}

function preferencesRef(db, uid) {
  return db.doc(notificationPreferencesDocumentPath(uid));
}

export function buildGetNotificationPreferencesV2({
  onCall, HttpsError, runtime, db,
}) {
  return onCall(runtime, async (req) => {
    const uid = authenticatedUid(req, HttpsError);
    const snapshot = await preferencesRef(db, uid).get();

    if (!snapshot.exists) {
      return {
        ok: true,
        preferences: validateNotificationPreferencesV2({}),
      };
    }

    return {
      ok: true,
      preferences: validateNotificationPreferencesV2(snapshot.data()),
    };
  });
}

export function buildSetNotificationPreferencesV2({
  onCall, HttpsError, runtime, db,
}) {
  return onCall(runtime, async (req) => {
    const uid = authenticatedUid(req, HttpsError);

    let preferences;

    try {
      preferences = validateNotificationPreferencesV2(
        req.data?.preferences
      );
    } catch (error) {
      if (error instanceof TypeError) {
        throw new HttpsError(
          "invalid-argument",
          error.message
        );
      }

      throw error;
    }

    await preferencesRef(db, uid).set(preferences);

    return {
      ok: true,
      preferences,
    };
  });
}
