// Path: functions/domain/playerInvites/PlayerInviteService.js
// ======================================================
// Padima — Player Invite To Play V1
//
// Création transactionnelle d'une invitation à jouer.
// Aucune notification / Activity ici.
// ======================================================

import {
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";

import {
  PLAYER_INVITE_EXPIRATION_DAYS,
  PLAYER_INVITE_SCHEMA_VERSION,
} from "./PlayerInviteConstants.js";

import {
  PlayerInviteSource,
  PlayerInviteStatus,
} from "./PlayerInviteEnums.js";

import {
  buildPlayerPairKey,
  validateCreatePlayerInviteInput,
} from "./PlayerInviteValidator.js";


export class PlayerInviteServiceError extends Error {
  constructor(
    code,
    field = null
  ) {
    super(code);

    this.name =
      "PlayerInviteServiceError";

    this.code =
      code;

    this.field =
      field;
  }
}


function asString(
  value
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function userPseudo(
  data = {}
) {
  return (
    asString(data.pseudo)
    || asString(data.username)
    || asString(data.displayName)
    || "Joueur Padima"
  );
}


function userAvatar(
  data = {}
) {
  return (
    asString(data.avatar)
    || asString(data.photoUrl)
    || null
  );
}


function expiryTimestamp(
  nowMillis = Date.now()
) {
  return Timestamp.fromMillis(
    nowMillis
      + PLAYER_INVITE_EXPIRATION_DAYS
        * 24
        * 60
        * 60
        * 1000
  );
}


function normalizeDateValue(
  value
) {
  if (value == null) {
    return null;
  }

  if (
    value instanceof Timestamp
  ) {
    return value;
  }

  if (
    value instanceof Date
    && !Number.isNaN(
      value.getTime()
    )
  ) {
    return Timestamp.fromDate(
      value
    );
  }

  if (
    typeof value === "number"
    && Number.isFinite(value)
  ) {
    return Timestamp.fromMillis(
      value
    );
  }

  if (
    typeof value === "string"
    && value.trim()
  ) {
    const parsed =
      Date.parse(value);

    if (!Number.isNaN(parsed)) {
      return Timestamp.fromMillis(
        parsed
      );
    }
  }

  throw new PlayerInviteServiceError(
    "PLAYER_INVITE_INVALID_DATE"
  );
}


export function buildCreatePlayerInvite({
  db,
  now = () => Date.now(),
}) {
  if (!db) {
    throw new Error(
      "PlayerInviteService requires db"
    );
  }

  return async function createPlayerInvite({
    inviterUid,
    input,
  }) {
    const normalized =
      validateCreatePlayerInviteInput(
        input
      );

    const inviteeUid =
      normalized.inviteeUid;

    const pairKey =
      buildPlayerPairKey(
        inviterUid,
        inviteeUid
      );

    const proposedStartAt =
      normalizeDateValue(
        normalized.proposedStartAt
      );

    const proposedEndAt =
      normalizeDateValue(
        normalized.proposedEndAt
      );

    if (
      proposedStartAt
      && proposedEndAt
      && proposedEndAt.toMillis()
        < proposedStartAt.toMillis()
    ) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_INVALID_DATE_RANGE",
        "proposedEndAt"
      );
    }

    const inviterRef =
      db
        .collection("users")
        .doc(inviterUid);

    const inviteeRef =
      db
        .collection("users")
        .doc(inviteeUid);

    const inviteRef =
      db
        .collection("playerInvitations")
        .doc();

    const pairRef =
      db
        .collection(
          "activePlayerInvitePairs"
        )
        .doc(pairKey);

    const createdAtMillis =
      now();

    const expiresAt =
      expiryTimestamp(
        createdAtMillis
      );

    return await db.runTransaction(
      async (tx) => {
        /*
         * Toutes les lectures avant les écritures.
         */
        const [
          inviterSnap,
          inviteeSnap,
          pairSnap,
        ] = await Promise.all([
          tx.get(inviterRef),
          tx.get(inviteeRef),
          tx.get(pairRef),
        ]);

        if (!inviterSnap.exists) {
          throw new PlayerInviteServiceError(
            "PLAYER_INVITER_NOT_FOUND"
          );
        }

        if (!inviteeSnap.exists) {
          throw new PlayerInviteServiceError(
            "PLAYER_INVITEE_NOT_FOUND"
          );
        }

        const inviter =
          inviterSnap.data() ?? {};

        const invitee =
          inviteeSnap.data() ?? {};

        /*
         * La découvrabilité est vérifiée uniquement
         * au moment de la création.
         */
        if (
          invitee.isDiscoverable
          !== true
        ) {
          throw new PlayerInviteServiceError(
            "PLAYER_INVITEE_NOT_DISCOVERABLE"
          );
        }

        let staleInvitationRef = null;
        let staleInvitationSnap = null;

        if (pairSnap.exists) {
          const activePair =
            pairSnap.data() ?? {};

          if (
            activePair.status
            === PlayerInviteStatus.PENDING
          ) {
            const activeInvitationId =
              typeof activePair.invitationId
                === "string"
                ? activePair.invitationId.trim()
                : "";

            /*
             * Un verrou pending normal pointe toujours
             * vers l'invitation qu'il protège.
             *
             * On relit cette invitation AVANT toute écriture
             * afin de respecter les contraintes transactionnelles
             * Firestore.
             */
            if (activeInvitationId) {
              staleInvitationRef =
                db
                  .collection(
                    "playerInvitations"
                  )
                  .doc(
                    activeInvitationId
                  );

              staleInvitationSnap =
                await tx.get(
                  staleInvitationRef
                );
            }

            const staleInvitation =
              staleInvitationSnap?.exists
                ? (
                    staleInvitationSnap
                      .data()
                    ?? {}
                  )
                : {};

            const pairExpiryMillis =
              activePair.expiresAt
              && typeof activePair
                .expiresAt
                .toMillis
                === "function"
                ? activePair
                    .expiresAt
                    .toMillis()
                : null;

            const invitationExpiryMillis =
              staleInvitation.expiresAt
              && typeof staleInvitation
                .expiresAt
                .toMillis
                === "function"
                ? staleInvitation
                    .expiresAt
                    .toMillis()
                : null;

            const activeExpiryMillis =
              pairExpiryMillis
              ?? invitationExpiryMillis;

            /*
             * En l'absence d'une expiration exploitable,
             * on reste conservateur : on considère le verrou
             * actif afin de ne jamais créer deux invitations
             * pending simultanément.
             */
            if (
              activeExpiryMillis === null
              || activeExpiryMillis
                > createdAtMillis
            ) {
              throw new PlayerInviteServiceError(
                "PLAYER_INVITE_ALREADY_PENDING"
              );
            }

            /*
             * Le verrou est expiré.
             *
             * Si l'ancienne invitation est encore pending
             * et correspond bien à cette paire, on la ferme
             * proprement en "expired".
             */
            if (
              staleInvitationSnap?.exists
              && staleInvitation.status
                === PlayerInviteStatus.PENDING
              && staleInvitation.pairKey
                === pairKey
            ) {
              tx.update(
                staleInvitationRef,
                {
                  status:
                    PlayerInviteStatus.EXPIRED,

                  updatedAt:
                    FieldValue
                      .serverTimestamp(),
                }
              );
            }

            /*
             * Le nouveau tx.create(pairRef, ...)
             * remplacera logiquement ce verrou.
             *
             * Comme le document existe encore,
             * on le supprime d'abord puis on le recrée
             * dans la même transaction.
             */
            tx.delete(
              pairRef
            );

          } else {
            /*
             * Filet de sécurité :
             * un verrou résiduel non pending ne doit
             * pas empêcher définitivement la paire.
             */
            tx.delete(
              pairRef
            );
          }
        }

        const invitation = {
          schemaVersion:
            PLAYER_INVITE_SCHEMA_VERSION,

          inviterUid,
          inviteeUid,

          pairKey,

          inviterPseudoSnapshot:
            userPseudo(inviter),

          inviterAvatarSnapshot:
            userAvatar(inviter),

          inviteePseudoSnapshot:
            userPseudo(invitee),

          inviteeAvatarSnapshot:
            userAvatar(invitee),

          status:
            PlayerInviteStatus.PENDING,

          scheduleKind:
            normalized.scheduleKind,

          proposedStartAt,

          proposedEndAt,

          timePreference:
            normalized.timePreference,

          clubId:
            normalized.clubId,

          clubNameSnapshot:
            normalized.clubName,

          placeLabel:
            normalized.placeLabel,

          message:
            normalized.message,

          source:
            PlayerInviteSource.EXPLORER,

          createdAt:
            FieldValue.serverTimestamp(),

          updatedAt:
            FieldValue.serverTimestamp(),

          expiresAt,

          acceptedAt:
            null,

          declinedAt:
            null,

          cancelledAt:
            null,

          conversationId:
            null,
        };

        const pairLock = {
          schemaVersion:
            PLAYER_INVITE_SCHEMA_VERSION,

          pairKey,

          invitationId:
            inviteRef.id,

          inviterUid,

          inviteeUid,

          status:
            PlayerInviteStatus.PENDING,

          createdAt:
            FieldValue.serverTimestamp(),

          expiresAt,
        };

        tx.create(
          inviteRef,
          invitation
        );

        tx.set(
          pairRef,
          pairLock
        );

        return {
          invitationId:
            inviteRef.id,

          pairKey,

          status:
            PlayerInviteStatus.PENDING,

          expiresAtMillis:
            expiresAt.toMillis(),
        };
      }
    );
  };
}


