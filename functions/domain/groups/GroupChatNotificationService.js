// Path: functions/domain/groups/GroupChatNotificationService.js
// ======================================================
// Padima — notifications agrégées des discussions de groupe
//
// Principes :
// - aucune notification immédiate pour chaque message ;
// - un agrégat par groupe et par destinataire ;
// - fenêtre d'agrégation de 60 secondes ;
// - l'auteur est exclu ;
// - les préférences de notification du membre sont respectées ;
// - les conversations privées restent gérées par le système historique.
// ======================================================

import {
  GroupNotificationPreference,
} from "./GroupNotificationRecipientService.js";


export const GROUP_CHAT_NOTIFICATION_QUEUE_COLLECTION =
  "groupChatNotificationQueue";

export const GROUP_CHAT_AGGREGATION_WINDOW_MS =
  60 * 1000;

const MAX_PREVIEW_LENGTH = 120;
const MAX_SENDER_UIDS = 20;
const MAX_RECENT_MESSAGE_IDS = 100;
const MAX_DELIVERY_RETRY_COUNT = 5;
const DELIVERY_RETRY_DELAY_MS = 5 * 60 * 1000;


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function asPositiveInteger(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : 0;
}


function normalizeSenderUids(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(asString)
            .filter(Boolean)
        ),
      ].slice(0, MAX_SENDER_UIDS)
    : [];
}


function normalizePreview(value) {
  return asString(value)
    .replace(/\s+/g, " ")
    .slice(0, MAX_PREVIEW_LENGTH);
}


function normalizeRecentMessageIds(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(asString)
            .filter(Boolean)
        ),
      ].slice(-MAX_RECENT_MESSAGE_IDS)
    : [];
}


function queueDocumentId(
  groupId,
  recipientUid
) {
  return `${groupId}_${recipientUid}`;
}


function validateQueueDependencies({
  db,
  getEligibleGroupRecipients,
}) {
  if (!db) {
    throw new TypeError("DB_REQUIRED");
  }

  if (
    typeof getEligibleGroupRecipients
    !== "function"
  ) {
    throw new TypeError(
      "GET_ELIGIBLE_GROUP_RECIPIENTS_REQUIRED"
    );
  }
}


function validateFlushDependencies({
  db,
  tokensOf,
  sendChatHybrid,
}) {
  if (!db) {
    throw new TypeError("DB_REQUIRED");
  }

  if (typeof tokensOf !== "function") {
    throw new TypeError("TOKENS_OF_REQUIRED");
  }

  if (
    typeof sendChatHybrid
    !== "function"
  ) {
    throw new TypeError(
      "SEND_CHAT_HYBRID_REQUIRED"
    );
  }
}


