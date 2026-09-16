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

const FUNCTIONS_REGION =
  "europe-west1";

const AUTH_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST
  || "127.0.0.1:9099";

const FUNCTIONS_HOST =
  "127.0.0.1:5001";


initializeApp({
  projectId: PROJECT_ID,
});


const db =
  getFirestore();

const auth =
  getAuth();


const suffix =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;


const A = {
  uid:
    `player_invite_a_${suffix}`,

  email:
    `player-invite-a-${suffix}@padima.test`,

  password:
    "PadimaTest123!",

  pseudo:
    "Alpha",

  avatar:
    "https://example.test/alpha.jpg",
};


const B = {
  uid:
    `player_invite_b_${suffix}`,

  email:
    `player-invite-b-${suffix}@padima.test`,

  password:
    "PadimaTest123!",

  pseudo:
    "Bravo",

  avatar:
    "https://example.test/bravo.jpg",
};


const C = {
  uid:
    `player_invite_c_${suffix}`,

  email:
    `player-invite-c-${suffix}@padima.test`,

  password:
    "PadimaTest123!",

  pseudo:
    "Charlie",

  avatar:
    "",
};


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


async function createAuthUser(
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
}


async function seedProfile(
  user,
  isDiscoverable
) {
  await db
    .collection("users")
    .doc(user.uid)
    .set({
      uid:
        user.uid,

      pseudo:
        user.pseudo,

      avatar:
        user.avatar,

      isDiscoverable,

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
  const url =
    `http://${AUTH_HOST}`
    + "/identitytoolkit.googleapis.com/v1/"
    + "accounts:signInWithPassword?key=fake-api-key";

  const response =
    await fetch(
      url,
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

  if (
    !response.ok
    || !payload.idToken
  ) {
    throw new Error(
      "AUTH_EMULATOR_SIGN_IN_FAILED: "
      + JSON.stringify(
        payload
      )
    );
  }

  return payload.idToken;
}


async function callCreatePlayerInvite(
  token,
  data
) {
  const url =
    `http://${FUNCTIONS_HOST}`
    + `/${PROJECT_ID}`
    + `/${FUNCTIONS_REGION}`
    + "/createPlayerInvite";

  const response =
    await fetch(
      url,
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


function resultOf(
  payload
) {
  return (
    payload?.result
    ?? payload?.data
    ?? null
  );
}


function callableErrorMessage(
  payload
) {
  return String(
    payload?.error?.message
    ?? payload?.error?.details
    ?? ""
  );
}


async function cleanup() {
  for (
    const user
    of [A, B, C]
  ) {
    try {
      await auth.deleteUser(
        user.uid
      );
    } catch {
      // ignore cleanup
    }

    try {
      await db
        .collection("users")
        .doc(user.uid)
        .delete();
    } catch {
      // ignore cleanup
    }
  }

  const invitations =
    await db
      .collection(
        "playerInvitations"
      )
      .where(
        "inviterUid",
        "in",
        [
          A.uid,
          B.uid,
          C.uid,
        ]
      )
      .get();

  for (
    const document
    of invitations.docs
  ) {
    await document.ref.delete();
  }

  const pairAB =
    buildPlayerPairKey(
      A.uid,
      B.uid
    );

  const pairAC =
    buildPlayerPairKey(
      A.uid,
      C.uid
    );

  await Promise.all([
    db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairAB)
      .delete(),

    db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairAC)
      .delete(),
  ]);
}


try {
  console.log(
    "============================================================"
  );

  console.log(
    "PADIMA — PLAYER INVITE EMULATOR TEST"
  );

  console.log(
    "============================================================"
  );


  await Promise.all([
    createAuthUser(A),
    createAuthUser(B),
    createAuthUser(C),
  ]);


  await Promise.all([
    seedProfile(
      A,
      true
    ),

    seedProfile(
      B,
      true
    ),

    seedProfile(
      C,
      false
    ),
  ]);


  const [
    tokenA,
    tokenB,
  ] =
    await Promise.all([
      signIn(A),
      signIn(B),
    ]);


  // ========================================================
  // TEST 1 — A invite B
  // ========================================================

  const beforeCreate =
    Date.now();


  const first =
    await callCreatePlayerInvite(
      tokenA,
      {
        inviteeUid:
          B.uid,

        scheduleKind:
          "flexible",

        timePreference:
          "evening",

        message:
          "  Ça te dit une partie ?  ",

        placeLabel:
          "Padel Test",
      }
    );


  assert.equal(
    first.response.ok,
    true,
    JSON.stringify(
      first.payload
    )
  );


  const firstResult =
    resultOf(
      first.payload
    );


  assert.ok(
    firstResult?.invitationId
  );


  assert.equal(
    firstResult.status,
    "pending"
  );


  pass(
    "A → B crée une invitation pending"
  );


  // ========================================================
  // TEST 2 — document invitation
  // ========================================================

  const inviteSnap =
    await db
      .collection(
        "playerInvitations"
      )
      .doc(
        firstResult.invitationId
      )
      .get();


  assert.equal(
    inviteSnap.exists,
    true
  );


  const invite =
    inviteSnap.data();


  assert.equal(
    invite.inviterUid,
    A.uid
  );

  assert.equal(
    invite.inviteeUid,
    B.uid
  );

  assert.equal(
    invite.status,
    "pending"
  );

  assert.equal(
    invite.source,
    "explorer"
  );

  assert.equal(
    invite.scheduleKind,
    "flexible"
  );

  assert.equal(
    invite.timePreference,
    "evening"
  );

  assert.equal(
    invite.message,
    "Ça te dit une partie ?"
  );

  assert.equal(
    invite.inviterPseudoSnapshot,
    "Alpha"
  );

  assert.equal(
    invite.inviteePseudoSnapshot,
    "Bravo"
  );

  assert.equal(
    invite.inviterAvatarSnapshot,
    A.avatar
  );

  assert.equal(
    invite.inviteeAvatarSnapshot,
    B.avatar
  );


  pass(
    "invitation contient les snapshots et données normalisées"
  );


  // ========================================================
  // TEST 3 — expiration ~ 7 jours
  // ========================================================

  assert.ok(
    invite.expiresAt
      instanceof Timestamp
  );


  const expiryDelta =
    invite.expiresAt.toMillis()
    - beforeCreate;


  const sevenDays =
    7
    * 24
    * 60
    * 60
    * 1000;


  assert.ok(
    Math.abs(
      expiryDelta
      - sevenDays
    )
    < 10_000
  );


  pass(
    "expiration positionnée à environ 7 jours"
  );


  // ========================================================
  // TEST 4 — verrou pair
  // ========================================================

  const pairKey =
    buildPlayerPairKey(
      A.uid,
      B.uid
    );


  assert.equal(
    firstResult.pairKey,
    pairKey
  );


  const pairSnap =
    await db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(pairKey)
      .get();


  assert.equal(
    pairSnap.exists,
    true
  );


  const pair =
    pairSnap.data();


  assert.equal(
    pair.invitationId,
    firstResult.invitationId
  );

  assert.equal(
    pair.status,
    "pending"
  );


  pass(
    "verrou activePlayerInvitePairs créé"
  );


  // ========================================================
  // TEST 5 — B → A doublon symétrique
  // ========================================================

  const reverse =
    await callCreatePlayerInvite(
      tokenB,
      {
        inviteeUid:
          A.uid,

        scheduleKind:
          "flexible",

        timePreference:
          "any",
      }
    );


  assert.equal(
    reverse.response.ok,
    false
  );


  assert.match(
    callableErrorMessage(
      reverse.payload
    ),
    /PLAYER_INVITE_ALREADY_PENDING/
  );


  pass(
    "B → A refusé car paire déjà pending"
  );


  // ========================================================
  // TEST 6 — joueur masqué
  // ========================================================

  const hidden =
    await callCreatePlayerInvite(
      tokenA,
      {
        inviteeUid:
          C.uid,

        scheduleKind:
          "flexible",

        timePreference:
          "any",
      }
    );


  assert.equal(
    hidden.response.ok,
    false
  );


  assert.match(
    callableErrorMessage(
      hidden.payload
    ),
    /PLAYER_INVITEE_NOT_DISCOVERABLE/
  );


  pass(
    "joueur isDiscoverable=false refusé"
  );


  // ========================================================
  // TEST 7 — auto invitation
  // ========================================================

  const self =
    await callCreatePlayerInvite(
      tokenA,
      {
        inviteeUid:
          A.uid,

        scheduleKind:
          "flexible",

        timePreference:
          "any",
      }
    );


  assert.equal(
    self.response.ok,
    false
  );


  assert.match(
    callableErrorMessage(
      self.payload
    ),
    /PLAYER_INVITE_SELF_NOT_ALLOWED/
  );


  pass(
    "auto-invitation refusée"
  );


  // ========================================================
  // TEST 8 — aucun Activity créé
  // ========================================================

  const activityCollections = [
    `users/${A.uid}/activities`,
    `users/${B.uid}/activities`,
  ];


  for (
    const path
    of activityCollections
  ) {
    const snap =
      await db
        .collection(path)
        .get();

    assert.equal(
      snap.empty,
      true
    );
  }


  pass(
    "Lot 1C ne crée encore aucune Activity"
  );


  console.log();
  // ========================================================
  // TEST — pending expiré est recyclé
  // ========================================================

  const expiryPairKey =
    buildPlayerPairKey(
      A.uid,
      B.uid
    );

  const currentPairSnap =
    await db
      .collection(
        "activePlayerInvitePairs"
      )
      .doc(
        expiryPairKey
      )
      .get();

  if (currentPairSnap.exists) {
    const oldInviteId =
      currentPairSnap
        .data()
        .invitationId;

    await Promise.all([
      db
        .collection(
          "activePlayerInvitePairs"
        )
        .doc(
          expiryPairKey
        )
        .set(
          {
            expiresAt:
              Timestamp
                .fromMillis(
                  Date.now() - 60_000
                ),
          },
          {
            merge: true,
          }
        ),

      db
        .collection(
          "playerInvitations"
        )
        .doc(
          oldInviteId
        )
        .set(
          {
            status: "pending",

            expiresAt:
              Timestamp
                .fromMillis(
                  Date.now() - 60_000
                ),
          },
          {
            merge: true,
          }
        ),
    ]);

    const replacement =
      await callCreatePlayerInvite(
        tokenB,
        {
          inviteeUid:
            A.uid,

          scheduleKind:
            "flexible",

          timePreference:
            "any",
        }
      );

    assert.equal(
      replacement.response.ok,
      true,
      JSON.stringify(
        replacement.payload
      )
    );

    const oldInviteSnap =
      await db
        .collection(
          "playerInvitations"
        )
        .doc(
          oldInviteId
        )
        .get();

    assert.equal(
      oldInviteSnap
        .data()
        .status,
      "expired"
    );

    const replacementPairSnap =
      await db
        .collection(
          "activePlayerInvitePairs"
        )
        .doc(
          expiryPairKey
        )
        .get();

    assert.equal(
      replacementPairSnap
        .data()
        .invitationId,
      replacement
        .payload
        .result
        .invitationId
    );

    pass(
      "pending expiré est fermé puis remplacé"
    );
  }


  console.log(
    `${passed} tests Player Invite Emulator PASS`
  );


} finally {
  await cleanup();
}
