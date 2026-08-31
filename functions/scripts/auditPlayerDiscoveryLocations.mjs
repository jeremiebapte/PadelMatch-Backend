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

const CURRENT_UID =
  process.env.CURRENT_UID || "";


initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
});

const db = getFirestore();


function asNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}


function validCoordinate(lat, lng) {
  return (
    lat !== null
    && lng !== null
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
    && !(lat === 0 && lng === 0)
  );
}


function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;

  const toRad =
    (degrees) =>
      degrees * Math.PI / 180;

  const dLat =
    toRad(lat2 - lat1);

  const dLng =
    toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1))
      * Math.cos(toRad(lat2))
      * Math.sin(dLng / 2) ** 2;

  const c =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}


console.log(
  "============================================================"
);

console.log(
  "PADIMA — PLAYER DISCOVERY LOCATION AUDIT"
);

console.log(
  `project=${PROJECT_ID}`
);

console.log(
  "AUCUNE ÉCRITURE"
);

console.log(
  "============================================================"
);


const snapshot =
  await db
    .collection("users")
    .get();


let totalUsers = 0;
let discoverableUsers = 0;

let withValidLocation = 0;
let withoutValidLocation = 0;

let under10 = 0;
let between10And25 = 0;
let between25And50 = 0;
let over50 = 0;

let currentUser = null;

const locatedUsers = [];


for (const document of snapshot.docs) {

  totalUsers += 1;

  const data =
    document.data() ?? {};

  const isDiscoverable =
    data.isDiscoverable === true;

  if (!isDiscoverable) {
    continue;
  }

  discoverableUsers += 1;

  const lat =
    asNumber(data.lat);

  const lng =
    asNumber(data.lng);

  const hasLocation =
    validCoordinate(lat, lng);

  if (hasLocation) {

    withValidLocation += 1;

    locatedUsers.push({
      uid: document.id,
      pseudo:
        typeof data.pseudo === "string"
          ? data.pseudo
          : "",
      lat,
      lng,
    });

  } else {

    withoutValidLocation += 1;
  }

  if (
    CURRENT_UID
    && document.id === CURRENT_UID
  ) {
    currentUser = {
      uid: document.id,
      pseudo:
        typeof data.pseudo === "string"
          ? data.pseudo
          : "",
      lat,
      lng,
      hasLocation,
    };
  }
}


console.log();
console.log(
  "=== GLOBAL ==="
);

console.log(
  `totalUsers=${totalUsers}`
);

console.log(
  `discoverableUsers=${discoverableUsers}`
);

console.log(
  `withValidLocation=${withValidLocation}`
);

console.log(
  `withoutValidLocation=${withoutValidLocation}`
);


if (!CURRENT_UID) {

  console.log();
  console.log(
    "=== CURRENT USER ==="
  );

  console.log(
    "CURRENT_UID non fourni."
  );

  console.log(
    "Le comptage par distance n'est donc pas calculé."
  );

  console.log();
  console.log(
    "Relance avec :"
  );

  console.log(
    "CURRENT_UID='TON_UID' node functions/scripts/auditPlayerDiscoveryLocations.mjs"
  );

  process.exit(0);
}


console.log();
console.log(
  "=== CURRENT USER ==="
);

if (!currentUser) {

  console.log(
    "currentUserFound=false"
  );

  process.exit(0);
}


console.log(
  `currentUserFound=true`
);

console.log(
  `currentUserPseudo=${currentUser.pseudo}`
);

console.log(
  `currentUserHasLocation=${currentUser.hasLocation}`
);

console.log(
  `currentUserLat=${currentUser.lat}`
);

console.log(
  `currentUserLng=${currentUser.lng}`
);


if (!currentUser.hasLocation) {

  console.log();
  console.log(
    "IMPOSSIBLE DE CALCULER LES DISTANCES :"
  );

  console.log(
    "le compte courant n'a pas de lat/lng valides."
  );

  process.exit(0);
}


console.log();
console.log(
  "=== DISTANCES ==="
);


const nearest = [];


for (const user of locatedUsers) {

  if (user.uid === CURRENT_UID) {
    continue;
  }

  const distance =
    haversineKm(
      currentUser.lat,
      currentUser.lng,
      user.lat,
      user.lng
    );

  if (distance < 10) {

    under10 += 1;

  } else if (distance < 25) {

    between10And25 += 1;

  } else if (distance < 50) {

    between25And50 += 1;

  } else {

    over50 += 1;
  }

  nearest.push({
    uid: user.uid,
    pseudo: user.pseudo,
    distanceKm:
      Math.round(distance * 10) / 10,
  });
}


nearest.sort(
  (a, b) =>
    a.distanceKm - b.distanceKm
);


console.log(
  `under10Km=${under10}`
);

console.log(
  `between10And25Km=${between10And25}`
);

console.log(
  `between25And50Km=${between25And50}`
);

console.log(
  `over50Km=${over50}`
);


console.log();
console.log(
  "=== 20 JOUEURS LES PLUS PROCHES ==="
);


for (
  const user
  of nearest.slice(0, 20)
) {

  console.log(
    JSON.stringify(user)
  );
}


console.log();
console.log(
  "============================================================"
);

console.log(
  "AUDIT TERMINÉ — 0 écriture"
);

console.log(
  "============================================================"
);
