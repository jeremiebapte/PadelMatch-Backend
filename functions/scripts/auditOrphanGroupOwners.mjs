/*
 * Padima — auditOrphanGroupOwners
 *
 * DRY-RUN UNIQUEMENT.
 *
 * Recherche les groupes actifs dont ownerUid ne pointe plus
 * vers un document users/<uid>.
 *
 * Ce script n'effectue AUCUNE écriture.
 */

import {
  applicationDefault,
  initializeApp,
} from "firebase-admin/app";

import {
  getFirestore,
} from "firebase-admin/firestore";


const PROJECT_ID =
  process.env.GCLOUD_PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT
  || "padelmatch-32186";


initializeApp({
  credential:
    applicationDefault(),

  projectId:
    PROJECT_ID,
});


const db =
  getFirestore();


function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


console.log(
  "============================================================"
);

console.log(
  "PADIMA — AUDIT GROUPES ORPHELINS — DRY RUN"
);

console.log(
  `project=${PROJECT_ID}`
);

console.log(
  "AUCUNE ÉCRITURE NE SERA EFFECTUÉE"
);

console.log(
  "============================================================"
);


const groupsSnapshot =
  await db
    .collection("groups")
    .where(
      "status",
      "==",
      "active"
    )
    .get();


let checked = 0;
let orphanCount = 0;

const orphans = [];


for (
  const groupDocument
  of groupsSnapshot.docs
) {
  const group =
    groupDocument.data() ?? {};

  const groupId =
    asString(group.groupId)
    || groupDocument.id;

  const ownerUid =
    asString(group.ownerUid);

  checked += 1;

  if (!ownerUid) {
    orphanCount += 1;

    orphans.push({
      groupId,
      ownerUid: "",
      reason:
        "missing_owner_uid",
      name:
        asString(group.name)
        || asString(group.title),
    });

    continue;
  }

  const ownerSnapshot =
    await db
      .collection("users")
      .doc(ownerUid)
      .get();

  if (ownerSnapshot.exists) {
    continue;
  }

  orphanCount += 1;

  const membershipsSnapshot =
    await db
      .collection(
        "groupMemberships"
      )
      .where(
        "groupId",
        "==",
        groupId
      )
      .where(
        "status",
        "==",
        "active"
      )
      .get();

  const memberships =
    membershipsSnapshot.docs
      .map(
        (document) =>
          document.data() ?? {}
      );

  const admins =
    memberships.filter(
      (membership) =>
        asString(
          membership.userId
        ) !== ownerUid
        && membership.role
          === "admin"
    );

  const members =
    memberships.filter(
      (membership) =>
        asString(
          membership.userId
        ) !== ownerUid
        && membership.role
          === "member"
    );

  orphans.push({
    groupId,
    name:
      asString(group.name)
      || asString(group.title),
    ownerUid,
    reason:
      "owner_user_missing",
    activeMembershipCount:
      memberships.length,
    adminCandidates:
      admins.length,
    memberCandidates:
      members.length,
  });
}


console.log();
console.log(
  `activeGroupsChecked=${checked}`
);

console.log(
  `orphanGroups=${orphanCount}`
);

console.log();


for (const orphan of orphans) {
  console.log(
    JSON.stringify(
      orphan,
      null,
      2
    )
  );
}


console.log();
console.log(
  "============================================================"
);

console.log(
  "DRY RUN TERMINÉ — 0 écriture"
);

console.log(
  "============================================================"
);


process.exit(0);
