// create_test_user.js
const admin = require('firebase-admin');

// Initialise l'Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const auth = admin.auth();
const db = admin.firestore();

async function main() {
  const email = 'test.padelmatch@gmail.com';
  const password = 'PadelMatch2025!';

  // 1️⃣ Crée ou récupère l'utilisateur
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log('✅ User already exists:', user.uid);
  } catch (e) {
    user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: 'PadelMatch Tester'
    });
    console.log('✅ User created:', user.uid);
  }

  // 2️⃣ Force la vérification email
  await auth.updateUser(user.uid, { emailVerified: true });
  console.log('📩 Email marked as verified for', user.email);

  // 3️⃣ Crée un match de test (demain)
  const matchDoc = {
    createurUid: user.uid,
    lieuNom: 'Padel Club de Test',
    placeId: 'test_place_1',
    latitude: 48.8566,
    longitude: 2.3522,
    dateHeure: Date.now() + 24 * 60 * 60 * 1000,
    niveau: 6,
    participants: [user.uid],
    description: 'Match test pour review Google Play',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const matchRef = await db.collection('matches').add(matchDoc);
  console.log('🎾 Match created with ID:', matchRef.id);

  // 4️⃣ Ajoute un message de test
  const msg = {
    matchId: matchRef.id,
    senderUid: user.uid,
    text: 'Salut 👋 Ceci est un message de test pour la review Google Play.',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await db.collection('messages').add(msg);
  console.log('💬 Sample message created.');

  console.log('✅ Done! Test account ready for review.');
  console.log('👉 Credentials:', email, '/', password);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
