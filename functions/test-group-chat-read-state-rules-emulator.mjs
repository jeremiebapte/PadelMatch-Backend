import {
  initializeApp,
} from "firebase-admin/app";

import {
  getFirestore,
} from "firebase-admin/firestore";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "padelmatch-32186";

const FIRESTORE_HOST =
  process.env.FIRESTORE_EMULATOR_HOST;

const AUTH_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!FIRESTORE_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST manquant"
  );
}

if (!AUTH_HOST) {
  throw new Error(
    "FIREBASE_AUTH_EMULATOR_HOST manquant"
  );
}

initializeApp({
  projectId: PROJECT_ID,
});

const adminDb = getFirestore();

function pass(label) {
  console.log(`PASS — ${label}`);
}

function documentName(path) {
  return (
    `projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${path}`
  );
}

function firestoreBaseUrl() {
  return (
    `http://${FIRESTORE_HOST}` +
    `/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents`
  );
}

async function createUser(label) {
  const response = await fetch(
    `http://${AUTH_HOST}` +
      "/identitytoolkit.googleapis.com/v1/" +
      "accounts:signUp?key=fake-api-key",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email:
          `${label}-${Date.now()}-${Math.random()}` +
          "@padima.test",
        password: "Padima-Test-123!",
        returnSecureToken: true,
      }),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Auth emulator signup failed: ` +
      `${response.status} ${text}`
    );
  }

  const data = JSON.parse(text);

  return {
    uid: data.localId,
    token: data.idToken,
  };
}

async function commit(token, writes) {
  return fetch(
    `${firestoreBaseUrl()}:commit`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        Authorization:
          `Bearer ${token}`,
      },
      body: JSON.stringify({
        writes,
      }),
    }
  );
}

async function expectDenied(
  label,
  operation
) {
  const response = await operation();

  if (response.ok) {
    const body = await response.text();

    throw new Error(
      `${label}: opération autorisée ` +
      `alors qu'elle devait être refusée. ` +
      body
    );
  }

  pass(label);
}

function readStateWrite(
  membershipPath,
  messageId,
  extraFields = {}
) {
  const fields = {
    lastChatReadMessageId: {
      stringValue: messageId,
    },
  };

  const fieldPaths = [
    "lastChatReadMessageId",
  ];

  for (
    const [key, value] of
    Object.entries(extraFields)
  ) {
    fields[key] = value;
    fieldPaths.push(key);
  }

  return {
    update: {
      name:
        documentName(
          membershipPath
        ),
      fields,
    },
    updateMask: {
      fieldPaths,
    },
    updateTransforms: [
      {
        fieldPath:
          "lastChatReadAt",
        setToServerValue:
          "REQUEST_TIME",
      },
    ],
  };
}

async function main() {
  console.log(
    "GROUP CHAT READ-STATE RULES — EMULATOR"
  );

  const owner =
    await createUser("owner");

  const other =
    await createUser("other");

  const groupId =
    `group-read-state-${Date.now()}`;

  const membershipId =
    `${groupId}_${owner.uid}`;

  const membershipPath =
    `groupMemberships/${membershipId}`;

  /*
   * Seed via Admin SDK = bypass Rules.
   */
  await adminDb
    .collection("groupMemberships")
    .doc(membershipId)
    .set({
      membershipId,
      groupId,
      userId: owner.uid,
      role: "member",
      status: "active",
    });

  // ------------------------------------------------------
  // 1 — propriétaire du membership :
  //     les deux champs read-state ensemble + REQUEST_TIME.
  // ------------------------------------------------------

  const allowedResponse =
    await commit(
      owner.token,
      [
        readStateWrite(
          membershipPath,
          "message-001"
        ),
      ]
    );

  if (!allowedResponse.ok) {
    throw new Error(
      "Own read-state update refusé: " +
      `${allowedResponse.status} ` +
      `${await allowedResponse.text()}`
    );
  }

  pass(
    "membre peut écrire son read-state avec REQUEST_TIME"
  );

  // ------------------------------------------------------
  // 2 — un autre utilisateur ne peut pas écrire
  //     le membership du propriétaire.
  // ------------------------------------------------------

  await expectDenied(
    "autre utilisateur ne peut pas modifier ce read-state",
    () =>
      commit(
        other.token,
        [
          readStateWrite(
            membershipPath,
            "message-002"
          ),
        ]
      )
  );

  // ------------------------------------------------------
  // 3 — même le propriétaire ne peut pas profiter du
  //     write read-state pour modifier role/status/etc.
  // ------------------------------------------------------

  await expectDenied(
    "read-state ne peut pas modifier le rôle",
    () =>
      commit(
        owner.token,
        [
          readStateWrite(
            membershipPath,
            "message-003",
            {
              role: {
                stringValue:
                  "admin",
              },
            }
          ),
        ]
      )
  );

  // ------------------------------------------------------
  // 4 — message id vide interdit.
  // ------------------------------------------------------

  await expectDenied(
    "lastChatReadMessageId vide refusé",
    () =>
      commit(
        owner.token,
        [
          readStateWrite(
            membershipPath,
            ""
          ),
        ]
      )
  );

  console.log();
  console.log(
    "PASS — GROUP CHAT READ-STATE RULES COMPLET"
  );
}

main().catch((error) => {
  console.error();
  console.error(
    "FAIL — GROUP CHAT READ-STATE RULES"
  );
  console.error(error);
  process.exit(1);
});
