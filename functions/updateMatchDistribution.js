// ======================================================
// Padima — Match Distribution V2
//
// Permet au propriétaire d'un match existant :
// - de rendre le match public ;
// - de le publier dans un autre groupe.
//
// Le match reste unique : aucun document match dupliqué.
//
// Lot 2C:
// - permissions groupe transactionnelles
// - invariant creator ∈ participants
// - outbox déterministe pour les effets groupe
// ======================================================

import {
  GroupPermissionError,
  assertCanCreateMatch,
  membershipDocumentId,
  validateGroupId,
} from "./domain/groups/index.js";

import {
  addMatchDistributionGroup,
  makeMatchPublic,
  normalizeMatchDistribution,
  sameMatchDistribution,
} from "./domain/matches/MatchDistribution.js";

import {
  MATCH_DISTRIBUTION_EVENT_TYPE,
  MATCH_PUBLIC_DISTRIBUTION_EVENT_TYPE,
  matchDistributionEventId,
  matchPublicDistributionEventId,
} from "./MatchDistributionEffectService.js";


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function normalizeDateMs(value) {
  if (
    typeof value === "number"
    && Number.isFinite(value)
  ) {
    return value;
  }

  if (
    value
    && typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  return null;
}


function participantUid(value) {
  if (typeof value === "string") {
    return asString(value);
  }

  if (
    value
    && typeof value === "object"
  ) {
    return asString(
      value.uid
      || value.userId
      || value.playerUid
      || value.id
    );
  }

  return "";
}


function mapGroupPermissionError(
  error,
  HttpsError
) {
  if (
    !(error instanceof GroupPermissionError)
  ) {
    throw error;
  }

  switch (error.code) {
    case "GROUP_NOT_ACTIVE":
      throw new HttpsError(
        "failed-precondition",
        "GROUP_NOT_ACTIVE"
      );

    case "MATCH_CREATION_NOT_ALLOWED":
    case "ACTIVE_MEMBERSHIP_REQUIRED":
      throw new HttpsError(
        "permission-denied",
        error.code
      );

    default:
      throw new HttpsError(
        "permission-denied",
        "GROUP_PERMISSION_DENIED"
      );
  }
}


async function assertCanDistributeToGroup({
  tx,
  db,
  uid,
  groupId,
  HttpsError,
}) {
  const membershipId =
    membershipDocumentId(
      groupId,
      uid
    );

  const groupRef =
    db
      .collection("groups")
      .doc(groupId);

  const membershipRef =
    db
      .collection(
        "groupMemberships"
      )
      .doc(membershipId);

  // IMPORTANT:
  // Both reads happen inside the SAME transaction
  // that will mutate match.distribution.
  const groupSnapshot =
    await tx.get(
      groupRef
    );

  const membershipSnapshot =
    await tx.get(
      membershipRef
    );

  if (!groupSnapshot.exists) {
    throw new HttpsError(
      "not-found",
      "GROUP_NOT_FOUND"
    );
  }

  if (!membershipSnapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "GROUP_MEMBERSHIP_NOT_FOUND"
    );
  }

  const group =
    groupSnapshot.data()
    || {};

  const membership =
    membershipSnapshot.data()
    || {};

  try {
    assertCanCreateMatch(
      group,
      membership
    );
  } catch (error) {
    mapGroupPermissionError(
      error,
      HttpsError
    );
  }

  return {
    group,
    membership,
    membershipId,
  };
}


async function assertMatchOwner({
  tx,
  db,
  match,
  uid,
  HttpsError,
}) {
  const createdByType =
    asString(
      match.createdByType
      || "player"
    );

  if (
    createdByType !== "club"
  ) {
    if (
      asString(match.createurUid)
      !== uid
    ) {
      throw new HttpsError(
        "permission-denied",
        "NOT_MATCH_OWNER"
      );
    }

    return;
  }

  const clubId =
    asString(
      match.clubId
      || match.createdById
    );

  if (!clubId) {
    throw new HttpsError(
      "failed-precondition",
      "CLUB_NOT_FOUND"
    );
  }

  const clubRef =
    db
      .collection("clubs")
      .doc(clubId);

  const clubSnapshot =
    await tx.get(
      clubRef
    );

  if (!clubSnapshot.exists) {
    throw new HttpsError(
      "failed-precondition",
      "CLUB_NOT_FOUND"
    );
  }

  const adminUid =
    asString(
      clubSnapshot
        .data()
        ?.adminUid
    );

  if (adminUid !== uid) {
    throw new HttpsError(
      "permission-denied",
      "NOT_CLUB_OWNER"
    );
  }
}


