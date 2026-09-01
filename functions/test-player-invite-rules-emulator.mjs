import assert from "node:assert/strict";

import {
  initializeApp,
} from "firebase-admin/app";

import {
  getAuth,
} from "firebase-admin/auth";

import {
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";

import {
  buildPlayerPairKey,
} from "./domain/playerInvites/index.js";


const PROJECT_ID =
  "padelmatch-32186";

const FIRESTORE_HOST =
  process.env
    .FIRESTORE_EMULATOR_HOST
  || "127.0.0.1:8080";

const AUTH_HOST =
  process.env
    .FIREBASE_AUTH_EMULATOR_HOST
  || "127.0.0.1:9099";


initializeApp({
  projectId:
    PROJECT_ID,
});


const adminDb =
  getFirestore();

const adminAuth =
  getAuth();


const suffix =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;


const A = {
  uid:
    `rules_player_a_${suffix}`,

  email:
    `rules-player-a-${suffix}@padima.test`,

  password:
    "PadimaTest123!",
};


const B = {
  uid:
    `rules_player_b_${suffix}`,

  email:
    `rules-player-b-${suffix}@padima.test`,

  password:
    "PadimaTest123!",
};


const C = {
  uid:
    `rules_player_c_${suffix}`,

  email:
    `rules-player-c-${suffix}@padima.test`,

  password:
    "PadimaTest123!",
};


const invitationId =
  `invite_${suffix}`;

const pairKey =
  buildPlayerPairKey(
      A.uid,
      B.uid
    );

const conversationId =
  pairKey;


let passed =
  0;


function pass(
  label
) {
  passed += 1;

  console.log(
    `PASS — ${label}`
  );
}


async function createUser(
  user
) {
  await adminAuth.createUser({
    uid:
      user.uid,

    email:
      user.email,

    password:
      user.password,

    emailVerified:
      true,
  });
}


async function signIn(
  user
) {
  const response =
    await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            email:
              user.email,

            password:
              user.password,

            returnSecureToken:
              true,
          }),
      }
    );

  const payload =
    await response.json();

  if (!payload.idToken) {
    throw new Error(
      "AUTH_FAILED "
      + JSON.stringify(
        payload
      )
    );
  }

  return payload.idToken;
}


function firestoreUrl(
  documentPath
) {
  return (
    `http://${FIRESTORE_HOST}`
    + `/v1/projects/${PROJECT_ID}`
    + `/databases/(default)/documents/`
    + documentPath
  );
}


async function firestoreGet(
  token,
  path
) {
  return await fetch(
    firestoreUrl(path),
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    }
  );
}



