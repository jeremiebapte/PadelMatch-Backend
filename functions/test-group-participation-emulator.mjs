import admin from "firebase-admin";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "padelmatch-32186";

const AUTH_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  "127.0.0.1:9099";

const FIRESTORE_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ||
  "127.0.0.1:8080";

const FUNCTIONS_BASE =
  process.env.FUNCTIONS_EMULATOR_BASE ||
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1`;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();

const stamp = Date.now();
const suffix = `${stamp}-${Math.random().toString(16).slice(2, 8)}`;

const ids = {
  ownerUid: `test-owner-${suffix}`,
  joinerUid: `test-joiner-${suffix}`,
  observerUid: `test-observer-${suffix}`,
  groupId: `test-group-${suffix}`,
  matchId: `test-match-${suffix}`,
};

const emails = {
  owner: `owner-${suffix}@padima.test`,
  joiner: `joiner-${suffix}@padima.test`,
  observer: `observer-${suffix}@padima.test`,
};

const password = "PadimaTest123!";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION_FAILED: ${message}`);
  }
}

async function ensureEmulatorAvailable(name, url) {
  try {
    const response = await fetch(url);
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `${name} inaccessible à ${url}: ${error.message}`
    );
  }
}

async function createAuthUser(email, forcedUid) {
  const signUpUrl =
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/` +
    `accounts:signUp?key=fake-api-key`;

  const response = await fetch(signUpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Création Auth Emulator impossible pour ${email}: ` +
      JSON.stringify(payload)
    );
  }

  const generatedUid = payload.localId;

  if (generatedUid !== forcedUid) {
    await admin.auth().updateUser(generatedUid, {
      displayName: forcedUid,
    });
  }

  return {
    uid: generatedUid,
    idToken: payload.idToken,
    email,
  };
}

