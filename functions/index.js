// Path: functions/index.js
// ======================================================
// Padima – Cloud Functions (Node 22, Admin SDK 12) – Gen2
// NORMALISATION + GARDE-FOUS SERVEUR + COMPAT PROD
//
// RÈGLE D’OR FIREBASE:
// - Tu NE CHANGES PAS le type d’une fonction existante (callable vs trigger vs cron).
// - Si tu veux un autre type => NOUVEAU NOM.
//
// Donc:
// - pushNearbyMatch  : RESTE callable (compat prod)
// - pushNearbyMatchTrigger : NOUVEAU trigger onCreate(matches/*)
// - notifyOneHourBeforeMatchCron / notify24HoursBeforeMatchCron : NOUVEAUX crons
// ======================================================

import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";

// ======================================================
// RUNTIME COMMUN (Gen2 / Cloud Run quota friendly)
// - IMPORTANT: utile uniquement pour onCall / onSchedule.
// - Les triggers Firestore n’acceptent pas cpu/memory ici.
// ======================================================
const RUNTIME = {
  region: "europe-west1",
  cpu: 0.25,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 10,
};

const RUNTIME_SCHEDULE = {
  region: "europe-west1",
  cpu: 0.25,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
};

// ======================================================
// INIT
// ======================================================
initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const authAdmin = getAuth();

// ======================================================
// CONSTANTS
// ======================================================
const MAX_PLAYERS = 4;
const HOUR_MS = 60 * 60 * 1000;

// ======================================================
// HELPERS (types, parsing, interop)
// ======================================================
function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function asNumber(v) {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function normalizeDateMs(v) {
  if (typeof v !== "number") return 0;
  // seconds -> millis (interop vieux clients)
  if (v > 0 && v < 1_000_000_000_000) return v * 1000;
  return v;
}

function toMillis(value) {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (value && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  return null;
}

function friendMarkerPrefix(uid) {
  return `ami_de_${uid}:`;
}

const isFriendMarker = (p) =>
  typeof p === "string" && p.startsWith("ami_de_");

const cleanUids = (list) =>
  Array.isArray(list)
    ? list.filter((p) => typeof p === "string" && !isFriendMarker(p))
    : [];

const onlyStrings = (list) =>
  Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];

function assertAuth(req) {
  if (!req.auth?.uid) {
    throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
  }
  return req.auth.uid;
}

function assertAdmin(req) {
  if (!req.auth?.uid) {
    throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
  }
  if (req.auth.token?.admin !== true) {
    throw new HttpsError("permission-denied", "ADMIN_REQUIRED");
  }
  return req.auth.uid;
}

function isValidFriendName(name) {
  const t = asString(name);
  return t.length >= 1 && t.length <= 24;
}

function frTime(ms) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function frDate(ms) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(new Date(ms));
}

