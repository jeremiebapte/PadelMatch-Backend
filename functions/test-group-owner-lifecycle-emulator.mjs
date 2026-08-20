import assert from "node:assert/strict";

import {
  initializeApp,
} from "firebase-admin/app";

import {
  FieldValue,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";

import {
  getAuth,
} from "firebase-admin/auth";

import {
  createGroupActivityRecorder,
} from "./domain/groups/GroupActivityRecorder.js";

import {
  createUserActivityRecorder,
} from "./domain/activity/UserActivityRecorder.js";

import {
  buildHandleUserGroupOwnershipLifecycle,
} from "./domain/groups/GroupOwnerLifecycleService.js";


initializeApp({
  projectId: "padelmatch-32186",
});

const db = getFirestore();
const authAdmin = getAuth();

const logger = {
  info() {},
  warn() {},
  error(...args) {
    console.error(...args);
  },
};

const recordGroupActivity =
  createGroupActivityRecorder({
    db,
    logger,
  });

const recordUserActivity =
  createUserActivityRecorder({
    db,
    logger,
  });

const handleLifecycle =
  buildHandleUserGroupOwnershipLifecycle({
    db,
    FieldValue,
    logger,
    recordGroupActivity,
    recordUserActivity,
    authAdmin,
  });


function ts(seconds) {
  return Timestamp.fromMillis(
    seconds * 1000
  );
}


async function createGroup({
  groupId,
  ownerUid,
  memberships,
}) {
  await db
    .collection("groups")
    .doc(groupId)
    .set({
      groupId,
      name: groupId,
      ownerUid,
      status: "active",
      discoverability: "searchable",
      linkJoinEnabled: true,

      stats: {
        memberCount:
          memberships.filter(
            (membership) =>
              membership.status === "active"
          ).length,
      },

      createdAt: ts(1),
      updatedAt: ts(1),
    });

  for (const membership of memberships) {
    const membershipId =
      `${groupId}_${membership.userId}`;

    /*
     * Le document Firestore peut survivre à la suppression
     * du compte Auth. C'est précisément le cas qu'on doit
     * savoir détecter.
     */
    await db
      .collection("users")
      .doc(membership.userId)
      .set({
        uid:
          membership.userId,
        pseudo:
          membership.userId,
      });

    if (membership.authExists !== false) {
      try {
        await authAdmin.createUser({
          uid:
            membership.userId,
        });
      } catch (error) {
        if (
          error?.code
            !== "auth/uid-already-exists"
        ) {
          throw error;
        }
      }
    }

    await db
      .collection("groupMemberships")
      .doc(membershipId)
      .set({
        membershipId,
        groupId,
        userId:
          membership.userId,
        role:
          membership.role,
        status:
          membership.status ?? "active",

        joinedAt:
          membership.joinedAt,

        createdAt:
          membership.createdAt
          ?? membership.joinedAt,

        updatedAt:
          membership.joinedAt,

        notificationsEnabled: true,
        matchNotificationsEnabled: true,
        messageNotificationsEnabled: true,

        pseudoSnapshot:
          membership.userId,
      });
  }
}


async function group(groupId) {
  const snapshot =
    await db
      .collection("groups")
      .doc(groupId)
      .get();

  assert.equal(
    snapshot.exists,
    true
  );

  return snapshot.data();
}


async function membership(
  groupId,
  uid
) {
  const snapshot =
    await db
      .collection("groupMemberships")
      .doc(`${groupId}_${uid}`)
      .get();

  assert.equal(
    snapshot.exists,
    true
  );

  return snapshot.data();
}


async function ownershipActivities(
  groupId
) {
  const snapshot =
    await db
      .collection("groupActivities")
      .where(
        "groupId",
        "==",
        groupId
      )
      .get();

  return snapshot.docs.map(
    (document) =>
      document.data()
  );
}


console.log(
  "============================================================"
);
console.log(
  "GROUP OWNER LIFECYCLE — FIRESTORE EMULATOR"
);
console.log(
  "============================================================"
);


/*
 * ============================================================
 * CAS 1
 * owner + admin + membre
 * => admin devient owner
 * ============================================================
 */

{
  const groupId =
    "gol_case_1";

  const ownerUid =
    "gol_owner_1";

  await createGroup({
    groupId,
    ownerUid,

    memberships: [
      {
        userId:
          ownerUid,
        role:
          "owner",
        joinedAt:
          ts(1),
      },
      {
        userId:
          "gol_admin_1",
        role:
          "admin",
        joinedAt:
          ts(20),
      },
      {
        userId:
          "gol_member_1",
        role:
          "member",
        joinedAt:
          ts(2),
      },
    ],
  });

  const result =
    await handleLifecycle(
      ownerUid
    );

  assert.equal(
    result.ownershipTransferred,
    1
  );

  const storedGroup =
    await group(groupId);

  assert.equal(
    storedGroup.ownerUid,
    "gol_admin_1"
  );

  assert.equal(
    storedGroup.status,
    "active"
  );

  assert.equal(
    storedGroup.stats.memberCount,
    2
  );

  const newOwner =
    await membership(
      groupId,
      "gol_admin_1"
    );

  assert.equal(
    newOwner.role,
    "owner"
  );

  const oldOwner =
    await membership(
      groupId,
      ownerUid
    );

  assert.equal(
    oldOwner.status,
    "removed"
  );

  console.log(
    "✔ CAS 1 — admin devient owner"
  );
}


/*
 * ============================================================
 * CAS 2
 * plusieurs admins
 * => admin le plus ancien devient owner
 * ============================================================
 */

{
  const groupId =
    "gol_case_2";

  const ownerUid =
    "gol_owner_2";

  await createGroup({
    groupId,
    ownerUid,

    memberships: [
      {
        userId:
          ownerUid,
        role:
          "owner",
        joinedAt:
          ts(1),
      },
      {
        userId:
          "gol_admin_new",
        role:
          "admin",
        joinedAt:
          ts(30),
      },
      {
        userId:
          "gol_admin_old",
        role:
          "admin",
        joinedAt:
          ts(10),
      },
      {
        userId:
          "gol_member_oldest",
        role:
          "member",
        joinedAt:
          ts(2),
      },
    ],
  });

  await handleLifecycle(
    ownerUid
  );

  const storedGroup =
    await group(groupId);

  assert.equal(
    storedGroup.ownerUid,
    "gol_admin_old"
  );

  assert.equal(
    (
      await membership(
        groupId,
        "gol_admin_old"
      )
    ).role,
    "owner"
  );

  assert.equal(
    (
      await membership(
        groupId,
        "gol_admin_new"
      )
    ).role,
    "admin"
  );

  console.log(
    "✔ CAS 2 — admin le plus ancien sélectionné"
  );
}


/*
 * ============================================================
 * CAS 3
 * aucun admin
 * => membre actif le plus ancien devient owner
 * ============================================================
 */

{
  const groupId =
    "gol_case_3";

  const ownerUid =
    "gol_owner_3";

  await createGroup({
    groupId,
    ownerUid,

    memberships: [
      {
        userId:
          ownerUid,
        role:
          "owner",
        joinedAt:
          ts(1),
      },
      {
        userId:
          "gol_member_new",
        role:
          "member",
        joinedAt:
          ts(30),
      },
      {
        userId:
          "gol_member_old",
        role:
          "member",
        joinedAt:
          ts(5),
      },
      {
        userId:
          "gol_member_left",
        role:
          "member",
        status:
          "left",
        joinedAt:
          ts(2),
      },
    ],
  });

  await handleLifecycle(
    ownerUid
  );

  const storedGroup =
    await group(groupId);

  assert.equal(
    storedGroup.ownerUid,
    "gol_member_old"
  );

  assert.equal(
    (
      await membership(
        groupId,
        "gol_member_old"
      )
    ).role,
    "owner"
  );

  assert.equal(
    storedGroup.stats.memberCount,
    2
  );

  console.log(
    "✔ CAS 3 — membre actif le plus ancien sélectionné"
  );
}


/*
 * ============================================================
 * CAS 4
 * owner seul
 * => groupe supprimé logiquement
 * ============================================================
 */

{
  const groupId =
    "gol_case_4";

  const ownerUid =
    "gol_owner_4";

  await createGroup({
    groupId,
    ownerUid,

    memberships: [
      {
        userId:
          ownerUid,
        role:
          "owner",
        joinedAt:
          ts(1),
      },
    ],
  });

  /*
   * Vérifie également le nettoyage des dépendances actives.
   */

  await db
    .collection("groupInvites")
    .doc("gol_invite_4")
    .set({
      inviteId:
        "gol_invite_4",
      groupId,
      status:
        "pending",
    });

  await db
    .collection("groupJoinRequests")
    .doc("gol_request_4")
    .set({
      requestId:
        "gol_request_4",
      groupId,
      status:
        "pending",
    });

  await db
    .collection(
      "groupChatNotificationQueue"
    )
    .doc("gol_queue_4")
    .set({
      groupId,
    });

  const result =
    await handleLifecycle(
      ownerUid
    );

  assert.equal(
    result.groupsDeleted,
    1
  );

  const storedGroup =
    await group(groupId);

  assert.equal(
    storedGroup.status,
    "deleted"
  );

  assert.equal(
    storedGroup.ownerUid,
    ownerUid
  );

  assert.equal(
    storedGroup.stats.memberCount,
    0
  );

  assert.equal(
    storedGroup.discoverability,
    "hidden"
  );

  assert.equal(
    storedGroup.linkJoinEnabled,
    false
  );

  assert.equal(
    storedGroup.deletionReason,
    "owner_account_deleted"
  );

  const oldOwner =
    await membership(
      groupId,
      ownerUid
    );

  assert.equal(
    oldOwner.status,
    "removed"
  );

  const invite =
    await db
      .collection("groupInvites")
      .doc("gol_invite_4")
      .get();

  assert.equal(
    invite.data()?.status,
    "revoked"
  );

  const request =
    await db
      .collection(
        "groupJoinRequests"
      )
      .doc("gol_request_4")
      .get();

  assert.equal(
    request.data()?.status,
    "cancelled"
  );

  const queue =
    await db
      .collection(
        "groupChatNotificationQueue"
      )
      .doc("gol_queue_4")
      .get();

  assert.equal(
    queue.exists,
    false
  );

  console.log(
    "✔ CAS 4 — groupe seul supprimé + cleanup"
  );
}


/*
 * ============================================================
 * ACTIVITÉS
 * ============================================================
 */

{
  const case1 =
    await ownershipActivities(
      "gol_case_1"
    );

  assert.equal(
    case1.some(
      (activity) =>
        activity.type
          === "ownership_transferred"
    ),
    true
  );

  const case4 =
    await ownershipActivities(
      "gol_case_4"
    );

  assert.equal(
    case4.some(
      (activity) =>
        activity.type
          === "group_deleted"
    ),
    true
  );

  console.log(
    "✔ activités ownership_transferred / group_deleted présentes"
  );
}



/*
 * ============================================================
 * CAS 5 — IDEMPOTENCE
 *
 * Après le transfert du CAS 1 :
 * - l'ancien owner ne possède plus le groupe ;
 * - rejouer son lifecycle ne doit rien modifier ;
 * - le nouveau owner doit rester owner.
 * ============================================================
 */

{
  const result =
    await handleLifecycle(
      "gol_owner_1"
    );

  assert.equal(
    result.ownershipTransferred,
    0
  );

  assert.equal(
    result.groupsDeleted,
    0
  );

  assert.equal(
    result.groupsFound,
    0
  );

  const storedGroup =
    await group(
      "gol_case_1"
    );

  assert.equal(
    storedGroup.status,
    "active"
  );

  assert.equal(
    storedGroup.ownerUid,
    "gol_admin_1"
  );

  assert.equal(
    (
      await membership(
        "gol_case_1",
        "gol_admin_1"
      )
    ).role,
    "owner"
  );

  console.log(
    "✔ CAS 5 — rejeu idempotent après transfert"
  );
}



/*
 * ============================================================
 * CAS 6 — CANDIDAT FIRESTORE MAIS AUTH SUPPRIMÉ
 *
 * admin ancien = document users + membership actifs,
 *                mais aucun compte Firebase Auth
 *
 * membre récent = compte Firestore + Auth valide
 *
 * => l'admin mort doit être ignoré
 * => le membre vivant devient owner
 * ============================================================
 */

{
  const groupId =
    "gol_case_6";

  const ownerUid =
    "gol_owner_6";

  await createGroup({
    groupId,
    ownerUid,

    memberships: [
      {
        userId:
          ownerUid,
        role:
          "owner",
        joinedAt:
          ts(1),
      },

      {
        userId:
          "gol_dead_admin_6",
        role:
          "admin",
        joinedAt:
          ts(2),

        /*
         * Le document users existe,
         * mais le compte Auth n'existe pas.
         */
        authExists:
          false,
      },

      {
        userId:
          "gol_live_member_6",
        role:
          "member",
        joinedAt:
          ts(20),
      },
    ],
  });

  const result =
    await handleLifecycle(
      ownerUid
    );

  assert.equal(
    result.ownershipTransferred,
    1
  );

  const storedGroup =
    await group(groupId);

  assert.equal(
    storedGroup.status,
    "active"
  );

  assert.equal(
    storedGroup.ownerUid,
    "gol_live_member_6"
  );

  assert.equal(
    (
      await membership(
        groupId,
        "gol_live_member_6"
      )
    ).role,
    "owner"
  );

  const deadAdmin =
    await membership(
      groupId,
      "gol_dead_admin_6"
    );

  assert.equal(
    deadAdmin.role,
    "admin"
  );

  /*
   * Le compte Auth mort doit être retiré des membres actifs.
   */
  assert.equal(
    deadAdmin.status,
    "removed"
  );

  assert.equal(
    deadAdmin.removalReason,
    "account_missing_during_owner_transfer"
  );

  /*
   * Il ne reste réellement qu'un membre actif valide :
   * le nouveau propriétaire.
   */
  assert.equal(
    storedGroup.stats.memberCount,
    1
  );

  const personalActivities =
    await db
      .collection("userActivities")
      .where(
        "userId",
        "==",
        "gol_live_member_6"
      )
      .get();

  const ownerActivity =
    personalActivities.docs
      .map(
        document =>
          document.data() ?? {}
      )
      .find(
        activity =>
          activity.type
            === "group_member_role_changed"
          && activity.groupId
            === groupId
          && activity.metadata?.action
            === "ownership_transferred"
      );

  assert.ok(
    ownerActivity,
    "activité Centre d'activité propriétaire absente"
  );

  assert.equal(
    ownerActivity.title,
    "Tu prends les commandes 👑"
  );

  assert.equal(
    ownerActivity.subtitle,
    "Suite à la suppression du compte de gol_owner_6, tu deviens propriétaire de « gol_case_6 ». Le groupe continue avec toi !"
  );

  assert.equal(
    ownerActivity.metadata?.previousOwnerPseudo,
    "gol_owner_6"
  );

  assert.equal(
    ownerActivity.sourceType,
    "group_owner_lifecycle"
  );

  assert.equal(
    ownerActivity.metadata?.nextRole,
    "owner"
  );

  console.log(
    "✔ CAS 6 — candidat sans Auth retiré, membre valide promu, memberCount corrigé"
  );

  console.log(
    "✔ CAS 6 — notification Centre d'activité nouveau propriétaire créée"
  );
}



/*
 * ============================================================
 * CAS 7 — RETRY CLEANUP APRÈS SUPPRESSION LOGIQUE
 *
 * Simulation :
 * - la transaction métier a déjà marqué le groupe deleted ;
 * - le cleanup secondaire n'a pas eu lieu ;
 * - memberships/invite/request/queue sont encore présents ;
 * - rejouer le lifecycle doit reprendre uniquement le cleanup.
 * ============================================================
 */

{
  const groupId =
    "gol_case_7";

  const ownerUid =
    "gol_owner_7";

  await createGroup({
    groupId,
    ownerUid,

    memberships: [
      {
        userId:
          ownerUid,
        role:
          "owner",
        joinedAt:
          ts(1),
      },
    ],
  });

  /*
   * Simule une transaction de suppression déjà validée
   * avant un crash du cleanup hors transaction.
   */
  await db
    .collection("groups")
    .doc(groupId)
    .update({
      status:
        "deleted",

      deletionReason:
        "owner_account_deleted",

      deletedByUid:
        ownerUid,

      deletedAt:
        ts(50),

      discoverability:
        "hidden",

      linkJoinEnabled:
        false,

      "stats.memberCount":
        0,
    });

  /*
   * Ces données représentent le cleanup restant à effectuer.
   */
  await db
    .collection("groupInvites")
    .doc("gol_invite_7")
    .set({
      inviteId:
        "gol_invite_7",
      groupId,
      status:
        "pending",
    });

  await db
    .collection("groupJoinRequests")
    .doc("gol_request_7")
    .set({
      requestId:
        "gol_request_7",
      groupId,
      status:
        "pending",
    });

  await db
    .collection(
      "groupChatNotificationQueue"
    )
    .doc("gol_queue_7")
    .set({
      groupId,
    });

  /*
   * Compter les activités AVANT retry :
   * le retry ne doit surtout pas créer un second group_deleted.
   */
  const activitiesBefore =
    await ownershipActivities(
      groupId
    );

  const result =
    await handleLifecycle(
      ownerUid
    );

  assert.equal(
    result.groupsDeleted,
    0
  );

  assert.equal(
    result.results.some(
      item =>
        item.groupId === groupId
        && item.action
          === "group_deleted_cleanup_resume"
    ),
    true
  );

  const storedGroup =
    await group(groupId);

  assert.equal(
    storedGroup.status,
    "deleted"
  );

  assert.equal(
    storedGroup.deletionReason,
    "owner_account_deleted"
  );

  assert.equal(
    storedGroup.ownerUid,
    ownerUid
  );

  const ownerMembership =
    await membership(
      groupId,
      ownerUid
    );

  assert.equal(
    ownerMembership.status,
    "removed"
  );

  const invite =
    await db
      .collection("groupInvites")
      .doc("gol_invite_7")
      .get();

  assert.equal(
    invite.data()?.status,
    "revoked"
  );

  const request =
    await db
      .collection(
        "groupJoinRequests"
      )
      .doc("gol_request_7")
      .get();

  assert.equal(
    request.data()?.status,
    "cancelled"
  );

  const queue =
    await db
      .collection(
        "groupChatNotificationQueue"
      )
      .doc("gol_queue_7")
      .get();

  assert.equal(
    queue.exists,
    false
  );

  const activitiesAfter =
    await ownershipActivities(
      groupId
    );

  assert.equal(
    activitiesAfter.length,
    activitiesBefore.length
  );

  /*
   * Deuxième retry :
   * cleanup déjà terminé => toujours sans effet secondaire.
   */
  const secondRetry =
    await handleLifecycle(
      ownerUid
    );

  assert.equal(
    secondRetry.results.some(
      item =>
        item.groupId === groupId
        && item.action
          === "group_deleted_cleanup_resume"
    ),
    true
  );

  const activitiesAfterSecondRetry =
    await ownershipActivities(
      groupId
    );

  assert.equal(
    activitiesAfterSecondRetry.length,
    activitiesBefore.length
  );

  console.log(
    "✔ CAS 7 — cleanup suppression repris et idempotent"
  );
}


console.log();
console.log(
  "============================================================"
);
console.log(
  "✅ GROUP OWNER LIFECYCLE EMULATOR — 7/7 CAS VALIDÉS"
);
console.log(
  "============================================================"
);

process.exit(0);