async function firestoreRunQuery(
  token,
  structuredQuery
) {
  const response =
    await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${token}`,
        },

        body:
          JSON.stringify({
            structuredQuery,
          }),
      }
    );

  const payload =
    await response.text();

  if (!response.ok) {
    const error =
      new Error(
        `Firestore runQuery ${response.status}: ${payload}`
      );

    error.status =
      response.status;

    throw error;
  }

  return payload
    ? JSON.parse(payload)
    : [];
}


async function firestoreCommit(
  token,
  writes
) {
  return await fetch(
    `http://${FIRESTORE_HOST}`
    + `/v1/projects/${PROJECT_ID}`
    + `/databases/(default)/documents:commit`,
    {
      method:
        "POST",

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${token}`,
      },

      body:
        JSON.stringify({
          writes,
        }),
    }
  );
}


function docName(
  path
) {
  return (
    `projects/${PROJECT_ID}`
    + `/databases/(default)/documents/`
    + path
  );
}


async function expectAllowed(
  label,
  action
) {
  const response =
    await action();

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `${label} refusé : ${response.status} ${body}`
    );
  }

  pass(label);
}



async function expectQueryAllowed(
  label,
  action
) {
  await action();
  pass(label);
}


async function expectQueryDenied(
  label,
  action
) {
  try {
    await action();
  } catch (error) {
    if (
      error?.status === 403
      || String(
        error?.message ?? ""
      ).includes("403")
    ) {
      pass(label);
      return;
    }

    throw error;
  }

  throw new Error(
    `${label} aurait dû être refusé`
  );
}


async function expectDenied(
  label,
  action
) {
  const response =
    await action();

  if (response.ok) {
    throw new Error(
      `${label} aurait dû être refusé`
    );
  }

  assert.equal(
    response.status,
    403
  );

  pass(label);
}


try {
  await Promise.all([
    createUser(A),
    createUser(B),
    createUser(C),
  ]);


  const [
    tokenA,
    tokenB,
    tokenC,
  ] =
    await Promise.all([
      signIn(A),
      signIn(B),
      signIn(C),
    ]);


  // ========================================================
  // Seed backend/admin
  // ========================================================

  await adminDb
    .collection(
      "playerInvitations"
    )
    .doc(invitationId)
    .set({
      schemaVersion:
        1,

      inviterUid:
        A.uid,

      inviteeUid:
        B.uid,

      pairKey,

      status:
        "accepted",

      createdAt:
        Timestamp.now(),

      updatedAt:
        Timestamp.now(),
    });


  await adminDb
    .collection(
      "activePlayerInvitePairs"
    )
    .doc(pairKey)
    .set({
      pairKey,

      invitationId,

      inviterUid:
        A.uid,

      inviteeUid:
        B.uid,

      status:
        "pending",

      createdAt:
        Timestamp.now(),
    });


  await adminDb
    .collection(
      "playerConversations"
    )
    .doc(conversationId)
    .set({
      conversationId,

      participantUids:
        [
          A.uid,
          B.uid,
        ].sort(),

      participantAUid:
        [A.uid, B.uid]
          .sort()[0],

      participantBUid:
        [A.uid, B.uid]
          .sort()[1],

      participantPairKey:
        pairKey,

      source:
        "playerInvite",

      sourceInviteId:
        invitationId,

      status:
        "active",

      createdAt:
        Timestamp.now(),

      updatedAt:
        Timestamp.now(),
    });


  // ========================================================
  // PLAYER INVITATIONS — READ
  // ========================================================

  await expectAllowed(
    "inviter peut lire son invitation",
    () =>
      firestoreGet(
        tokenA,
        `playerInvitations/${invitationId}`
      )
  );


  await expectAllowed(
    "destinataire peut lire son invitation",
    () =>
      firestoreGet(
        tokenB,
        `playerInvitations/${invitationId}`
      )
  );


  await expectDenied(
    "tiers ne peut pas lire l'invitation",
    () =>
      firestoreGet(
        tokenC,
        `playerInvitations/${invitationId}`
      )
  );


  // ========================================================
  // PLAYER INVITATIONS — CLIENT WRITES BLOCKED
  // ========================================================

  await expectDenied(
    "client ne peut pas créer playerInvitation",
    () =>
      firestoreCommit(
        tokenA,
        [
          {
            update: {
              name:
                docName(
                  `playerInvitations/client_${suffix}`
                ),

              fields: {
                inviterUid: {
                  stringValue:
                    A.uid,
                },

                inviteeUid: {
                  stringValue:
                    B.uid,
                },

                status: {
                  stringValue:
                    "pending",
                },
              },
            },
          },
        ]
      )
  );


  await expectDenied(
    "client ne peut pas modifier playerInvitation",
    () =>
      firestoreCommit(
        tokenB,
        [
          {
            update: {
              name:
                docName(
                  `playerInvitations/${invitationId}`
                ),

              fields: {
                schemaVersion: {
                  integerValue:
                    "1",
                },

                inviterUid: {
                  stringValue:
                    A.uid,
                },

                inviteeUid: {
                  stringValue:
                    B.uid,
                },

                pairKey: {
                  stringValue:
                    pairKey,
                },

                status: {
                  stringValue:
                    "declined",
                },
              },
            },
          },
        ]
      )
  );


  await expectDenied(
    "client ne peut pas supprimer playerInvitation",
    () =>
      firestoreCommit(
        tokenA,
        [
          {
            delete:
              docName(
                `playerInvitations/${invitationId}`
              ),
          },
        ]
      )
  );


  // ========================================================
  // ACTIVE PAIR LOCK — NEVER CLIENT READ/WRITE
  // ========================================================

  await expectDenied(
    "client ne peut pas lire activePlayerInvitePairs",
    () =>
      firestoreGet(
        tokenA,
        `activePlayerInvitePairs/${pairKey}`
      )
  );


  await expectDenied(
    "client ne peut pas écrire activePlayerInvitePairs",
    () =>
      firestoreCommit(
        tokenA,
        [
          {
            update: {
              name:
                docName(
                  `activePlayerInvitePairs/client_${suffix}`
                ),

              fields: {
                pairKey: {
                  stringValue:
                    pairKey,
                },
              },
            },
          },
        ]
      )
  );


  // ========================================================
  // PLAYER CONVERSATIONS — READ
  // ========================================================

  await expectAllowed(
    "participant A peut lire playerConversation",
    () =>
      firestoreGet(
        tokenA,
        `playerConversations/${conversationId}`
      )
  );


  await expectAllowed(
    "participant B peut lire playerConversation",
    () =>
      firestoreGet(
        tokenB,
        `playerConversations/${conversationId}`
      )
  );


  await expectDenied(
    "tiers ne peut pas lire playerConversation",
    () =>
      firestoreGet(
        tokenC,
        `playerConversations/${conversationId}`
      )
  );



  // ========================================================
  // PLAYER CONVERSATIONS — QUERY LIST
  // ========================================================

  const sortedParticipantUids =
    [A.uid, B.uid].sort();

  const participantAUid =
    sortedParticipantUids[0];

  const participantBUid =
    sortedParticipantUids[1];


  await expectQueryAllowed(
    "participant A peut lister via participantAUid",
    async () => {
      const rows =
        await firestoreRunQuery(
          tokenA,
          {
            from: [
              {
                collectionId:
                  "playerConversations",
              },
            ],

            where: {
              fieldFilter: {
                field: {
                  fieldPath:
                    "participantAUid",
                },

                op:
                  "EQUAL",

                value: {
                  stringValue:
                    A.uid,
                },
              },
            },
          }
        );

      if (participantAUid !== A.uid) {
        throw new Error(
          "Fixture inattendue : A n'est pas participantAUid."
        );
      }

      const ids =
        rows
          .map(
            (row) =>
              row.document?.name
          )
          .filter(Boolean);

      if (
        !ids.some(
          (name) =>
            name.endsWith(
              `/playerConversations/${conversationId}`
            )
        )
      ) {
        throw new Error(
          "Conversation A/B absente de la query participantAUid."
        );
      }
    }
  );


  await expectQueryAllowed(
    "participant B peut lister via participantBUid",
    async () => {
      const rows =
        await firestoreRunQuery(
          tokenB,
          {
            from: [
              {
                collectionId:
                  "playerConversations",
              },
            ],

            where: {
              fieldFilter: {
                field: {
                  fieldPath:
                    "participantBUid",
                },

                op:
                  "EQUAL",

                value: {
                  stringValue:
                    B.uid,
                },
              },
            },
          }
        );

      if (participantBUid !== B.uid) {
        throw new Error(
          "Fixture inattendue : B n'est pas participantBUid."
        );
      }

      const ids =
        rows
          .map(
            (row) =>
              row.document?.name
          )
          .filter(Boolean);

      if (
        !ids.some(
          (name) =>
            name.endsWith(
              `/playerConversations/${conversationId}`
            )
        )
      ) {
        throw new Error(
          "Conversation A/B absente de la query participantBUid."
        );
      }
    }
  );


  await expectQueryDenied(
    "tiers ne peut pas lister via participantAUid de A",
    () =>
      firestoreRunQuery(
        tokenC,
        {
          from: [
            {
              collectionId:
                "playerConversations",
            },
          ],

          where: {
            fieldFilter: {
              field: {
                fieldPath:
                  "participantAUid",
              },

              op:
                "EQUAL",

              value: {
                stringValue:
                  A.uid,
              },
            },
          },
        }
      )
  );


  // ========================================================
  // PLAYER CONVERSATIONS — CLIENT WRITES BLOCKED
  // ========================================================

  await expectDenied(
    "participant ne peut pas créer playerConversation",
    () =>
      firestoreCommit(
        tokenA,
        [
          {
            update: {
              name:
                docName(
                  `playerConversations/fake_${suffix}`
                ),

              fields: {
                participantUids: {
                  arrayValue: {
                    values: [
                      {
                        stringValue:
                          A.uid,
                      },
                      {
                        stringValue:
                          B.uid,
                      },
                    ],
                  },
                },
              },
            },
          },
        ]
      )
  );


  await expectDenied(
    "participant ne peut pas modifier playerConversation",
    () =>
      firestoreCommit(
        tokenA,
        [
          {
            update: {
              name:
                docName(
                  `playerConversations/${conversationId}`
                ),

              fields: {
                participantUids: {
                  arrayValue: {
                    values: [
                      {
                        stringValue:
                          A.uid,
                      },
                    ],
                  },
                },
              },
            },
          },
        ]
      )
  );


  await expectDenied(
    "participant ne peut pas supprimer playerConversation",
    () =>
      firestoreCommit(
        tokenB,
        [
          {
            delete:
              docName(
                `playerConversations/${conversationId}`
              ),
          },
        ]
      )
  );


  console.log();
  console.log(
    `${passed} tests Player Invite Rules PASS`
  );


} finally {
  for (
    const user
    of [A, B, C]
  ) {
    try {
      await adminAuth
        .deleteUser(
          user.uid
        );
    } catch {}
  }

  try {
    await adminDb
      .collection(
        "playerInvitations"
      )
      .doc(invitationId)
      .delete();
  } catch {}

  try {
    await adminDb
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairKey)
      .delete();
  } catch {}

  try {
    await adminDb
      .collection(
        "playerConversations"
      )
      .doc(conversationId)
      .delete();
  } catch {}
}