function getLatLngFromMatchData(m) {
  const lat = asNumber(m?.lat) ?? asNumber(m?.latitude);
  const lng = asNumber(m?.lng) ?? asNumber(m?.longitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

// Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function distanceKmApprox(a, b) {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111;
}

async function pseudoOf(uid) {
  try {
    const s = await db.collection("users").doc(uid).get();
    return s.exists && s.get("pseudo") ? s.get("pseudo") : "Quelqu’un";
  } catch {
    return "Quelqu’un";
  }
}

async function tokensOf(uid) {
  const u = await db.collection("users").doc(uid).get();
  if (!u.exists) return [];
  if (u.get("notificationsEnabled") !== true) return [];
  const snap = await u.ref.collection("fcmTokens").get();
  return snap.docs.map((x) => x.id);
}

async function getTokens(uids) {
  const map = new Map();

  await Promise.all(
    uids.map(async (uid) => {
      map.set(uid, await tokensOf(uid));
    })
  );

  return map;
}

// ======================================================
// NOTIF COPY
// ======================================================
function copyFor(type, subtype, ctx = {}) {
  const {
    lieu = "le club",
    heure = "",
    date = "",
    pseudo = "",
    preview = "",
  } = ctx;

  if (type === "match" && subtype === "new") {
    return {
      title: "Match près de toi",
      body: `Match à ${lieu}${heure ? ` à ${heure}` : ""}.`,
    };
  }

  if (type === "match" && subtype === "join") {
    return {
      title: `${pseudo} rejoint la partie`,
      body: `« ${lieu} »`,
    };
  }

  if (type === "match" && subtype === "leave") {
    return {
      title: `${pseudo} s’est désisté`,
      body: `« ${lieu} »`,
    };
  }

  if (type === "match" && subtype === "reminder_1h") {
    return {
      title: "Match dans 1h",
      body: `« ${lieu} » à ${heure}`,
    };
  }

  if (type === "match" && subtype === "reminder_24h") {
    return {
      title: "Match demain",
      body: date ? `« ${lieu} » ${date}` : `« ${lieu} »`,
    };
  }

  if (type === "match" && subtype === "urgent_plus_one") {
    return {
      title: "🔥 Plus qu’1 joueur",
      body: heure
        ? `${lieu} • ${heure}. Une seule place reste disponible près de toi.`
        : `${lieu}. Une seule place reste disponible près de toi.`,
    };
  }

  if (type === "chat" && subtype === "message") {
    return {
      title: "Nouveau message",
      body: preview || "Message reçu",
    };
  }

  return { title: "Padima", body: "Notification" };
}

// ======================================================
// PAYLOAD APNS
// ======================================================
function apnsPayload(title, body) {
  return {
    headers: { "apns-priority": "10" },
    payload: {
      aps: {
        alert: { title, body },
        sound: "default",
      },
    },
  };
}

// ======================================================
// SENDERS (Android / iOS)
// ======================================================
async function sendDataOnly(tokens, { data }) {
  if (!Array.isArray(tokens) || !tokens.length) return;

  const safeData = Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, String(v)])
  );

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      data: safeData,
      android: { priority: "high" },
    });

    if (res.failureCount) {
      logger.warn("sendDataOnly multicast failures", {
        failureCount: res.failureCount,
        successCount: res.successCount,
      });
    }
  } catch (e) {
    logger.error("sendDataOnly multicast error", e);
  }
}

/**
 * Chat Hybrid :
 * - Android : data-only routing fiable (pas de notification auto "fantôme")
 * - iOS : APS alert visible
 * - data toujours envoyée (routing deep-link)
 */
async function sendChatHybrid(tokens, { title, body, data }) {
  if (!Array.isArray(tokens) || !tokens.length) return;

  const safeData = Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, String(v)])
  );

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      android: { priority: "high" },
      apns: apnsPayload(title, body),
      data: safeData,
    });

    if (res.failureCount) {
      logger.warn("sendChatHybrid multicast failures", {
        failureCount: res.failureCount,
        successCount: res.successCount,
      });
    }
  } catch (e) {
    logger.error("sendChatHybrid multicast error", e);
  }
}

/**
 * Envoi classique visible (match/new/join/leave/reminders)
 */
async function send(tokens, { title, body, data }) {
  if (!Array.isArray(tokens) || !tokens.length) return;

  const safeData = Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, String(v)])
  );

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: safeData,
      android: {
        priority: "high",
        notification: {
          channelId: "matches",
          sound: "default",
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    if (res.failureCount) {
      logger.warn("send multicast failures", {
        failureCount: res.failureCount,
        successCount: res.successCount,
      });
    }
  } catch (e) {
    logger.error("send multicast error", e);
  }
}

// ======================================================
// GARDE-FOUS SERVEUR
// ======================================================
async function hasTimeOverlap(uid, targetMs) {
  const start = targetMs - 2 * HOUR_MS;
  const end = targetMs + 2 * HOUR_MS;
  const friendPrefix = friendMarkerPrefix(uid);

  const [createdSnap, joinedSnap, windowSnap] = await Promise.all([
    db.collection("matches")
      .where("createurUid", "==", uid)
      .where("dateHeure", ">=", start)
      .where("dateHeure", "<=", end)
      .limit(1)
      .get(),
    db.collection("matches")
      .where("participants", "array-contains", uid)
      .where("dateHeure", ">=", start)
      .where("dateHeure", "<=", end)
      .limit(1)
      .get(),
    db.collection("matches")
      .where("dateHeure", ">=", start)
      .where("dateHeure", "<=", end)
      .limit(50)
      .get(),
  ]);

  if (!createdSnap.empty || !joinedSnap.empty) return true;

  for (const doc of windowSnap.docs) {
    const data = doc.data() || {};
    const parts = Array.isArray(data.participants) ? data.participants : [];
    if (parts.some((p) => typeof p === "string" && p.startsWith(friendPrefix))) {
      return true;
    }
  }

  return false;
}

