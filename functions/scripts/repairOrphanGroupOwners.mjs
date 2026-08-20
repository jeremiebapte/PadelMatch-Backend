import {
  applicationDefault,
  initializeApp,
} from "firebase-admin/app";

import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

import {
  getAuth,
} from "firebase-admin/auth";

import {
  createGroupActivityRecorder,
} from "../domain/groups/GroupActivityRecorder.js";

import {
  createUserActivityRecorder,
} from "../domain/activity/UserActivityRecorder.js";

import {
  buildHandleUserGroupOwnershipLifecycle,
} from "../domain/groups/GroupOwnerLifecycleService.js";


const PROJECT_ID =
  process.env.GCLOUD_PROJECT
  || "padelmatch-32186";

const APPLY =
  process.argv.includes("--apply");


const EXPECTED = [
  {
    groupId:
      "2ixOPfnz7miYfY2ufKP8",
    name:
      "Padel À Fond",
    ownerUid:
      "YqgPZqxDUYcM0s2aQ5aHQ8r0RIP2",
    action:
      "ownership_transferred",
    successorUid:
      "eX3mMb9Vf0ak9gL5XMO5BbK3XbL2",
  },
  {
    groupId:
      "HITslcbrNeuGh8nRsKDl",
    name:
      "Haina",
    ownerUid:
      "cbJuTv7i4TUVCG7b5fh1MIuxwkh2",
    action:
      "group_deleted",
    successorUid:
      null,
  },
  {
    groupId:
      "SSSexlcDwIAokB5zxw9F",
    name:
      "Les Opps",
    ownerUid:
      "zMUxt61413RlCG612WYRisGWUFf1",
    action:
      "group_deleted",
    successorUid:
      null,
  },
  {
    groupId:
      "YpL1WNmxOjIUCNtd1Wfk",
    name:
      "Les Cocos",
    ownerUid:
      "cbJuTv7i4TUVCG7b5fh1MIuxwkh2",
    action:
      "group_deleted",
    successorUid:
      null,
  },
  {
    groupId:
      "qVb5ZtLemczJVx7S8M1M",
    name:
      "Padel Mous",
    ownerUid:
      "cbJuTv7i4TUVCG7b5fh1MIuxwkh2",
    action:
      "group_deleted",
    successorUid:
      null,
  },
  {
    groupId:
      "rQjwn9nQyu9APg8ts3jW",
    name:
      "Les Foufou",
    ownerUid:
      "cbJuTv7i4TUVCG7b5fh1MIuxwkh2",
    action:
      "group_deleted",
    successorUid:
      null,
  },
  {
    groupId:
      "wu3Drc4aE4i7Prlv6xCv",
    name:
      "Les bettistes",
    ownerUid:
      "cbJuTv7i4TUVCG7b5fh1MIuxwkh2",
    action:
      "ownership_transferred",
    successorUid:
      "ebjeTCbM95Y9yWJcTUXDzTtqnbB3",
  },
];


initializeApp({
  credential:
    applicationDefault(),
  projectId:
    PROJECT_ID,
});


const db =
  getFirestore();

const authAdmin =
  getAuth();