export function buildQueueGroupChatNotification({
  db,
  FieldValue,
  getEligibleGroupRecipients,
  logger,
  aggregationWindowMs =
    GROUP_CHAT_AGGREGATION_WINDOW_MS,
}) {
  validateQueueDependencies({
    db,
    getEligibleGroupRecipients,
  });

  if (!FieldValue) {
    throw new TypeError("FIELD_VALUE_REQUIRED");
  }

  return async function queueGroupChatNotification({
    groupId,
    senderUid,
    senderPseudo,
    text,
    messageId,
  }) {
    const normalizedGroupId =
      asString(groupId);

    const normalizedSenderUid =
      asString(senderUid);

    const normalizedMessageId =
      asString(messageId);

    if (
      !normalizedGroupId
      || !normalizedSenderUid
      || !normalizedMessageId
    ) {
      logger?.warn?.(
        "group chat notification ignored invalid message",
        {
          groupId:
            normalizedGroupId,
          senderUid:
            normalizedSenderUid,
          messageId:
            normalizedMessageId,
        }
      );

      return {
        queuedRecipientCount: 0,
        skipped: true,
      };
    }

    const recipients =
      await getEligibleGroupRecipients({
        groupId:
          normalizedGroupId,

        preference:
          GroupNotificationPreference
            .MESSAGE,

        excludedUserIds: [
          normalizedSenderUid,
        ],
      });

    if (!recipients.length) {
      logger?.info?.(
        "group chat notification: no eligible recipients",
        {
          groupId:
            normalizedGroupId,
          senderUid:
            normalizedSenderUid,
          messageId:
            normalizedMessageId,
        }
      );

      return {
        queuedRecipientCount: 0,
        skipped: false,
      };
    }

    const groupReference =
      db
        .collection("groups")
        .doc(normalizedGroupId);

    const groupSnapshot =
      await groupReference.get();

    const group =
      groupSnapshot.exists
        ? groupSnapshot.data() || {}
        : {};

    const groupName =
      asString(group.name)
      || asString(group.title)
      || "Votre groupe";

    const normalizedSenderPseudo =
      asString(senderPseudo)
      || "Un membre";

    const preview =
      normalizePreview(text)
      || "Nouveau message";

    const now = new Date();
    const sendAfter =
      new Date(
        now.getTime()
        + aggregationWindowMs
      );

    let queuedRecipientCount = 0;

    for (const membership of recipients) {
      const recipientUid =
        asString(
          membership?.userId
        );

      if (!recipientUid) {
        continue;
      }

      const queueReference =
        db
          .collection(
            GROUP_CHAT_NOTIFICATION_QUEUE_COLLECTION
          )
          .doc(
            queueDocumentId(
              normalizedGroupId,
              recipientUid
            )
          );

      const queued =
        await db.runTransaction(
          async (transaction) => {
            const snapshot =
              await transaction.get(
                queueReference
              );

            const current =
              snapshot.exists
                ? snapshot.data() || {}
                : {};

            const recentMessageIds =
              normalizeRecentMessageIds(
                current.recentMessageIds
              );

            if (
              recentMessageIds.includes(
                normalizedMessageId
              )
            ) {
              logger?.info?.(
                "group chat notification duplicate message ignored",
                {
                  groupId:
                    normalizedGroupId,
                  recipientUid,
                  messageId:
                    normalizedMessageId,
                }
              );

              return false;
            }

            const currentCount =
              asPositiveInteger(
                current.messageCount
              );

            const senderUids =
              normalizeSenderUids([
                ...normalizeSenderUids(
                  current.senderUids
                ),
                normalizedSenderUid,
              ]);

            const version =
              asPositiveInteger(
                current.version
              ) + 1;

            const startsNewWindow =
              currentCount === 0;

            const firstMessageAt =
              !startsNewWindow
              && current.firstMessageAt
                ? current.firstMessageAt
                : now;

            const fixedSendAfter =
              !startsNewWindow
              && current.sendAfter
                ? current.sendAfter
                : sendAfter;

            transaction.set(
              queueReference,
              {
                groupId:
                  normalizedGroupId,

                groupName,

                recipientUid,

                messageCount:
                  currentCount + 1,

                senderUids,

                recentMessageIds:
                  normalizeRecentMessageIds([
                    ...recentMessageIds,
                    normalizedMessageId,
                  ]),

                lastSenderUid:
                  normalizedSenderUid,

                lastSenderPseudo:
                  normalizedSenderPseudo,

                lastPreview:
                  preview,

                lastMessageId:
                  normalizedMessageId,

                firstMessageAt,

                lastMessageAt:
                  now,

                sendAfter:
                  fixedSendAfter,

                status:
                  "pending",

                retryCount:
                  startsNewWindow
                    ? 0
                    : asPositiveInteger(
                        current.retryCount
                      ),

                lastError:
                  null,

                version,

                updatedAt:
                  FieldValue
                    .serverTimestamp(),

                createdAt:
                  current.createdAt
                  || FieldValue
                    .serverTimestamp(),
              },
              {
                merge: true,
              }
            );

            return true;
          }
        );

      if (queued) {
        queuedRecipientCount += 1;
      }
    }

    logger?.info?.(
      "group chat notification queued",
      {
        groupId:
          normalizedGroupId,
        senderUid:
          normalizedSenderUid,
        messageId:
          normalizedMessageId,
        queuedRecipientCount,
        sendAfter:
          sendAfter.toISOString(),
      }
    );

    return {
      queuedRecipientCount,
      skipped: false,
    };
  };
}


function buildNotificationCopy({
  groupName,
  messageCount,
  senderUids,
  lastSenderPseudo,
  lastPreview,
}) {
  const normalizedGroupName =
    asString(groupName)
    || "Votre groupe";

  const count =
    asPositiveInteger(
      messageCount
    );

  const uniqueSenderCount =
    normalizeSenderUids(
      senderUids
    ).length;

  const normalizedPseudo =
    asString(lastSenderPseudo)
    || "Un membre";

  const preview =
    normalizePreview(
      lastPreview
    );

  if (count <= 1) {
    return {
      title:
        normalizedPseudo,

      body:
        preview
        || `Nouveau message dans ${normalizedGroupName}`,
    };
  }

  if (uniqueSenderCount <= 1) {
    return {
      title:
        normalizedGroupName,

      body:
        `${normalizedPseudo} a envoyé ${count} nouveaux messages`,
    };
  }

  const otherSenderCount =
    Math.max(
      uniqueSenderCount - 1,
      1
    );

  return {
    title:
      normalizedGroupName,

    body:
      `${normalizedPseudo} et ${otherSenderCount} autre${otherSenderCount > 1 ? "s" : ""} ont envoyé ${count} nouveaux messages`,
  };
}


