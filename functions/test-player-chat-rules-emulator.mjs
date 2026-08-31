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
  process.env.FIRESTORE_EMULATOR_HOST
  || "127.0.0.1:8080";

const AUTH_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST
  || "127.0.0.1:9099";


initializeApp({
  projectId:
    PROJECT_ID,
});


const db =
  getFirestore();

const auth =
  getAuth();


const suffix =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;


function user(
  letter
) {
  return {
    uid:
      `player_chat_${letter}_${suffix}`,

    email:
      `player-chat-${letter}-${suffix}@padima.test`,

    password:
      "PadimaTest123!",
  };
}


const A = user("a");
const B = user("b");
const C = user("c");

const conversationId =
  buildPlayerPairKey(
      A.uid,
      B.uid
    );

const messageId =
  `message_${suffix}`;


let passed = 0;


function pass(
  label
) {
  passed += 1;
  console.log(
    `PASS — ${label}`
  );
}


async function createUser(
  u
) {
  await auth.createUser({
    uid:
      u.uid,

    email:
      u.email,

    password:
      u.password,

    emailVerified:
      true,
  });
}


async function signIn(
  u
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
              u.email,

            password:
              u.password,

            returnSecureToken:
              true,
          }),
      }
    );

  const payload =
    await response.json();

  if (!payload.idToken) {
    throw new Error(
      JSON.stringify(payload)
    );
  }

  return payload.idToken;
}


function documentName(
  path
) {
  return (
    `projects/${PROJECT_ID}`
    + `/databases/(default)/documents/`
    + path
  );
}


function url(
  path
) {
  return (
    `http://${FIRESTORE_HOST}`
    + `/v1/projects/${PROJECT_ID}`
    + `/databases/(default)/documents/`
    + path
  );
}


async function getDoc(
  token,
  path
) {
  return fetch(
    url(path),
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    }
  );
}


