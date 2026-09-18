// Path: functions/domain/notifications/FcmTokenCleanupService.js
// ======================================================
// Padima — FCM stale token cleanup
//
// Only permanently invalid registration tokens are removed.
// Transient delivery failures are intentionally preserved.
// ======================================================

const PERMANENT_FCM_TOKEN_ERRORS =
  new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ]);


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


export function isPermanentFcmTokenError(
  error
) {
  const code =
    asString(
      error?.code
    );

  return PERMANENT_FCM_TOKEN_ERRORS
    .has(code);
}


export function classifyMulticastFailures(
  tokens,
  response
) {
  const safeTokens =
    Array.isArray(tokens)
      ? tokens
      : [];

  const responses =
    Array.isArray(response?.responses)
      ? response.responses
      : [];

  const permanentlyInvalidTokens =
    [];

  let temporaryFailures = 0;

  responses.forEach(
    (item, index) => {
      if (item?.success === true) {
        return;
      }

      const token =
        asString(
          safeTokens[index]
        );

      if (!token) {
        temporaryFailures += 1;
        return;
      }

      if (
        isPermanentFcmTokenError(
          item?.error
        )
      ) {
        permanentlyInvalidTokens.push(
          token
        );

        return;
      }

      temporaryFailures += 1;
    }
  );

  return {
    permanentlyInvalidTokens: [
      ...new Set(
        permanentlyInvalidTokens
      ),
    ],

    temporaryFailures,
  };
}


export function buildFcmTokenCleanupService({
  db,
  logger,
  maxTrackedTokens = 20000,
}) {
  if (!db) {
    throw new TypeError(
      "DB_REQUIRED"
    );
  }

  const ownersByToken =
    new Map();


  function trimRegistry() {
    while (
      ownersByToken.size
      > maxTrackedTokens
    ) {
      const firstKey =
        ownersByToken
          .keys()
          .next()
          .value;

      if (!firstKey) {
        break;
      }

      ownersByToken.delete(
        firstKey
      );
    }
  }


  function rememberTokenOwners(
    uid,
    tokens
  ) {
    const cleanUid =
      asString(uid);

    if (
      !cleanUid
      || !Array.isArray(tokens)
    ) {
      return;
    }

    for (const rawToken of tokens) {
      const token =
        asString(
          rawToken
        );

      if (!token) {
        continue;
      }

      let owners =
        ownersByToken.get(
          token
        );

      if (!owners) {
        owners =
          new Set();

        ownersByToken.set(
          token,
          owners
        );
      }

      owners.add(
        cleanUid
      );
    }

    trimRegistry();
  }


  async function cleanupInvalidTokensFromResponse(
    tokens,
    response,
    {
      sender = "unknown",
    } = {}
  ) {
    const {
      permanentlyInvalidTokens,
      temporaryFailures,
    } =
      classifyMulticastFailures(
        tokens,
        response
      );

    if (
      !permanentlyInvalidTokens.length
    ) {
      return {
        permanentFailures: 0,
        invalidTokensRemoved: 0,
        temporaryFailures,
      };
    }

    let invalidTokensRemoved = 0;
    let unresolvedPermanentTokens = 0;

    for (
      const token
      of permanentlyInvalidTokens
    ) {
      const owners =
        ownersByToken.get(
          token
        );

      if (
        !owners
        || !owners.size
      ) {
        unresolvedPermanentTokens += 1;

        logger?.warn?.(
          "permanent FCM token has no known owner",
          {
            sender,
          }
        );

        continue;
      }

      for (const uid of owners) {
        try {
          await db
            .collection("users")
            .doc(uid)
            .collection("fcmTokens")
            .doc(token)
            .delete();

          invalidTokensRemoved += 1;
        } catch (error) {
          logger?.warn?.(
            "failed to remove invalid FCM token",
            {
              sender,
              uid,
              error:
                String(
                  error?.message
                  ?? error
                ),
            }
          );
        }
      }

      ownersByToken.delete(
        token
      );
    }

    logger?.info?.(
      "FCM invalid token cleanup completed",
      {
        sender,

        permanentFailures:
          permanentlyInvalidTokens.length,

        invalidTokensRemoved,

        unresolvedPermanentTokens,

        temporaryFailures,
      }
    );

    return {
      permanentFailures:
        permanentlyInvalidTokens.length,

      invalidTokensRemoved,

      unresolvedPermanentTokens,

      temporaryFailures,
    };
  }


  return {
    rememberTokenOwners,
    cleanupInvalidTokensFromResponse,
  };
}