async function callCallable(functionName, idToken, data) {
  const url = `${FUNCTIONS_BASE}/${functionName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });

  const payload = await response.json().catch(() => ({
    malformedResponse: true,
  }));

  if (!response.ok || payload.error) {
    throw new Error(
      `${functionName} a échoué — HTTP ${response.status}: ` +
      JSON.stringify(payload, null, 2)
    );
  }

  return payload.result;
}

async function seedUser(uid, email, pseudo) {
  await db.collection("users").doc(uid).set({
    uid,
    email,
    pseudo,
    displayName: pseudo,
    firstName: pseudo,
    isActive: true,
    notificationsEnabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function seedMembership(uid, role) {
  const membershipId = `${ids.groupId}_${uid}`;

  await db.collection("groupMemberships").doc(membershipId).set({
    id: membershipId,
    groupId: ids.groupId,
    userId: uid,
    uid,
    role,
    status: "active",
    isActive: true,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function seedFixtures(authUsers) {
  const ownerUid = authUsers.owner.uid;
  const joinerUid = authUsers.joiner.uid;
  const observerUid = authUsers.observer.uid;

  await Promise.all([
    seedUser(ownerUid, authUsers.owner.email, "Owner Test"),
    seedUser(joinerUid, authUsers.joiner.email, "Joiner Test"),
    seedUser(observerUid, authUsers.observer.email, "Observer Test"),
  ]);

  await db.collection("groups").doc(ids.groupId).set({
    id: ids.groupId,
    name: "Groupe Test Notifications",
    ownerUid,
    creatorUid: ownerUid,
    memberIds: [ownerUid, joinerUid, observerUid],
    membersCount: 3,
    status: "active",
    visibility: "private",
    joinPolicy: "invitationsOnly",
    settings: {
      canMembersInvitePlayers: true,
      canMembersCreateMatches: true,
      canMembersPostMessages: true,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await Promise.all([
    seedMembership(ownerUid, "owner"),
    seedMembership(joinerUid, "member"),
    seedMembership(observerUid, "member"),
  ]);

  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.collection("matches").doc(ids.matchId).set({
    id: ids.matchId,

    creatorId: ownerUid,
    creatorUid: ownerUid,
    ownerUid,

    groupId: ids.groupId,
    groupNameSnapshot: "Groupe Test Notifications",
    groupAvatarSnapshot: null,

    participants: [ownerUid],
    participantIds: [ownerUid],
    players: [ownerUid],

    maxPlayers: 2,
    capacity: 2,
    numberOfPlayers: 2,
    places: 2,

    status: "open",
    isCancelled: false,
    cancelled: false,

    lieu: "Club Test Emulator",
    location: "Club Test Emulator",
    city: "Paris",

    date: admin.firestore.Timestamp.fromDate(futureDate),
    dateHeure: futureDate.getTime(),
    startAt: admin.firestore.Timestamp.fromDate(futureDate),

    duration: 90,
    niveau: 5,
    level: 5,
    gender: "mixed",
    genre: "mixed",

    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function readMatch() {
  const snapshot =
    await db.collection("matches").doc(ids.matchId).get();

  assert(snapshot.exists, "le match de test n'existe plus");

  return snapshot.data();
}

function participantIds(match) {
  const candidates = [
    match.participants,
    match.participantIds,
    match.players,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

async function cleanup() {
  const refs = [
    db.collection("matches").doc(ids.matchId),
    db.collection("groups").doc(ids.groupId),
  ];

  const memberships = await db
    .collection("groupMemberships")
    .where("groupId", "==", ids.groupId)
    .get();

  memberships.forEach((doc) => refs.push(doc.ref));

  const batch = db.batch();
  refs.forEach((ref) => batch.delete(ref));
  await batch.commit().catch(() => {});

  const users = await admin.auth().listUsers(1000);

  const testUsers = users.users
    .filter((user) =>
      Object.values(emails).includes(user.email)
    )
    .map((user) => user.uid);

  if (testUsers.length) {
    await admin.auth().deleteUsers(testUsers).catch(() => {});
  }

  const userDocs = await Promise.all(
    testUsers.map((uid) =>
      db.collection("users").doc(uid).get()
    )
  );

  const userBatch = db.batch();

  userDocs.forEach((snapshot) => {
    if (snapshot.exists) {
      userBatch.delete(snapshot.ref);
    }
  });

  await userBatch.commit().catch(() => {});
}

async function main() {
  console.log("==================================================");
  console.log("PADIMA — TEST PARTICIPATION MATCH DE GROUPE");
  console.log("==================================================");
  console.log(`Projet       : ${PROJECT_ID}`);
  console.log(`Auth         : ${AUTH_HOST}`);
  console.log(`Firestore    : ${FIRESTORE_HOST}`);
  console.log(`Functions    : ${FUNCTIONS_BASE}`);
  console.log(`Groupe       : ${ids.groupId}`);
  console.log(`Match        : ${ids.matchId}`);
  console.log("");

  await ensureEmulatorAvailable(
    "Auth Emulator",
    `http://${AUTH_HOST}/`
  );

  await ensureEmulatorAvailable(
    "Firestore Emulator",
    `http://${FIRESTORE_HOST}/`
  );

  const authUsers = {
    owner: await createAuthUser(
      emails.owner,
      ids.ownerUid
    ),
    joiner: await createAuthUser(
      emails.joiner,
      ids.joinerUid
    ),
    observer: await createAuthUser(
      emails.observer,
      ids.observerUid
    ),
  };

  console.log("✅ Utilisateurs Auth Emulator créés");

  await seedFixtures(authUsers);

  console.log("✅ Groupe, memberships et match injectés");

  const beforeJoin = await readMatch();
  const beforeJoinParticipants = participantIds(beforeJoin);

  assert(
    beforeJoinParticipants.length === 1,
    `le match devrait avoir 1 participant avant join, reçu: ` +
    JSON.stringify(beforeJoinParticipants)
  );

  console.log("");
  console.log("▶ Appel joinMatch");

  const joinResult = await callCallable(
    "joinMatch",
    authUsers.joiner.idToken,
    {
      matchId: ids.matchId,
      joinWithFriend: false,
      withFriend: false,
    }
  );

  console.log("Résultat joinMatch :", joinResult);

  const afterJoin = await readMatch();
  const afterJoinParticipants = participantIds(afterJoin);

  assert(
    afterJoinParticipants.includes(authUsers.joiner.uid),
    "le joueur joiner n'est pas présent après joinMatch"
  );

  assert(
    afterJoinParticipants.length === 2,
    `le match devrait être complet avec 2 participants, reçu: ` +
    JSON.stringify(afterJoinParticipants)
  );

  console.log("✅ PLAYER_JOINED — transition validée");
  console.log("✅ MATCH_FULL — transition 1/2 vers 2/2 validée");

  console.log("");
  console.log("▶ Appel leaveMatch");

  const leaveResult = await callCallable(
    "leaveMatch",
    authUsers.joiner.idToken,
    {
      matchId: ids.matchId,
    }
  );

  console.log("Résultat leaveMatch :", leaveResult);

  const afterLeave = await readMatch();
  const afterLeaveParticipants = participantIds(afterLeave);

  assert(
    !afterLeaveParticipants.includes(authUsers.joiner.uid),
    "le joueur joiner est toujours présent après leaveMatch"
  );

  assert(
    afterLeaveParticipants.length === 1,
    `le match devrait revenir à 1 participant, reçu: ` +
    JSON.stringify(afterLeaveParticipants)
  );

  console.log("✅ PLAYER_LEFT — transition validée");
  console.log("✅ SPOT_AVAILABLE — transition 2/2 vers 1/2 validée");

  console.log("");
  console.log("==================================================");
  console.log("✅ ALL TESTS PASSED");
  console.log("==================================================");
  console.log("");
  console.log(
    "Vérifie aussi dans le Terminal Functions que ces événements " +
    "ont été traités une seule fois :"
  );
  console.log("- PLAYER_JOINED");
  console.log("- MATCH_FULL");
  console.log("- PLAYER_LEFT");
  console.log("- SPOT_AVAILABLE");
}

main()
  .catch((error) => {
    console.error("");
    console.error("==================================================");
    console.error("❌ TEST FAILED");
    console.error("==================================================");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.PADIMA_KEEP_TEST_DATA === "1") {
      console.log("");
      console.log(
        "ℹ️ Données conservées car PADIMA_KEEP_TEST_DATA=1"
      );
      return;
    }

    await cleanup();

    console.log("");
    console.log("🧹 Données de test supprimées");
  });