// ======================================================
// PLAYER INVITE ACTIONS
// accept / decline / cancel
// ======================================================

function invitationExpired(
  invitation,
  nowMillis
) {
  const expiresAt =
    invitation?.expiresAt;

  return (
    expiresAt instanceof Timestamp
    && expiresAt.toMillis()
      <= nowMillis
  );
}


async function expireInvitationIfNeeded({
  tx,
  invitationRef,
  pairRef,
  invitation,
  nowMillis,
}) {
  if (
    !invitationExpired(
      invitation,
      nowMillis
    )
  ) {
    return false;
  }

  tx.update(
    invitationRef,
    {
      status:
        PlayerInviteStatus.EXPIRED,

      updatedAt:
        FieldValue.serverTimestamp(),
    }
  );

  tx.delete(
    pairRef
  );

  return true;
}


function assertPendingInvitation(
  invitation
) {
  if (
    invitation.status
    !== PlayerInviteStatus.PENDING
  ) {
    throw new PlayerInviteServiceError(
      "PLAYER_INVITE_NOT_PENDING"
    );
  }
}


export function buildAcceptPlayerInvite({
  db,
  now = () => Date.now(),
}) {
  if (!db) {
    throw new Error(
      "buildAcceptPlayerInvite requires db"
    );
  }

  return async function acceptPlayerInvite({
    actorUid,
    invitationId,
  }) {
    const cleanInvitationId =
      asString(invitationId);

    if (!cleanInvitationId) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_ID_REQUIRED",
        "invitationId"
      );
    }

    const invitationRef =
      db
        .collection(
          "playerInvitations"
        )
        .doc(
          cleanInvitationId
        );

    const result =
      await db.runTransaction(
        async (tx) => {
          const invitationSnap =
            await tx.get(
              invitationRef
            );

          if (!invitationSnap.exists) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_NOT_FOUND"
            );
          }

          const invitation =
            invitationSnap.data() ?? {};

          if (
            invitation.inviteeUid
            !== actorUid
          ) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_FORBIDDEN"
            );
          }

          assertPendingInvitation(
            invitation
          );

          const pairKey =
            asString(
              invitation.pairKey
            );

          if (!pairKey) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_PAIR_KEY_MISSING"
            );
          }

          const pairRef =
            db
              .collection(
                "activePlayerInvitePairs"
              )
              .doc(pairKey);

          const conversationRef =
            db
              .collection(
                "playerConversations"
              )
              .doc(pairKey);

          /*
           * Toutes les lectures avant les écritures.
           */
          const [
            pairSnap,
            conversationSnap,
          ] =
            await Promise.all([
              tx.get(pairRef),
              tx.get(
                conversationRef
              ),
            ]);

          const nowMillis =
            now();

          if (
            await expireInvitationIfNeeded({
              tx,
              invitationRef,
              pairRef,
              invitation,
              nowMillis,
            })
          ) {
            return {
              expired:
                true,
            };
          }

          const participantUids =
            [
              invitation.inviterUid,
              invitation.inviteeUid,
            ]
              .filter(Boolean)
              .sort();

          if (
            participantUids.length
            !== 2
          ) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_INVALID_PARTICIPANTS"
            );
          }

          if (
            !conversationSnap.exists
          ) {
            tx.create(
              conversationRef,
              {
                schemaVersion:
                  PLAYER_INVITE_SCHEMA_VERSION,

                conversationId:
                  pairKey,

                participantPairKey:
                  pairKey,

                participantUids,

                source:
                  "playerInvite",

                sourceInviteId:
                  cleanInvitationId,

                status:
                  "active",

                createdAt:
                  FieldValue.serverTimestamp(),

                updatedAt:
                  FieldValue.serverTimestamp(),

                lastMessageAt:
                  null,

                lastMessageTextSnapshot:
                  null,
              }
            );

          } else {
            const conversation =
              conversationSnap.data()
              ?? {};

            const existingParticipants =
              Array.isArray(
                conversation
                  .participantUids
              )
                ? conversation
                  .participantUids
                  .filter(Boolean)
                  .sort()
                : [];

            if (
              existingParticipants
                .join("|")
              !== participantUids
                .join("|")
            ) {
              throw new PlayerInviteServiceError(
                "PLAYER_CONVERSATION_PARTICIPANTS_MISMATCH"
              );
            }

            tx.update(
              conversationRef,
              {
                status:
                  "active",

                updatedAt:
                  FieldValue.serverTimestamp(),
              }
            );
          }

          tx.update(
            invitationRef,
            {
              status:
                PlayerInviteStatus.ACCEPTED,

              acceptedAt:
                FieldValue.serverTimestamp(),

              updatedAt:
                FieldValue.serverTimestamp(),

              conversationId:
                conversationRef.id,
            }
          );

          /*
           * Le verrou actif n'a plus d'utilité
           * une fois l'invitation traitée.
           */
          if (pairSnap.exists) {
            tx.delete(
              pairRef
            );
          }

          return {
            expired:
              false,

            invitationId:
              cleanInvitationId,

            status:
              PlayerInviteStatus.ACCEPTED,

            conversationId:
              conversationRef.id,
          };
        }
      );

    if (result.expired) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_EXPIRED"
      );
    }

    return result;
  };
}