async function hasPlaceConflictKm1(lat, lng, targetMs) {
  const start = targetMs - 2 * HOUR_MS;
  const end = targetMs + 2 * HOUR_MS;

  const snap = await db.collection("matches")
    .where("dateHeure", ">=", start)
    .where("dateHeure", "<=", end)
    .limit(80)
    .get();

  for (const doc of snap.docs) {
    const m = doc.data() || {};
    const coords = getLatLngFromMatchData(m);
    if (!coords) continue;

    const d = distanceMeters(lat, lng, coords.lat, coords.lng);
    if (d <= 1000) return true;
  }

  return false;
}

// ======================================================
// MATCH / USER TARGETING HELPERS
// ======================================================
function getMatchCoords(data) {
  const lat = typeof data.lat === "number" ? data.lat : data.latitude;
  const lng = typeof data.lng === "number" ? data.lng : data.longitude;

  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

function getMatchLevel(data) {
  if (typeof data.level === "number") return data.level;
  if (typeof data.niveau === "number") return data.niveau;
  return null;
}

function getUserLevel(data) {
  if (typeof data.level === "number") return data.level;
  if (typeof data.niveau === "number") return data.niveau;
  return null;
}

function participantOwnsOrJoined(matchData, uid) {
  const participants = Array.isArray(matchData.participants)
    ? matchData.participants
    : [];
  const owner = asString(matchData.createurUid || matchData.creatorUid || "");

  if (owner === uid) return true;

  return participants.some((p) => {
    if (typeof p !== "string") return false;
    return p === uid || p.startsWith(`ami_de_${uid}:`);
  });
}

function isUserEligibleForMatch(userData, uid, matchData, opts = {}) {
  if (userData?.notificationsEnabled !== true) return false;
  if (participantOwnsOrJoined(matchData, uid)) return false;

  const coords = getMatchCoords(matchData);
  if (!coords) return false;

  if (
    typeof userData.notifLat !== "number" ||
    typeof userData.notifLng !== "number" ||
    typeof userData.notifRadiusKm !== "number"
  ) {
    return false;
  }

  const userCoords = { lat: userData.notifLat, lng: userData.notifLng };
  if (distanceKmApprox(userCoords, coords) > userData.notifRadiusKm) return false;

  const matchLevel = getMatchLevel(matchData);
  const userLevel = getUserLevel(userData);
  if (typeof matchLevel === "number" && typeof userLevel === "number") {
    if (Math.abs(matchLevel - userLevel) > 1) return false;
  }

  const matchMs = toMillis(matchData.dateHeure);
  if (!matchMs) return false;

  const now = Date.now();
  if (matchMs <= now) return false;

  if (typeof opts.maxHoursAhead === "number") {
    const maxMs = now + opts.maxHoursAhead * 3600 * 1000;
    if (matchMs > maxMs) return false;
  }

  return true;
}

async function findEligibleRecipients(matchData, opts = {}) {
  const usersSnap = await db.collection("users")
    .where("notificationsEnabled", "==", true)
    .get();

  if (usersSnap.empty) return [];

  const recipients = [];
  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    const userData = doc.data() || {};
    if (isUserEligibleForMatch(userData, uid, matchData, opts)) {
      recipients.push(uid);
    }
  }

  return recipients;
}

// ======================================================
// INTERNAL — push nearby notifications for a given matchId
// ======================================================
async function pushNearbyForMatchId(matchId) {
  const matchSnap = await db.collection("matches").doc(matchId).get();
  if (!matchSnap.exists) return;

  const m = matchSnap.data() || {};
  const lieu = asString(m.lieu || m.placeName || "le club");
  const dateHeure = toMillis(m.dateHeure);
  if (!dateHeure) return;

  const recipientUids = await findEligibleRecipients(m, { maxHoursAhead: 24 });
  if (!recipientUids.length) return;

  const heure = frTime(dateHeure);

  for (const uid of recipientUids) {
    const tokens = await tokensOf(uid);
    if (!tokens.length) continue;

    const copy = copyFor("match", "new", { lieu, heure });

    await send(tokens, {
      title: copy.title,
      body: copy.body,
      data: { type: "match", subtype: "new", matchId },
    });
  }
}