function assertCreatorParticipantInvariant({
  match,
  HttpsError,
}) {
  const createdByType =
    asString(
      match.createdByType
      || "player"
    );

  if (createdByType === "club") {
    return;
  }

  const creatorUid =
    asString(
      match.createurUid
    );

  const participants =
    Array.isArray(
      match.participants
    )
      ? match.participants
      : [];

  const creatorPresent =
    creatorUid
    && participants.some(
      (participant) =>
        participantUid(
          participant
        ) === creatorUid
    );

  if (!creatorPresent) {
    throw new HttpsError(
      "failed-precondition",
      "MATCH_CREATOR_NOT_PARTICIPANT"
    );
  }
}


export function buildUpdateMatchDistribution({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
}) {
  return onCall(
    runtime,
    async (req) => {
      const uid =
        asString(req.auth?.uid);

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "UNAUTHENTICATED"
        );
      }

      const matchId =
        asString(
          req.data?.matchId
        );

      if (!matchId) {
        throw new HttpsError(
          "invalid-argument",
          "MATCH_ID_REQUIRED"
        );
      }

      const makePublic =
        req.data?.makePublic === true;

      const rawGroupId =
        asString(
          req.data?.groupId
        );

      if (
        !makePublic
        && !rawGroupId
      ) {
        throw new HttpsError(
          "invalid-argument",
          "DISTRIBUTION_CHANGE_REQUIRED"
        );
      }

      let targetGroupId =
        null;

      if (rawGroupId) {
        try {
          targetGroupId =
            validateGroupId(
              rawGroupId
            );
        } catch {
          throw new HttpsError(
            "invalid-argument",
            "INVALID_GROUP_ID"
          );
        }
      }

      const matchRef =
        db
          .collection("matches")
          .doc(matchId);

      const result =
        await db.runTransaction(
          async (tx) => {
            const matchSnapshot =
              await tx.get(
                matchRef
              );

            if (!matchSnapshot.exists) {
              throw new HttpsError(
                "not-found",
                "MATCH_NOT_FOUND"
              );
            }

            const match =
              matchSnapshot.data()
              || {};

            await assertMatchOwner({
              tx,
              db,
              match,
              uid,
              HttpsError,
            });

            assertCreatorParticipantInvariant({
              match,
              HttpsError,
            });

            let targetGroupContext =
              null;

            if (targetGroupId) {
              targetGroupContext =
                await assertCanDistributeToGroup({
                  tx,
                  db,
                  uid,
                  groupId:
                    targetGroupId,
                  HttpsError,
                });
            }

            const dateHeure =
              normalizeDateMs(
                match.dateHeure
              );

            if (
              dateHeure !== null
              && dateHeure <= Date.now()
            ) {
              throw new HttpsError(
                "failed-precondition",
                "MATCH_PAST"
              );
            }

            const before =
              normalizeMatchDistribution(
                match
              );

            const wasAlreadyPublic =
              before
                .distribution
                .public === true;

            const wasAlreadyInTargetGroup =
              targetGroupId
                ? before
                    .distribution
                    .groupIds
                    .includes(
                      targetGroupId
                    )
                : false;

            let after =
              before;

            if (makePublic) {
              after =
                makeMatchPublic({
                  ...match,
                  origin:
                    after.origin,
                  distribution:
                    after.distribution,
                });
            }

            if (targetGroupId) {
              after =
                addMatchDistributionGroup(
                  {
                    ...match,
                    origin:
                      after.origin,
                    distribution:
                      after.distribution,
                  },
                  targetGroupId
                );
            }

            const changed =
              !sameMatchDistribution(
                {
                  ...match,
                  origin:
                    before.origin,
                  distribution:
                    before.distribution,
                },
                {
                  ...match,
                  origin:
                    after.origin,
                  distribution:
                    after.distribution,
                }
              );

            const publicAdded =
              Boolean(
                !wasAlreadyPublic
                && after
                  .distribution
                  .public === true
              );

            const targetGroupAdded =
              Boolean(
                targetGroupId
                && !wasAlreadyInTargetGroup
                && after
                  .distribution
                  .groupIds
                  .includes(
                    targetGroupId
                  )
              );

            if (!changed) {
              return {
                changed: false,

                origin:
                  after.origin,

                distribution:
                  after.distribution,

                publicAdded:
                  false,

                targetGroupAdded:
                  false,

                targetGroupMembershipId:
                  targetGroupContext
                    ?.membershipId
                  ?? null,
              };
            }

            tx.set(
              matchRef,
              {
                origin:
                  after.origin,

                distribution:
                  after.distribution,

                distributionUpdatedAt:
                  FieldValue
                    .serverTimestamp(),

                updatedAt:
                  FieldValue
                    .serverTimestamp(),
              },
              {
                merge: true,
              }
            );

            const matchAfter = {
              ...match,
              origin:
                after.origin,
              distribution:
                after.distribution,
            };

            if (publicAdded) {
              const eventId =
                matchPublicDistributionEventId(
                  matchId
                );

              const eventRef =
                db
                  .collection(
                    "matchDistributionEvents"
                  )
                  .doc(eventId);

              tx.create(
                eventRef,
                {
                  eventId,

                  schemaVersion: 1,

                  type:
                    MATCH_PUBLIC_DISTRIBUTION_EVENT_TYPE,

                  status:
                    "pending",

                  matchId,

                  actorUid:
                    uid,

                  creatorProfile: {
                    pseudo:
                      asString(
                        match
                          .createurPseudo
                      ),

                    avatar:
                      asString(
                        match
                          .createurAvatar
                      ),
                  },

                  matchSnapshot:
                    matchAfter,

                  createdAt:
                    FieldValue
                      .serverTimestamp(),
                }
              );
            }

            if (
              targetGroupAdded
              && targetGroupId
            ) {
              const eventId =
                matchDistributionEventId(
                  matchId,
                  targetGroupId
                );

              const eventRef =
                db
                  .collection(
                    "matchDistributionEvents"
                  )
                  .doc(eventId);

              tx.create(
                eventRef,
                {
                  eventId,

                  schemaVersion: 1,

                  type:
                    MATCH_DISTRIBUTION_EVENT_TYPE,

                  status:
                    "pending",

                  matchId,

                  groupId:
                    targetGroupId,

                  actorUid:
                    uid,

                  creatorProfile: {
                    pseudo:
                      asString(
                        match
                          .createurPseudo
                      ),

                    avatar:
                      asString(
                        match
                          .createurAvatar
                      ),
                  },

                  matchSnapshot:
                    matchAfter,

                  createdAt:
                    FieldValue
                      .serverTimestamp(),
                }
              );
            }

            return {
              changed: true,

              origin:
                after.origin,

              distribution:
                after.distribution,

              publicAdded,

              targetGroupAdded,

              targetGroupMembershipId:
                targetGroupContext
                  ?.membershipId
                ?? null,
            };
          }
        );

      logger?.info?.(
        result.changed
          ? "updateMatchDistribution ok"
          : "updateMatchDistribution no-op",
        {
          matchId,
          uid,
          makePublic,
          targetGroupId,

          targetGroupMembershipId:
            result
              .targetGroupMembershipId
            ?? null,

          publicAdded:
            result
              .publicAdded
            === true,

          targetGroupAdded:
            result
              .targetGroupAdded
            === true,

          distribution:
            result.distribution,
        }
      );

      return {
        ok: true,

        changed:
          result.changed,

        matchId,

        origin:
          result.origin,

        distribution:
          result.distribution,
      };
    }
  );
}
