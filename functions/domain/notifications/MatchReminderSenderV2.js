export class MatchReminderSendError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MatchReminderSendError";
    this.details = details;
  }
}

export function buildMatchReminderSenderV2({
  messaging,
  logger,
  cleanupInvalidTokensFromResponse,
} = {}) {
  if (
    typeof messaging?.sendEachForMulticast !== "function"
  ) {
    throw new TypeError("messaging invalide");
  }

  if (
    cleanupInvalidTokensFromResponse !== undefined
    && typeof cleanupInvalidTokensFromResponse !== "function"
  ) {
    throw new TypeError("cleanup invalide");
  }

  async function sendReminder(
    tokens,
    { title, body, data } = {}
  ) {
    if (
      !Array.isArray(tokens)
      || tokens.length === 0
      || tokens.some(
        token => typeof token !== "string" || !token
      )
    ) {
      throw new MatchReminderSendError(
        "REMINDER_NO_VALID_TOKENS"
      );
    }

    const safeData = Object.fromEntries(
      Object.entries(data || {}).map(
        ([key, value]) => [key, String(value)]
      )
    );

    // Même format de notification que send() :
    // on ne change pas l'affichage iOS/Android.
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: safeData,
      android: {
        priority: "high",
        notification: {
          channelId: "matches",
          sound: "default",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    const results = response?.responses;

    // La réponse FCM doit être cohérente avec
    // les tokens soumis. Sinon, pas de confirmation.
    if (
      !Array.isArray(results)
      || results.length !== tokens.length
      || results.some(
        result => typeof result?.success !== "boolean"
      )
    ) {
      throw new MatchReminderSendError(
        "REMINDER_INVALID_FCM_RESPONSE"
      );
    }

    const successCount = results.filter(
      result => result.success
    ).length;

    const failureCount = results.length - successCount;

    if (failureCount > 0) {
      // Le nettoyage des tokens est secondaire.
      // Une erreur de nettoyage ne doit pas
      // masquer un succès ou un échec FCM.
      if (cleanupInvalidTokensFromResponse) {
        try {
          await cleanupInvalidTokensFromResponse(
            tokens,
            response,
            { sender: "matchReminderV2" }
          );
        } catch (error) {
          logger?.warn?.(
            "match reminder token cleanup failed",
            { error: String(error?.message ?? error) }
          );
        }
      }

      logger?.warn?.(
        "match reminder multicast partial failure",
        { successCount, failureCount }
      );
    }

    if (successCount === 0) {
      throw new MatchReminderSendError(
        "REMINDER_FCM_ALL_TOKENS_FAILED",
        { successCount, failureCount }
      );
    }

    return {
      accepted: true,
      successCount,
      failureCount,
    };
  }

  return { sendReminder };
}