// ======================================================
// CALLABLE — createMatch (SERVER SOURCE OF TRUTH)
// ======================================================
export const createMatch = onCall(RUNTIME, async (req) => {
  try {
    const uid = assertAuth(req);

    const data = req.data ?? {};

    const placeId = asString(data?.placeId);
    const lieu = asString(data?.lieu || data?.placeName || "Club");
    const dateHeure = normalizeDateMs(data?.dateHeure);

    const lat = asNumber(data?.lat) ?? asNumber(data?.latitude);
    const lng = asNumber(data?.lng) ?? asNumber(data?.longitude);

    const niveauRaw = data?.niveau ?? data?.level;
    const niveau = typeof niveauRaw === "number" ? Math.round(niveauRaw) : Number(niveauRaw);

    const descRaw = asString(data?.description);
    const desc = descRaw ? descRaw.trim() : "";

    const joueursManquants = data?.joueursManquants;

    if (!placeId) throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: placeId missing");
    if (!dateHeure) throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: dateHeure missing");
    if (dateHeure <= Date.now()) throw new HttpsError("failed-precondition", "MATCH_PAST");
    if (lat === null || lng === null) {
      throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: lat/lng missing");
    }
    if (!(Number.isFinite(niveau) && niveau >= 1 && niveau <= 10)) {
      throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: niveau invalid");
    }

    const jm = joueursManquants === 1 || joueursManquants === 2 ? joueursManquants : null;
    if (jm === null) {
      throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: joueursManquants must be 1 or 2");
    }

    let overlap = false;
    try {
      overlap = await hasTimeOverlap(uid, dateHeure);
    } catch (e) {
      logger.error("createMatch hasTimeOverlap crash", {
        uid,
        dateHeure,
        err: String(e?.message ?? e),
      });
      throw new HttpsError("internal", "TIME_OVERLAP_INTERNAL");
    }
    if (overlap) throw new HttpsError("failed-precondition", "TIME_OVERLAP");

    let placeConflict = false;
    try {
      placeConflict = await hasPlaceConflictKm1(lat, lng, dateHeure);
    } catch (e) {
      logger.error("createMatch hasPlaceConflictKm1 crash", {
        uid,
        placeId,
        lat,
        lng,
        dateHeure,
        err: String(e?.message ?? e),
      });
      throw new HttpsError("internal", "PLACE_CONFLICT_INTERNAL");
    }
    if (placeConflict) throw new HttpsError("failed-precondition", "PLACE_CONFLICT");

    const participants = [uid];
    if (jm === 1) {
      participants.push(`ami_de_${uid}:Joueur 1`, `ami_de_${uid}:Joueur 2`);
    } else {
      participants.push(`ami_de_${uid}:Joueur 1`);
    }

    let createurPseudo = "";
    let createurAvatar = "";
    try {
      const u = await db.collection("users").doc(uid).get();
      if (u.exists) {
        createurPseudo = asString(u.get("pseudo") || u.get("username"));
        createurAvatar = asString(u.get("avatar"));
      }
    } catch (e) {
      logger.warn("createMatch: user profile read failed", {
        uid,
        err: String(e?.message ?? e),
      });
    }

    const doc = {
      lieu,
      placeName: lieu,
      placeId,
      latitude: lat,
      longitude: lng,
      lat,
      lng,
      dateHeure,
      niveau,
      level: niveau,
      createurUid: uid,
      participants,
      ...(createurPseudo ? { createurPseudo } : {}),
      ...(createurAvatar ? { createurAvatar } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (desc.length > 0) {
      doc.description = desc;
    }

    let ref;
    try {
      ref = await db.collection("matches").add(doc);
    } catch (e) {
      logger.error("createMatch Firestore add failed", {
        uid,
        placeId,
        dateHeure,
        niveau,
        err: String(e?.message ?? e),
      });
      throw new HttpsError("internal", "FIRESTORE_WRITE_FAILED");
    }

    logger.info("createMatch ok", {
      matchId: ref.id,
      uid,
      placeId,
      dateHeure,
      niveau,
      joueursManquants: jm,
    });

    return { ok: true, matchId: ref.id };
  } catch (e) {
    if (e instanceof HttpsError) throw e;

    logger.error("createMatch UNHANDLED INTERNAL", {
      err: String(e?.message ?? e),
      dataKeys: Object.keys(req.data ?? {}),
      uid: req.auth?.uid ?? null,
    });
    throw new HttpsError("internal", "CREATE_MATCH_INTERNAL");
  }
});

// ======================================================
// CALLABLE — joinMatch (SERVER SOURCE OF TRUTH)
// - Compat: Android joinWithFriend / iOS withFriend
// ======================================================
export const joinMatch = onCall(RUNTIME, async (req) => {
  const uid = assertAuth(req);

  const matchId = asString(req.data?.matchId);
  const joinWithFriend = !!(req.data?.joinWithFriend ?? req.data?.withFriend);
  const friendNameRaw = asString(req.data?.friendName);
  const friendName = joinWithFriend ? (friendNameRaw || "Joueur") : null;

  if (!matchId) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: matchId missing");
  }

  if (joinWithFriend && !isValidFriendName(friendName)) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: friendName invalid");
  }

  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new HttpsError("not-found", "MATCH_NOT_FOUND");

  const m = matchSnap.data() || {};
  const dateHeure = normalizeDateMs(m.dateHeure);
  const createurUid = asString(m.createurUid);
  const lieu = asString(m.lieu || m.placeName || "le club");

  if (!dateHeure) {
    throw new HttpsError("failed-precondition", "FAILED_PRECONDITION: MATCH_INVALID_DATE");
  }
  if (dateHeure <= Date.now()) {
    throw new HttpsError("failed-precondition", "MATCH_PAST");
  }
  if (createurUid && createurUid === uid) {
    throw new HttpsError("failed-precondition", "FAILED_PRECONDITION: CREATOR_CANNOT_JOIN");
  }

  if (await hasTimeOverlap(uid, dateHeure)) {
    throw new HttpsError("failed-precondition", "TIME_OVERLAP");
  }

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(matchRef);
    if (!fresh.exists) throw new HttpsError("not-found", "MATCH_NOT_FOUND");

    const data = fresh.data() || {};
    const current = Array.isArray(data.participants) ? data.participants.slice() : [];

    const already =
      current.includes(uid) ||
      current.some((p) => typeof p === "string" && p.startsWith(friendMarkerPrefix(uid)));

    if (already) throw new HttpsError("already-exists", "ALREADY_JOINED");

    const needed = joinWithFriend ? 2 : 1;
    if (current.length + needed > MAX_PLAYERS) {
      throw new HttpsError("failed-precondition", "MATCH_FULL");
    }

    current.push(uid);

    if (joinWithFriend) {
      current.push(`${friendMarkerPrefix(uid)}${friendName}`);
    }

    tx.update(matchRef, {
      participants: current,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("joinMatch ok", { matchId, uid, joinWithFriend });
  return { ok: true, matchId, lieu };
});

// ======================================================
// CALLABLE — leaveMatch
// ======================================================
export const leaveMatch = onCall(RUNTIME, async (req) => {
  const uid = assertAuth(req);

  const matchId = asString(req.data?.matchId);
  if (!matchId) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: matchId missing");
  }

  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new HttpsError("not-found", "MATCH_NOT_FOUND");

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(matchRef);
    if (!fresh.exists) throw new HttpsError("not-found", "MATCH_NOT_FOUND");

    const data = fresh.data() || {};
    const current = Array.isArray(data.participants) ? data.participants.slice() : [];

    const beforeLen = current.length;
    const filtered = current.filter((p) => {
      if (p === uid) return false;
      if (typeof p === "string" && p.startsWith(friendMarkerPrefix(uid))) return false;
      return true;
    });

    if (filtered.length === beforeLen) {
      throw new HttpsError("failed-precondition", "FAILED_PRECONDITION: NOT_IN_MATCH");
    }

    tx.update(matchRef, {
      participants: filtered,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("leaveMatch ok", { matchId, uid });
  return { ok: true, matchId };
});

// ======================================================
// pushNearbyMatch (CALLABLE) — COMPAT PROD
// data: { matchId: string }
// ======================================================
export const pushNearbyMatch = onCall(RUNTIME, async (req) => {
  assertAdmin(req);

  const matchId = asString(req.data?.matchId);
  if (!matchId) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: matchId missing");
  }

  await pushNearbyForMatchId(matchId);
  return { ok: true, matchId };
});

// ======================================================
// pushNearbyMatchTrigger (TRIGGER) — NOUVEAU NOM
// ======================================================
export const pushNearbyMatchTrigger = onDocumentCreated(
  { region: "europe-west1", document: "matches/{matchId}" },
  async (event) => {
    const matchId = event.params.matchId;
    await pushNearbyForMatchId(matchId);
    return null;
  }
);

// ======================================================
// TRIGGER — JOIN / LEAVE + notif urgente 3/4
// ======================================================
export const onMatchParticipantsChange = onDocumentUpdated(
  { region: "europe-west1", document: "matches/{matchId}" },
  async (event) => {
    const matchId = event.params.matchId;

    const beforeRaw = onlyStrings(event.data.before.data()?.participants || []);
    const afterRaw = onlyStrings(event.data.after.data()?.participants || []);

    const before = cleanUids(beforeRaw);
    const after = cleanUids(afterRaw);

    const joined = after.filter((p) => !before.includes(p));
    const left = before.filter((p) => !after.includes(p));

    const beforeCount = beforeRaw.length;
    const afterCount = afterRaw.length;
    const becameOnePlayerAway = beforeCount !== 3 && afterCount === 3;

    if (!joined.length && !left.length && !becameOnePlayerAway) return null;

    const m = event.data.after.data() || {};
    const lieu = asString(m.lieu || m.placeName || "le club");
    const createurUid = asString(m.createurUid || m.creatorUid);

    const recipients = new Set(after);
    if (createurUid) recipients.add(createurUid);
    joined.forEach((u) => recipients.delete(u));
    left.forEach((u) => recipients.delete(u));

    const ops = [];

    for (const uid of recipients) {
      const tokens = await tokensOf(uid);
      if (!tokens.length) continue;

      for (const j of joined) {
        const copy = copyFor("match", "join", {
          pseudo: await pseudoOf(j),
          lieu,
        });
        ops.push(
          send(tokens, {
            title: copy.title,
            body: copy.body,
            data: { type: "match", subtype: "join", matchId },
          })
        );
      }

      for (const l of left) {
        const copy = copyFor("match", "leave", {
          pseudo: await pseudoOf(l),
          lieu,
        });
        ops.push(
          send(tokens, {
            title: copy.title,
            body: copy.body,
            data: { type: "match", subtype: "leave", matchId },
          })
        );
      }
    }

    if (becameOnePlayerAway) {
      const urgentRecipientUids = await findEligibleRecipients(m, { maxHoursAhead: 12 });

      for (const uid of urgentRecipientUids) {
        const tokens = await tokensOf(uid);
        if (!tokens.length) continue;

        const copy = copyFor("match", "urgent_plus_one", {
          lieu,
          heure: toMillis(m.dateHeure) ? frTime(toMillis(m.dateHeure)) : "",
        });

        ops.push(
          send(tokens, {
            title: copy.title,
            body: copy.body,
            data: {
              type: "nearby_match_urgent",
              urgency: "plus_one",
              matchId,
            },
          })
        );
      }
    }

    await Promise.all(ops);
    return null;
  }
);

// ======================================================
// CRON — REMINDERS (1h)
// ======================================================
export const notifyOneHourBeforeMatchCron = onSchedule(
  { ...RUNTIME_SCHEDULE, schedule: "every 5 minutes", timeZone: "Europe/Paris" },
  async () => {
    const now = Date.now();
    const min = now + 60 * 60 * 1000 - 5 * 60 * 1000;
    const max = now + 60 * 60 * 1000 + 5 * 60 * 1000;

    logger.info("cron H-1 tick", { now, min, max });

    const snap = await db.collection("matches")
      .where("dateHeure", ">=", min)
      .where("dateHeure", "<=", max)
      .get();

    logger.info("cron H-1 matches", { count: snap.size });

    for (const doc of snap.docs) {
      const m = doc.data();
      const matchId = doc.id;

      const players = cleanUids(m.participants);
      const lieu = asString(m.lieu || m.placeName || "le club");
      const dateHeure = normalizeDateMs(m.dateHeure);

      logger.info("cron H-1 match", {
        matchId,
        dateHeure,
        playersCount: players.length,
        lieu,
      });

      for (const uid of players) {
        const tokens = await tokensOf(uid);
        logger.info("cron H-1 user", { matchId, uid, tokensCount: tokens.length });

        if (!tokens.length) continue;

        const copy = copyFor("match", "reminder_1h", {
          lieu,
          heure: frTime(dateHeure),
        });

        await send(tokens, {
          title: copy.title,
          body: copy.body,
          data: { type: "match", subtype: "reminder_1h", matchId },
        });
      }
    }
  }
);

// ======================================================
// CRON — REMINDERS (24h)
// ======================================================
export const notify24HoursBeforeMatchCron = onSchedule(
  { ...RUNTIME_SCHEDULE, schedule: "every 30 minutes", timeZone: "Europe/Paris" },
  async () => {
    const now = Date.now();
    const min = now + 24 * HOUR_MS - 30 * 60 * 1000;
    const max = now + 24 * HOUR_MS + 30 * 60 * 1000;

    logger.info("cron H-24 tick", { now, min, max });

    const snap = await db.collection("matches")
      .where("dateHeure", ">=", min)
      .where("dateHeure", "<=", max)
      .get();

    logger.info("cron H-24 matches", { count: snap.size });

    for (const doc of snap.docs) {
      const m = doc.data();
      const matchId = doc.id;

      const players = cleanUids(m.participants);
      const lieu = asString(m.lieu || m.placeName || "le club");
      const copy = copyFor("match", "reminder_24h", {
        lieu,
        date: frDate(normalizeDateMs(m.dateHeure)),
      });

      for (const uid of players) {
        const tokens = await tokensOf(uid);
        if (!tokens.length) continue;

        await send(tokens, {
          title: copy.title,
          body: copy.body,
          data: { type: "match", subtype: "reminder_24h", matchId },
        });
      }
    }
  }
);

// ======================================================
// CHAT — callable + trigger (compat prod)
// ✅ Android = data-only
// ✅ iOS = APS alert
// ======================================================
export const sendChatNotification = onCall(RUNTIME, async (req) => {
  const fromUid = assertAuth(req);

  const toUid = asString(req.data?.toUid);
  const matchId = asString(req.data?.matchId);
  const preview = asString(req.data?.preview);

  if (!toUid) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: toUid missing");
  }
  if (!matchId) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: matchId missing");
  }

  const tokens = await tokensOf(toUid);
  if (!tokens.length) return { ok: true, sent: false };

  const copy = copyFor("chat", "message", {
    preview: preview || "Message reçu",
  });

  await sendChatHybrid(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: "chat",
      subtype: "message",
      matchId,
      senderUid: fromUid,
      otherUid: fromUid,
      title: copy.title,
      body: copy.body,
    },
  });

  return { ok: true, sent: true };
});

