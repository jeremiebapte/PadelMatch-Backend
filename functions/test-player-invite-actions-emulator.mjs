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


const PROJECT_ID =
  "padelmatch-32186";

const REGION =
  "europe-west1";

const AUTH_HOST =
  process.env
    .FIREBASE_AUTH_EMULATOR_HOST
  || "127.0.0.1:9099";

const FUNCTIONS_HOST =
  "127.0.0.1:5001";


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


function makeUser(
  letter
) {
  return {
    uid:
      `player_action_${letter}_${suffix}`,

    email:
      `player-action-${letter}-${suffix}@padima.test`,

    password:
      "PadimaTest123!",

    pseudo:
      `Player ${letter}`,
  };
}


const A =
  makeUser("a");

const B =
  makeUser("b");

const C =
  makeUser("c");


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


async function seed(
  user
) {
  await auth.createUser({
    uid:
      user.uid,

    email:
      user.email,

    password:
      user.password,

    emailVerified:
      true,
  });

  await db
    .collection("users")
    .doc(user.uid)
    .set({
      uid:
        user.uid,

      pseudo:
        user.pseudo,

      isDiscoverable:
        true,

      isPublicProfile:
        true,

      createdAt:
        Timestamp.now(),

      updatedAt:
        Timestamp.now(),
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
      JSON.stringify(
        payload
      )
    );
  }

  return payload.idToken;
}


async function call(
  name,
  token,
  data
) {
  const response =
    await fetch(
      `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${name}`,
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
            data,
          }),
      }
    );

  const payload =
    await response.json();

  return {
    response,
    payload,
  };
}


function result(
  payload
) {
  return payload?.result
    ?? payload?.data
    ?? null;
}


function errorMessage(
  payload
) {
  return String(
    payload?.error?.message
    ?? payload?.error?.details
    ?? ""
  );
}


async function createInvite(
  token,
  inviteeUid
) {
  const response =
    await call(
      "createPlayerInvite",
      token,
      {
        inviteeUid,
        scheduleKind:
          "flexible",

        timePreference:
          "evening",
      }
    );

  assert.equal(
    response.response.ok,
    true,
    JSON.stringify(
      response.payload
    )
  );

  return result(
    response.payload
  );
}


try {
  await Promise.all([
    seed(A),
    seed(B),
    seed(C),
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
  // ACCEPT
  // ========================================================

  const inviteAB =
    await createInvite(
      tokenA,
      B.uid
    );


  const forbiddenAccept =
    await call(
      "acceptPlayerInvite",
      tokenC,
      {
        invitationId:
          inviteAB.invitationId,
      }
    );


  assert.equal(
    forbiddenAccept
      .response
      .ok,
    false
  );

  assert.match(
    errorMessage(
      forbiddenAccept.payload
    ),
    /PLAYER_INVITE_FORBIDDEN/
  );

  pass(
    "tiers ne peut pas accepter"
  );


  const accept =
    await call(
      "acceptPlayerInvite",
      tokenB,
      {
        invitationId:
          inviteAB.invitationId,
      }
    );


  assert.equal(
    accept.response.ok,
    true,
    JSON.stringify(
      accept.payload
    )
  );


  const acceptedResult =
    result(
      accept.payload
    );


  assert.equal(
    acceptedResult.status,
    "accepted"
  );


  const invitationAccepted =
    await db
      .collection(
        "playerInvitations"
      )
      .doc(
        inviteAB.invitationId
      )
      .get();


  assert.equal(
    invitationAccepted
      .data()
      .status,
    "accepted"
  );


  assert.ok(
    invitationAccepted
      .data()
      .acceptedAt
  );


  const pairKeyAB =
    [A.uid, B.uid]
      .sort()
      .join("_");


  const conversation =
    await db
      .collection(
        "playerConversations"
      )
      .doc(pairKeyAB)
      .get();


  assert.equal(
    conversation.exists,
    true
  );


  assert.deepEqual(
    conversation
      .data()
      .participantUids,
    [A.uid, B.uid]
      .sort()
  );


  assert.equal(
    conversation
      .data()
      .sourceInviteId,
    inviteAB.invitationId
  );


  const lockAfterAccept =
    await db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairKeyAB)
      .get();


  assert.equal(
    lockAfterAccept.exists,
    false
  );


  pass(
    "accept crée conversation et supprime pair lock"
  );


  const acceptAgain =
    await call(
      "acceptPlayerInvite",
      tokenB,
      {
        invitationId:
          inviteAB.invitationId,
      }
    );


  assert.equal(
    acceptAgain.response.ok,
    false
  );

  assert.match(
    errorMessage(
      acceptAgain.payload
    ),
    /PLAYER_INVITE_NOT_PENDING/
  );


  pass(
    "invitation acceptée ne peut pas être retraitée"
  );


  // ========================================================
  // DECLINE
  // Nouvelle paire A/C
  // ========================================================

  const inviteAC =
    await createInvite(
      tokenA,
      C.uid
    );


  const decline =
    await call(
      "declinePlayerInvite",
      tokenC,
      {
        invitationId:
          inviteAC.invitationId,
      }
    );


  assert.equal(
    decline.response.ok,
    true,
    JSON.stringify(
      decline.payload
    )
  );


  const declinedSnap =
    await db
      .collection(
        "playerInvitations"
      )
      .doc(
        inviteAC.invitationId
      )
      .get();


  assert.equal(
    declinedSnap
      .data()
      .status,
    "declined"
  );


  const pairKeyAC =
    [A.uid, C.uid]
      .sort()
      .join("_");


  const lockAfterDecline =
    await db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairKeyAC)
      .get();


  assert.equal(
    lockAfterDecline.exists,
    false
  );


  const noConversation =
    await db
      .collection(
        "playerConversations"
      )
      .doc(pairKeyAC)
      .get();


  assert.equal(
    noConversation.exists,
    false
  );


  pass(
    "decline ferme invitation sans conversation"
  );


  // ========================================================
  // CANCEL
  // B peut réinviter A maintenant
  // ========================================================

  const secondBA =
    await createInvite(
      tokenB,
      A.uid
    );


  const forbiddenCancel =
    await call(
      "cancelPlayerInvite",
      tokenA,
      {
        invitationId:
          secondBA.invitationId,
      }
    );


  assert.equal(
    forbiddenCancel
      .response
      .ok,
    false
  );

  assert.match(
    errorMessage(
      forbiddenCancel.payload
    ),
    /PLAYER_INVITE_FORBIDDEN/
  );


  pass(
    "destinataire ne peut pas annuler"
  );


  const cancel =
    await call(
      "cancelPlayerInvite",
      tokenB,
      {
        invitationId:
          secondBA.invitationId,
      }
    );


  assert.equal(
    cancel.response.ok,
    true,
    JSON.stringify(
      cancel.payload
    )
  );


  const cancelledSnap =
    await db
      .collection(
        "playerInvitations"
      )
      .doc(
        secondBA.invitationId
      )
      .get();


  assert.equal(
    cancelledSnap
      .data()
      .status,
    "cancelled"
  );


  const lockAfterCancel =
    await db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairKeyAB)
      .get();


  assert.equal(
    lockAfterCancel.exists,
    false
  );


  pass(
    "inviter peut annuler et libère la paire"
  );


  console.log();
  console.log(
    `${passed} tests Player Invite Actions PASS`
  );

} finally {
  for (
    const user
    of [A, B, C]
  ) {
    try {
      await auth.deleteUser(
        user.uid
      );
    } catch {}

    try {
      await db
        .collection("users")
        .doc(user.uid)
        .delete();
    } catch {}
  }
}
