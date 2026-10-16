const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 200;

export function buildMatchReminderConfirmationV2({
  deliveryStore,
  logger,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxAttempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
} = {}) {
  if (typeof deliveryStore?.markSent !== "function") {
    throw new TypeError("deliveryStore invalide");
  }

  if (
    typeof sleep !== "function"
    || !Number.isSafeInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > 5
    || !Number.isSafeInteger(delayMs)
    || delayMs < 0
  ) {
    throw new TypeError("configuration de confirmation invalide");
  }

  async function confirm(delivery) {
    if (
      typeof delivery?.id !== "string"
      || !delivery.id
      || typeof delivery?.claimId !== "string"
      || !delivery.claimId
    ) {
      throw new TypeError("delivery invalide");
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // On confirme uniquement le registre.
        // Aucun appel FCM n'existe dans cette fonction.
        const confirmed = await deliveryStore.markSent(delivery);

        // false signifie que la réservation n'est plus
        // confirmable. Il ne faut pas insister.
        if (confirmed === false) {
          logger?.warn?.(
            "match reminder confirmation rejected",
            { deliveryId: delivery.id, attempt }
          );
          return false;
        }

        if (confirmed !== true) {
          throw new TypeError(
            "markSent doit retourner un booléen"
          );
        }

        return true;
      } catch (error) {
        logger?.warn?.(
          "match reminder confirmation attempt failed",
          {
            deliveryId: delivery.id,
            attempt,
            maxAttempts,
            error: String(error?.message ?? error),
          }
        );

        if (attempt === maxAttempts) {
          throw error;
        }

        await sleep(delayMs);
      }
    }

    throw new Error("confirmation unreachable");
  }

  return { confirm };
}