export const notifyOnNewMessage = onDocumentCreated(
  { region: "europe-west1", document: "messages/{messageId}" },
  async (event) => {
    const msg = event.data.data() || {};

    const senderUid = asString(msg.senderUid);
    const receiverUid = asString(msg.receiverUid);
    const matchId = asString(msg.matchId);
    const text = asString(msg.text);

    if (!receiverUid || !matchId) return null;
    if (senderUid && senderUid === receiverUid) return null;

    const tokens = await tokensOf(receiverUid);
    if (!tokens.length) return null;

    const copy = copyFor("chat", "message", {
      preview: text ? text.slice(0, 120) : "Message reçu",
    });

    await sendChatHybrid(tokens, {
      title: copy.title,
      body: copy.body,
      data: {
        type: "chat",
        subtype: "message",
        matchId,
        senderUid: senderUid || "",
        otherUid: senderUid || "",
        title: copy.title,
        body: copy.body,
      },
    });

    return null;
  }
);

// ======================================================
// CLUBS — admin approve/reject (compat prod)
// ======================================================
export const approveClubSuggestion = onCall(RUNTIME, async (req) => {
  assertAdmin(req);

  const suggestionId = asString(req.data?.suggestionId);
  if (!suggestionId) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: suggestionId missing");
  }

  const sugRef = db.collection("clubSuggestions").doc(suggestionId);
  const sugSnap = await sugRef.get();
  if (!sugSnap.exists) throw new HttpsError("not-found", "SUGGESTION_NOT_FOUND");

  const s = sugSnap.data() || {};
  const placeId = asString(s.placeId);
  const name = asString(s.name);
  const formattedAddress = asString(s.formattedAddress);
  const lat = asNumber(s.lat);
  const lng = asNumber(s.lng);

  if (!placeId || !name || !formattedAddress || lat === null || lng === null) {
    throw new HttpsError("failed-precondition", "SUGGESTION_INVALID");
  }

  const clubRef = db.collection("clubs").doc(placeId);

  await db.runTransaction(async (tx) => {
    tx.set(
      clubRef,
      {
        placeId,
        name,
        formattedAddress,
        lat,
        lng,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(sugRef, {
      status: "approved",
      approvedAt: FieldValue.serverTimestamp(),
      clubPlaceId: placeId,
    });
  });

  return { ok: true, placeId };
});

export const rejectClubSuggestion = onCall(RUNTIME, async (req) => {
  assertAdmin(req);

  const suggestionId = asString(req.data?.suggestionId);
  const reason = asString(req.data?.reason);

  if (!suggestionId) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: suggestionId missing");
  }

  const sugRef = db.collection("clubSuggestions").doc(suggestionId);
  const sugSnap = await sugRef.get();
  if (!sugSnap.exists) throw new HttpsError("not-found", "SUGGESTION_NOT_FOUND");

  await sugRef.update({
    status: "rejected",
    rejectedAt: FieldValue.serverTimestamp(),
    ...(reason ? { rejectionReason: reason } : {}),
  });

  return { ok: true };
});