export function buildFlushGroupChatNotifications({
  db,
  FieldValue,
  tokensOf,
  sendChatHybrid,
  logger,
}) {
  validateFlushDependencies({
    db,
    tokensOf,
    sendChatHybrid,
  });

  if (!FieldValue) {
    throw new TypeError("FIELD_VALUE_REQUIRED");
  }

  return async function flushGroupChatNotifications({
    now = new Date(),
    limit = 100,
  } = {}) {
    const snapshot =
      await db
        .collection(
          GROUP_CHAT_NOTIFICATION_QUEUE_COLLECTION
        )
        .where(
          "sendAfter",
          "<=",
          now
        )
        .limit(limit)
        .get();

    let claimedCount = 0;
    let sentCount = 0;
    let failedCount = 0;

    for (const document of snapshot.docs) {
      const reference =
        document.ref;

      let claimedPayload = null;

      await db.runTransaction(
        async (transaction) => {
          const freshSnapshot =
            await transaction.get(
              reference
            );

          if (!freshSnapshot.exists) {
            return;
          }

          const current =
            freshSnapshot.data() || {};

          if (
            current.status
              !== "pending"
          ) {
            return;
          }

          const currentSendAfter =
            current.sendAfter
              ?.toDate?.()
            || current.sendAfter;

          if (
            !(currentSendAfter instanceof Date)
            || currentSendAfter > now
          ) {
            return;
          }

          const messageCount =
            asPositiveInteger(
              current.messageCount
            );

          if (!messageCount) {
            transaction.delete(
              reference
            );

            return;
          }

          const claimedVersion =
            asPositiveInteger(
              current.version
            );

          claimedPayload = {
            queueId:
              freshSnapshot.id,

            groupId:
              asString(
                current.groupId
              ),

            groupName:
              asString(
                current.groupName
              ),

            recipientUid:
              asString(
                current.recipientUid
              ),

            messageCount,

            senderUids:
              normalizeSenderUids(
                current.senderUids
              ),

            lastSenderUid:
              asString(
                current.lastSenderUid
              ),

            lastSenderPseudo:
              asString(
                current.lastSenderPseudo
              ),

            lastPreview:
              normalizePreview(
                current.lastPreview
              ),

            lastMessageId:
              asString(
                current.lastMessageId
              ),

            claimedVersion,

            retryCount:
              asPositiveInteger(
                current.retryCount
              ),
          };

          transaction.update(
            reference,
            {
              status:
                "sending",

              claimedVersion,

              messageCount:
                0,

              senderUids:
                [],

              firstMessageAt:
                null,

              claimedAt:
                FieldValue
                  .serverTimestamp(),

              updatedAt:
                FieldValue
                  .serverTimestamp(),
            }
          );
        }
      );

      if (!claimedPayload) {
        continue;
      }

      claimedCount += 1;

      const {
        groupId,
        groupName,
        recipientUid,
        messageCount,
        senderUids,
        lastSenderUid,
        lastSenderPseudo,
        lastPreview,
        lastMessageId,
        claimedVersion,
        retryCount,
      } = claimedPayload;

      let delivered = false;
      let deliveryError = null;

      try {
        const groupReference =
          db
            .collection("groups")
            .doc(groupId);

        const groupSnapshot =
          await groupReference.get();

        const groupData =
          groupSnapshot.exists
            ? groupSnapshot.data() || {}
            : {};

        const groupStillExists =
          groupSnapshot.exists
          && groupData.status
            !== "deleted"
          && groupData.status
            !== "archived";

        if (!groupStillExists) {
          logger?.info?.(
            "group chat notification discarded: group unavailable",
            {
              groupId,
              recipientUid,
              queueId:
                claimedPayload.queueId,
            }
          );

          delivered = true;
        }

        const membershipReference =
          db
            .collection(
              "groupMemberships"
            )
            .doc(
              `${groupId}_${recipientUid}`
            );

        const membershipSnapshot =
          delivered
            ? null
            : await membershipReference.get();

        const membership =
          membershipSnapshot?.exists
            ? membershipSnapshot.data() || {}
            : {};

        const stillEligible =
          !delivered
          && membership.status === "active"
          && membership.groupId === groupId
          && membership.userId === recipientUid
          && membership.notificationsEnabled
            !== false
          && membership.messageNotificationsEnabled
            !== false;

        if (delivered) {
          // Groupe supprimé ou archivé :
          // l'agrégat sera supprimé sans notification.
        } else if (!stillEligible) {
          delivered = true;
        } else {
          const tokens =
            await tokensOf(
              recipientUid
            );

          if (!tokens.length) {
            delivered = true;
          } else {
            const copy =
              buildNotificationCopy({
                groupName,
                messageCount,
                senderUids,
                lastSenderPseudo,
                lastPreview,
              });

            await sendChatHybrid(
              tokens,
              {
                title:
                  copy.title,

                body:
                  copy.body,

                data: {
                  type:
                    "group",

                  subtype:
                    "group_chat_messages",

                  groupId,

                  senderUid:
                    lastSenderUid,

                  messageId:
                    lastMessageId,

                  messageCount:
                    String(
                      messageCount
                    ),

                  senderCount:
                    String(
                      senderUids.length
                    ),

                  title:
                    copy.title,

                  body:
                    copy.body,
                },
              }
            );

            delivered = true;
            sentCount += 1;
          }
        }
      } catch (error) {
        failedCount += 1;
        deliveryError =
          String(
            error?.message
            ?? error
          );

        logger?.warn?.(
          "group chat notification delivery failed",
          {
            groupId,
            recipientUid,
            queueId:
              claimedPayload.queueId,
            error:
              deliveryError,
          }
        );
      }

      await db.runTransaction(
        async (transaction) => {
          const finalSnapshot =
            await transaction.get(
              reference
            );

          if (!finalSnapshot.exists) {
            return;
          }

          const current =
            finalSnapshot.data() || {};

          const version =
            asPositiveInteger(
              current.version
            );

          const hasNewMessages =
            asPositiveInteger(
              current.messageCount
            ) > 0
            || version > claimedVersion;

          if (delivered) {
            if (hasNewMessages) {
              transaction.set(
                reference,
                {
                  status:
                    "pending",

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                },
                {
                  merge: true,
                }
              );
            } else {
              transaction.delete(
                reference
              );
            }

            return;
          }

          const restoredSenderUids =
            normalizeSenderUids([
              ...senderUids,
              ...normalizeSenderUids(
                current.senderUids
              ),
            ]);

          const restoredMessageCount =
            messageCount
            + asPositiveInteger(
              current.messageCount
            );

          const nextRetryCount =
            retryCount + 1;

          const hasMessagesReceivedDuringSend =
            asPositiveInteger(
              current.messageCount
            ) > 0
            || version > claimedVersion;

          const retryExhausted =
            nextRetryCount
            >= MAX_DELIVERY_RETRY_COUNT
            && !hasMessagesReceivedDuringSend;

          transaction.set(
            reference,
            {
              status:
                retryExhausted
                  ? "failed"
                  : "pending",

              messageCount:
                restoredMessageCount,

              senderUids:
                restoredSenderUids,

              lastSenderUid:
                asString(
                  current.lastSenderUid
                )
                || lastSenderUid,

              lastSenderPseudo:
                asString(
                  current.lastSenderPseudo
                )
                || lastSenderPseudo,

              lastPreview:
                normalizePreview(
                  current.lastPreview
                )
                || lastPreview,

              lastMessageId:
                asString(
                  current.lastMessageId
                )
                || lastMessageId,

              retryCount:
                retryExhausted
                  ? nextRetryCount
                  : hasMessagesReceivedDuringSend
                    ? 0
                    : nextRetryCount,

              lastError:
                deliveryError
                || "UNKNOWN_DELIVERY_ERROR",

              failedAt:
                retryExhausted
                  ? FieldValue
                      .serverTimestamp()
                  : null,

              sendAfter:
                retryExhausted
                  ? null
                  : new Date(
                      Date.now()
                      + DELIVERY_RETRY_DELAY_MS
                    ),

              updatedAt:
                FieldValue
                  .serverTimestamp(),
            },
            {
              merge: true,
            }
          );
        }
      );
    }

    logger?.info?.(
      "group chat notification flush completed",
      {
        dueCount:
          snapshot.size,
        claimedCount,
        sentCount,
        failedCount,
      }
    );

    return {
      dueCount:
        snapshot.size,
      claimedCount,
      sentCount,
      failedCount,
    };
  };
}