const logger = {
  info(...args) {
    console.log(
      "[INFO]",
      ...args
    );
  },

  warn(...args) {
    console.warn(
      "[WARN]",
      ...args
    );
  },

  error(...args) {
    console.error(
      "[ERROR]",
      ...args
    );
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


function text(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


async function authExists(uid) {
  try {
    await authAdmin.getUser(uid);
    return true;
  } catch (error) {
    if (
      error?.code ===
      "auth/user-not-found"
    ) {
      return false;
    }

    throw error;
  }
}


async function inspectGroup(expected) {
  const groupSnap =
    await db
      .collection("groups")
      .doc(expected.groupId)
      .get();

  if (!groupSnap.exists) {
    throw new Error(
      `PREFLIGHT_GROUP_NOT_FOUND:${expected.groupId}`
    );
  }

  const group =
    groupSnap.data() ?? {};

  if (
    group.status !== "active"
  ) {
    throw new Error(
      `PREFLIGHT_GROUP_NOT_ACTIVE:${expected.groupId}:${group.status}`
    );
  }

  if (
    text(group.ownerUid)
      !== expected.ownerUid
  ) {
    throw new Error(
      `PREFLIGHT_OWNER_CHANGED:${expected.groupId}:${group.ownerUid}`
    );
  }

  /*
   * Le propriétaire cassé doit toujours être absent d'Auth.
   */
  if (
    await authExists(
      expected.ownerUid
    )
  ) {
    throw new Error(
      `PREFLIGHT_OWNER_AUTH_RESTORED:${expected.groupId}`
    );
  }

  const membershipsSnap =
    await db
      .collection(
        "groupMemberships"
      )
      .where(
        "groupId",
        "==",
        expected.groupId
      )
      .where(
        "status",
        "==",
        "active"
      )
      .get();

  const validCandidates = [];

  for (
    const document
    of membershipsSnap.docs
  ) {
    const membership =
      document.data() ?? {};

    const uid =
      text(
        membership.userId
      );

    if (
      !uid
      || uid === expected.ownerUid
      || ![
        "admin",
        "member",
      ].includes(
        membership.role
      )
    ) {
      continue;
    }

    const userSnap =
      await db
        .collection("users")
        .doc(uid)
        .get();

    const valid =
      userSnap.exists
      && await authExists(uid);

    if (valid) {
      validCandidates.push({
        uid,
        role:
          membership.role,
        pseudo:
          text(
            userSnap.data()?.pseudo
          ),
      });
    }
  }

  if (
    expected.action
      === "ownership_transferred"
  ) {
    if (
      validCandidates.length !== 1
      || validCandidates[0].uid
        !== expected.successorUid
    ) {
      throw new Error(
        `PREFLIGHT_SUCCESSOR_CHANGED:${expected.groupId}:${JSON.stringify(validCandidates)}`
      );
    }
  }

  if (
    expected.action
      === "group_deleted"
    && validCandidates.length !== 0
  ) {
    throw new Error(
      `PREFLIGHT_NEW_VALID_SUCCESSOR:${expected.groupId}:${JSON.stringify(validCandidates)}`
    );
  }

  return {
    groupId:
      expected.groupId,

    name:
      text(group.name)
      || text(group.title),

    ownerUid:
      expected.ownerUid,

    expectedAction:
      expected.action,

    successorUid:
      expected.successorUid,

    validCandidates,
  };
}


console.log(
  "============================================================"
);

console.log(
  APPLY
    ? "PADIMA — ORPHAN OWNER REPAIR — APPLY"
    : "PADIMA — ORPHAN OWNER REPAIR — PREVIEW"
);

console.log(
  `project=${PROJECT_ID}`
);

console.log(
  "============================================================"
);


const preview = [];

for (const expected of EXPECTED) {
  preview.push(
    await inspectGroup(expected)
  );
}


console.log();
console.log(
  "=== PREFLIGHT OK ==="
);

for (const item of preview) {
  console.log(
    JSON.stringify(
      item,
      null,
      2
    )
  );
}


if (!APPLY) {
  console.log();
  console.log(
    "PREVIEW TERMINÉ — AUCUNE ÉCRITURE"
  );

  process.exit(0);
}


/*
 * ============================================================
 * APPLY
 *
 * On appelle par ancien owner.
 * Un même ancien owner peut posséder plusieurs groupes.
 * ============================================================
 */

const ownerUids = [
  ...new Set(
    EXPECTED.map(
      item =>
        item.ownerUid
    )
  ),
];


console.log();
console.log(
  "=== APPLICATION ==="
);


for (const ownerUid of ownerUids) {
  console.log();
  console.log(
    `Traitement owner=${ownerUid}`
  );

  const result =
    await handleLifecycle(
      ownerUid
    );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


/*
 * ============================================================
 * POST-CHECK
 * ============================================================
 */

console.log();
console.log(
  "=== POST-CHECK ==="
);


for (const expected of EXPECTED) {
  const snap =
    await db
      .collection("groups")
      .doc(expected.groupId)
      .get();

  const group =
    snap.data() ?? {};

  if (
    expected.action
      === "ownership_transferred"
  ) {
    if (
      group.status !== "active"
      || text(group.ownerUid)
        !== expected.successorUid
    ) {
      throw new Error(
        `POSTCHECK_TRANSFER_FAILED:${expected.groupId}`
      );
    }

    const membershipSnap =
      await db
        .collection(
          "groupMemberships"
        )
        .doc(
          `${expected.groupId}_${expected.successorUid}`
        )
        .get();

    const membership =
      membershipSnap.data() ?? {};

    if (
      membership.status !== "active"
      || membership.role !== "owner"
    ) {
      throw new Error(
        `POSTCHECK_SUCCESSOR_MEMBERSHIP_FAILED:${expected.groupId}`
      );
    }
  } else {
    if (
      group.status !== "deleted"
    ) {
      throw new Error(
        `POSTCHECK_DELETE_FAILED:${expected.groupId}`
      );
    }
  }

  console.log(
    `✔ ${expected.name} — ${expected.action}`
  );
}


console.log();
console.log(
  "✅ RÉPARATION TERMINÉE ET VÉRIFIÉE"
);