// ======================================================
// BROADCAST — admin (compat prod)
// ======================================================
export const broadcastAdmin = onCall(RUNTIME, async (req) => {
  assertAdmin(req);

  const title = asString(req.data?.title) || "Padima";
  const body = asString(req.data?.body) || "";
  if (!body) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: body missing");
  }

  await messaging.send({
    topic: "all",
    notification: { title, body },
    data: { type: "admin", subtype: "broadcast" },
  });

  return { ok: true };
});

export const broadcastMarketing = onCall(RUNTIME, async (req) => {
  assertAdmin(req);

  const title = asString(req.data?.title) || "Padima";
  const body = asString(req.data?.body) || "";
  if (!body) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: body missing");
  }

  await messaging.send({
    topic: "all",
    notification: { title, body },
    data: { type: "admin", subtype: "marketing" },
  });

  return { ok: true };
});

// ======================================================
// DELETE ACCOUNT — compat prod
// ======================================================
export const deleteAccount = onCall(RUNTIME, async (req) => {
  const uid = assertAuth(req);

  try {
    const userRef = db.collection("users").doc(uid);
    const tokensSnap = await userRef.collection("fcmTokens").get();
    await Promise.all(tokensSnap.docs.map((d) => d.ref.delete()));
    await userRef.delete();
  } catch (e) {
    logger.warn("deleteAccount: firestore cleanup failed", e);
  }

  await authAdmin.deleteUser(uid);
  return { ok: true };
});

export const deleteUserAccount = onCall(RUNTIME, async (req) => {
  assertAdmin(req);

  const targetUid = asString(req.data?.uid);
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT: uid missing");
  }

  try {
    const userRef = db.collection("users").doc(targetUid);
    const tokensSnap = await userRef.collection("fcmTokens").get();
    await Promise.all(tokensSnap.docs.map((d) => d.ref.delete()));
    await userRef.delete();
  } catch (e) {
    logger.warn("deleteUserAccount: firestore cleanup failed", e);
  }

  await authAdmin.deleteUser(targetUid);
  return { ok: true };
});