async function commit(
  token,
  writes
) {
  return fetch(
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


function playerMessageFields({
  senderUid,
  receiverUid,
  conversation = conversationId,
  text = "Salut !",
}) {
  return {
    conversationType: {
      stringValue:
        "player",
    },

    conversationId: {
      stringValue:
        conversation,
    },

    senderUid: {
      stringValue:
        senderUid,
    },

    receiverUid: {
      stringValue:
        receiverUid,
    },

    text: {
      stringValue:
        text,
    },

    timestamp: {
      timestampValue:
        new Date().toISOString(),
    },
  };
}


async function expectAllowed(
  label,
  action
) {
  const response =
    await action();

  if (!response.ok) {
    throw new Error(
      `${label}: ${response.status} ${await response.text()}`
    );
  }

  pass(label);
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


  // Conversation créée par backend après acceptation.
  await db
    .collection(
      "playerConversations"
    )
    .doc(conversationId)
    .set({
      conversationId,

      participantUids:
        [A.uid, B.uid].sort(),

      participantPairKey:
        conversationId,

      status:
        "active",

      source:
        "playerInvite",

      createdAt:
        Timestamp.now(),

      updatedAt:
        Timestamp.now(),
    });


  // --------------------------------------------------------
  // A -> B autorisé
  // --------------------------------------------------------

  await expectAllowed(
    "A peut envoyer un Player Message à B",
    () =>
      commit(
        tokenA,
        [
          {
            update: {
              name:
                documentName(
                  `messages/${messageId}`
                ),

              fields:
                playerMessageFields({
                  senderUid:
                    A.uid,

                  receiverUid:
                    B.uid,
                }),
            },
          },
        ]
      )
  );


  // --------------------------------------------------------
  // Lecture A/B oui, C non
  // --------------------------------------------------------

  await expectAllowed(
    "A peut lire le Player Message",
    () =>
      getDoc(
        tokenA,
        `messages/${messageId}`
      )
  );


  await expectAllowed(
    "B peut lire le Player Message",
    () =>
      getDoc(
        tokenB,
        `messages/${messageId}`
      )
  );


  await expectDenied(
    "C ne peut pas lire le Player Message",
    () =>
      getDoc(
        tokenC,
        `messages/${messageId}`
      )
  );


  // --------------------------------------------------------
  // Sender spoofing
  // --------------------------------------------------------

  await expectDenied(
    "A ne peut pas usurper C comme sender",
    () =>
      commit(
        tokenA,
        [
          {
            update: {
              name:
                documentName(
                  `messages/spoof_${suffix}`
                ),

              fields:
                playerMessageFields({
                  senderUid:
                    C.uid,

                  receiverUid:
                    B.uid,
                }),
            },
          },
        ]
      )
  );


  // --------------------------------------------------------
  // Receiver hors conversation
  // --------------------------------------------------------

  await expectDenied(
    "A ne peut pas écrire à C via conversation A/B",
    () =>
      commit(
        tokenA,
        [
          {
            update: {
              name:
                documentName(
                  `messages/wrong_receiver_${suffix}`
                ),

              fields:
                playerMessageFields({
                  senderUid:
                    A.uid,

                  receiverUid:
                    C.uid,
                }),
            },
          },
        ]
      )
  );


  // --------------------------------------------------------
  // Conversation inexistante
  // --------------------------------------------------------

  await expectDenied(
    "message refusé si conversation inexistante",
    () =>
      commit(
        tokenA,
        [
          {
            update: {
              name:
                documentName(
                  `messages/missing_conversation_${suffix}`
                ),

              fields:
                playerMessageFields({
                  senderUid:
                    A.uid,

                  receiverUid:
                    B.uid,

                  conversation:
                    `missing_${suffix}`,
                }),
            },
          },
        ]
      )
  );


  // --------------------------------------------------------
  // Conversation inactive
  // --------------------------------------------------------

  await db
    .collection(
      "playerConversations"
    )
    .doc(conversationId)
    .update({
      status:
        "closed",
    });


  await expectDenied(
    "message refusé si conversation non active",
    () =>
      commit(
        tokenA,
        [
          {
            update: {
              name:
                documentName(
                  `messages/inactive_${suffix}`
                ),

              fields:
                playerMessageFields({
                  senderUid:
                    A.uid,

                  receiverUid:
                    B.uid,
                }),
            },
          },
        ]
      )
  );


  await db
    .collection(
      "playerConversations"
    )
    .doc(conversationId)
    .update({
      status:
        "active",
    });


  // --------------------------------------------------------
  // Édition par auteur
  // REST patch complet avec updateMask
  // --------------------------------------------------------

  const editResponse =
    await fetch(
      url(`messages/${messageId}`)
      + "?updateMask.fieldPaths=text"
      + "&updateMask.fieldPaths=edited"
      + "&updateMask.fieldPaths=editedAt",
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${tokenA}`,
        },

        body:
          JSON.stringify({
            fields: {
              text: {
                stringValue:
                  "Salut modifié",
              },

              edited: {
                booleanValue:
                  true,
              },

              editedAt: {
                timestampValue:
                  new Date().toISOString(),
              },
            },
          }),
      }
    );


  if (!editResponse.ok) {
    throw new Error(
      `édition auteur refusée: ${editResponse.status} ${await editResponse.text()}`
    );
  }

  pass(
    "auteur peut éditer son Player Message"
  );


  // --------------------------------------------------------
  // Destinataire readAt
  // --------------------------------------------------------

  const readAtResponse =
    await fetch(
      url(`messages/${messageId}`)
      + "?updateMask.fieldPaths=readAt",
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${tokenB}`,
        },

        body:
          JSON.stringify({
            fields: {
              readAt: {
                timestampValue:
                  new Date().toISOString(),
              },
            },
          }),
      }
    );


  /*
   * request.resource.data.readAt == request.time impose
   * normalement un serverTimestamp côté SDK.
   *
   * REST ne peut pas reproduire exactement cette transformation.
   * On vérifie donc la sécurité via commit transform.
   */
  if (readAtResponse.ok) {
    throw new Error(
      "PATCH readAt client timestamp aurait dû être refusé"
    );
  }

  pass(
    "readAt arbitraire côté client refusé"
  );


  const transformResponse =
    await commit(
      tokenB,
      [
        {
          transform: {
            document:
              documentName(
                `messages/${messageId}`
              ),

            fieldTransforms: [
              {
                fieldPath:
                  "readAt",

                setToServerValue:
                  "REQUEST_TIME",
              },
            ],
          },
        },
      ]
    );


  if (!transformResponse.ok) {
    throw new Error(
      `server readAt refusé: ${transformResponse.status} ${await transformResponse.text()}`
    );
  }

  pass(
    "destinataire peut marquer readAt avec server timestamp"
  );


  // --------------------------------------------------------
  // C ne peut pas modifier
  // --------------------------------------------------------

  await expectDenied(
    "tiers ne peut pas modifier le Player Message",
    () =>
      commit(
        tokenC,
        [
          {
            transform: {
              document:
                documentName(
                  `messages/${messageId}`
                ),

              fieldTransforms: [
                {
                  fieldPath:
                    "readAt",

                  setToServerValue:
                    "REQUEST_TIME",
                },
              ],
            },
          },
        ]
      )
  );


  // --------------------------------------------------------
  // Suppression destinataire interdite
  // --------------------------------------------------------

  await expectDenied(
    "destinataire ne peut pas supprimer le Player Message",
    () =>
      commit(
        tokenB,
        [
          {
            delete:
              documentName(
                `messages/${messageId}`
              ),
          },
        ]
      )
  );


  // --------------------------------------------------------
  // Suppression auteur autorisée
  // --------------------------------------------------------

  await expectAllowed(
    "auteur peut supprimer son Player Message",
    () =>
      commit(
        tokenA,
        [
          {
            delete:
              documentName(
                `messages/${messageId}`
              ),
          },
        ]
      )
  );


  console.log();
  console.log(
    `${passed} tests Player Chat Rules PASS`
  );


} finally {
  for (
    const u
    of [A, B, C]
  ) {
    try {
      await auth.deleteUser(
        u.uid
      );
    } catch {}
  }

  try {
    await db
      .collection(
        "playerConversations"
      )
      .doc(conversationId)
      .delete();
  } catch {}

  const messages =
    await db
      .collection("messages")
      .where(
        "conversationId",
        "==",
        conversationId
      )
      .get();

  for (
    const doc
    of messages.docs
  ) {
    try {
      await doc.ref.delete();
    } catch {}
  }
}
