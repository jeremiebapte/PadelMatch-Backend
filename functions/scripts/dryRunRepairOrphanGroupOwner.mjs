import {
  applicationDefault,
  initializeApp,
} from "firebase-admin/app";

import {
  getFirestore,
} from "firebase-admin/firestore";

import {
  selectOwnershipSuccessor,
} from "../domain/groups/GroupOwnerLifecycleService.js";

const projectId =
  process.env.GCLOUD_PROJECT
  || "padelmatch-32186";

const groupId =
  process.env.GROUP_ID;

const oldOwnerUid =
  process.env.OLD_OWNER_UID;

initializeApp({
  credential: applicationDefault(),
  projectId,
});

const db = getFirestore();

const groupSnap =
  await db
    .collection("groups")
    .doc(groupId)
    .get();

if (!groupSnap.exists) {
  throw new Error("GROUP_NOT_FOUND");
}

const group =
  groupSnap.data() ?? {};

if (
  group.status !== "active"
  || group.ownerUid !== oldOwnerUid
) {
  throw new Error(
    "GROUP_STATE_CHANGED_SINCE_AUDIT"
  );
}

const membershipsSnap =
  await db
    .collection("groupMemberships")
    .where("groupId", "==", groupId)
    .where("status", "==", "active")
    .get();

const memberships =
  membershipsSnap.docs.map(
    (doc) => doc.data() ?? {}
  );

const successor =
  selectOwnershipSuccessor({
    memberships,
    departingOwnerUid:
      oldOwnerUid,
  });

if (!successor) {
  throw new Error(
    "NO_SUCCESSOR_FOUND"
  );
}

const successorUid =
  successor.userId;

const userSnap =
  await db
    .collection("users")
    .doc(successorUid)
    .get();

const user =
  userSnap.exists
    ? userSnap.data() ?? {}
    : {};

console.log(
  "=============================================="
);
console.log(
  "ORPHAN GROUP OWNER REPAIR — DRY RUN"
);
console.log(
  "=============================================="
);

console.log(
  JSON.stringify(
    {
      groupId,
      groupName:
        group.name
        || group.title
        || "",
      oldOwnerUid,
      successorUid,
      successorRoleBefore:
        successor.role,
      successorPseudo:
        user.pseudo
        || successor.userPseudoSnapshot
        || successor.pseudoSnapshot
        || "",
      successorUserExists:
        userSnap.exists,
      activeMembershipCount:
        memberships.length,
      action:
        "TRANSFER_OWNERSHIP",
    },
    null,
    2
  )
);

console.log();
console.log(
  "AUCUNE ÉCRITURE EFFECTUÉE"
);
