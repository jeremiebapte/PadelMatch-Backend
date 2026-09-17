// ======================================================
// Padima — Match Distribution V2
//
// Permet au propriétaire d'un match existant :
// - de rendre le match public ;
// - de le publier dans un autre groupe.
//
// Le match reste unique : aucun document match dupliqué.
//
// Les mutations du match utilisent une transaction Firestore
// afin d'éviter les pertes de mise à jour concurrentes.
// ======================================================

import {
  GroupPermissionError,
  assertCanCreateMatch,
  createGroupActivityRecorder,
  membershipDocumentId,
  recordMatchCreated,
  validateGroupId,
} from "./domain/groups/index.js";

import {
  addMatchDistributionGroup,
  makeMatchPublic,
  normalizeMatchDistribution,
  sameMatchDistribution,
} from "./domain/matches/MatchDistribution.js";


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

  const [
    groupSnapshot,
    membershipSnapshot,
  ] = await Promise.all([
    db
      .collection("groups")
      .doc(groupId)
      .get(),

    db
      .collection("groupMemberships")
      .doc(membershipId)
      .get(),
  ]);

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


export function buildUpdateMatchDistribution({
  onCall,
  HttpsError,
  runtime,
  db,
  FieldValue,
  logger,
  notifyGroupMatchCreated,
}) {
  const recordGroupActivity =
    createGroupActivityRecorder({
      db,
      logger,
    });

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

      let targetGroupContext =
        null;

      if (targetGroupId) {
        targetGroupContext =
          await assertCanDistributeToGroup({
            db,
            uid,
            groupId:
              targetGroupId,
            HttpsError,
          });
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
                targetGroupAdded:
                  false,
                origin:
                  after.origin,
                distribution:
                  after.distribution,
                match,
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

            return {
              changed: true,
              targetGroupAdded,
              origin:
                after.origin,
              distribution:
                after.distribution,
              match: {
                ...match,
                origin:
                  after.origin,
                distribution:
                  after.distribution,
              },
            };
          }
        );

      if (
        result.targetGroupAdded
        && targetGroupId
      ) {
        const creatorProfile = {
          pseudo:
            asString(
              result.match
                ?.createurPseudo
            ),

          avatar:
            asString(
              result.match
                ?.createurAvatar
            ),
        };

        try {
          await recordMatchCreated({
            groupId:
              targetGroupId,

            matchId,

            uid,

            creatorProfile,

            match:
              result.match,

            recordGroupActivity,
            db,
            FieldValue,
            logger,

            metadata: {
              source:
                "match_distribution",
            },
          });
        } catch (error) {
          logger?.warn?.(
            "updateMatchDistribution group activity ignored failure",
            {
              matchId,
              groupId:
                targetGroupId,
              uid,
              error:
                String(
                  error?.message
                  ?? error
                ),
            }
          );
        }

        if (
          typeof notifyGroupMatchCreated
          === "function"
        ) {
          try {
            await notifyGroupMatchCreated({
              groupId:
                targetGroupId,

              group:
                targetGroupContext
                  ?.group
                  ?? {},

              matchId,

              creatorUid:
                uid,

              creatorProfile,

              match:
                result.match,
            });
          } catch (error) {
            logger?.warn?.(
              "updateMatchDistribution group notification ignored failure",
              {
                matchId,
                groupId:
                  targetGroupId,
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
      }

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
            targetGroupContext
              ?.membershipId
              ?? null,
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