export function buildDeclinePlayerInvite({
  db,
  now = () => Date.now(),
}) {
  if (!db) {
    throw new Error(
      "buildDeclinePlayerInvite requires db"
    );
  }

  return async function declinePlayerInvite({
    actorUid,
    invitationId,
  }) {
    const cleanInvitationId =
      asString(invitationId);

    if (!cleanInvitationId) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_ID_REQUIRED",
        "invitationId"
      );
    }

    const invitationRef =
      db
        .collection(
          "playerInvitations"
        )
        .doc(
          cleanInvitationId
        );

    const result =
      await db.runTransaction(
        async (tx) => {
          const invitationSnap =
            await tx.get(
              invitationRef
            );

          if (!invitationSnap.exists) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_NOT_FOUND"
            );
          }

          const invitation =
            invitationSnap.data()
            ?? {};

          if (
            invitation.inviteeUid
            !== actorUid
          ) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_FORBIDDEN"
            );
          }

          assertPendingInvitation(
            invitation
          );

          const pairKey =
            asString(
              invitation.pairKey
            );

          if (!pairKey) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_PAIR_KEY_MISSING"
            );
          }

          const pairRef =
            db
              .collection(
                "activePlayerInvitePairs"
              )
              .doc(pairKey);

          const pairSnap =
            await tx.get(
              pairRef
            );

          if (
            await expireInvitationIfNeeded({
              tx,
              invitationRef,
              pairRef,
              invitation,
              nowMillis:
                now(),
            })
          ) {
            return {
              expired:
                true,
            };
          }

          tx.update(
            invitationRef,
            {
              status:
                PlayerInviteStatus.DECLINED,

              declinedAt:
                FieldValue.serverTimestamp(),

              updatedAt:
                FieldValue.serverTimestamp(),
            }
          );

          if (pairSnap.exists) {
            tx.delete(
              pairRef
            );
          }

          return {
            expired:
              false,

            invitationId:
              cleanInvitationId,

            status:
              PlayerInviteStatus.DECLINED,
          };
        }
      );

    if (result.expired) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_EXPIRED"
      );
    }

    return result;
  };
}


export function buildCancelPlayerInvite({
  db,
  now = () => Date.now(),
}) {
  if (!db) {
    throw new Error(
      "buildCancelPlayerInvite requires db"
    );
  }

  return async function cancelPlayerInvite({
    actorUid,
    invitationId,
  }) {
    const cleanInvitationId =
      asString(invitationId);

    if (!cleanInvitationId) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_ID_REQUIRED",
        "invitationId"
      );
    }

    const invitationRef =
      db
        .collection(
          "playerInvitations"
        )
        .doc(
          cleanInvitationId
        );

    const result =
      await db.runTransaction(
        async (tx) => {
          const invitationSnap =
            await tx.get(
              invitationRef
            );

          if (!invitationSnap.exists) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_NOT_FOUND"
            );
          }

          const invitation =
            invitationSnap.data()
            ?? {};

          if (
            invitation.inviterUid
            !== actorUid
          ) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_FORBIDDEN"
            );
          }

          assertPendingInvitation(
            invitation
          );

          const pairKey =
            asString(
              invitation.pairKey
            );

          if (!pairKey) {
            throw new PlayerInviteServiceError(
              "PLAYER_INVITE_PAIR_KEY_MISSING"
            );
          }

          const pairRef =
            db
              .collection(
                "activePlayerInvitePairs"
              )
              .doc(pairKey);

          const pairSnap =
            await tx.get(
              pairRef
            );

          if (
            await expireInvitationIfNeeded({
              tx,
              invitationRef,
              pairRef,
              invitation,
              nowMillis:
                now(),
            })
          ) {
            return {
              expired:
                true,
            };
          }

          tx.update(
            invitationRef,
            {
              status:
                PlayerInviteStatus.CANCELLED,

              cancelledAt:
                FieldValue.serverTimestamp(),

              updatedAt:
                FieldValue.serverTimestamp(),
            }
          );

          if (pairSnap.exists) {
            tx.delete(
              pairRef
            );
          }

          return {
            expired:
              false,

            invitationId:
              cleanInvitationId,

            status:
              PlayerInviteStatus.CANCELLED,
          };
        }
      );

    if (result.expired) {
      throw new PlayerInviteServiceError(
        "PLAYER_INVITE_EXPIRED"
      );
    }

    return result;
  };
}
