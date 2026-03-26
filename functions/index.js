// ======================================================
// PadelMatch – Cloud Functions (Node 22, Admin SDK 12) – Gen2
// Version propre – Android + iOS – Mode A (broadcast)
// ======================================================

import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

// -------------------------------------------------------
// Init
// -------------------------------------------------------
const app = initializeApp();
const db = getFirestore(app);
const messaging = getMessaging(app);

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
const isFriendMarker = (p) =>
  typeof p === "string" && p.startsWith("ami_de_");

const onlyStrings = (list) =>
  Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];

const cleanUids = (list) =>
  onlyStrings(list).filter((p) => !isFriendMarker(p));

const mask = (t) => {
  if (!t || typeof t !== "string") return String(t);
  if (t.length <= 12) return `***${t}`;
  return `${t.slice(0, 4)}…${t.slice(-8)}`;
};

async function pseudoOf(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists && snap.get("pseudo") ? snap.get("pseudo") : "Quelqu’un";
  } catch {
    return "Quelqu’un";
  }
}

function frDate(ms) {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function frTime(ms) {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

// -------------------------------------------------------
// Texte notifications (Mode A – tes nouveaux titres)
// -------------------------------------------------------
function copyFor(type, ctx = {}) {
  const {
    lieu = "le club",
    heure = "",
    date = "",
    pseudo = "",
    distance = "",
    preview = "",
  } = ctx;

  switch (type) {
    case "nearby_match":
      return {
        title: "Ça joue près de toi",
        body: `Match à ${lieu}${heure ? ` à ${heure}` : ""}.`
      };

    case "new_match":
      return {
        title: `Nouveau spot à ${lieu}`,
        body: `Places libres${heure ? `, départ ${heure}` : ""}${distance ? ` · ${distance} km` : ""}.`
      };

    case "reminder_24h":
      return {
        title: "Demain, ça joue",
        body: `« ${lieu} » demain à ${date}.`
      };

    case "reminder_1h":
      return {
        title: "Échauffement dans 1h",
        body: `« ${lieu} » à ${heure}.`
      };

    case "match_join":
      return {
        title: `${pseudo} rejoint la partie`,
        body: `« ${lieu} ». Ça se remplit — verrouille ta place.`
      };

    case "match_leave":
      return {
        title: `${pseudo} s’est désisté`,
        body: `« ${lieu} ». Une place se libère.`
      };

    case "chat":
      return {
        title: "Nouveau message",
        body: (pseudo ? `De ${pseudo} — ` : "") + preview
      };

    default:
      return { title: "PadelMatch", body: "Notification" };
  }
}

// -------------------------------------------------------
// Token loader
// -------------------------------------------------------
async function getTokens(uids) {
  const result = new Map();

  await Promise.all(
    uids.map(async (uid) => {
      const tokens = new Set();

      try {
        const doc = await db.collection("fcmTokens").doc(uid).get();
        if (doc.exists) {
          const d = doc.data() || {};
          if (Array.isArray(d.tokens)) d.tokens.forEach((t) => t && tokens.add(String(t)));
          if (typeof d.token === "string") tokens.add(d.token);
          if (d.fcmTokens && typeof d.fcmTokens === "object")
            Object.keys(d.fcmTokens).forEach((k) => tokens.add(k));
        }
      } catch {}

      try {
        const doc = await db.collection("users").doc(uid).get();
        if (doc.exists) {
          const d = doc.data() || {};
          if (Array.isArray(d.tokens)) d.tokens.forEach((t) => t && tokens.add(String(t)));
          if (typeof d.fcmToken === "string") tokens.add(d.fcmToken);
          if (d.fcmTokens && typeof d.fcmTokens === "object")
            Object.keys(d.fcmTokens).forEach((k) => tokens.add(k));
        }
      } catch {}

      try {
        const sub = await db.collection("users").doc(uid).collection("fcmTokens").get();
        sub.docs.forEach((d) => tokens.add(d.id));
      } catch {}

      result.set(uid, [...tokens]);
    })
  );

  return result;
}

// -------------------------------------------------------
// Purge invalid tokens
// -------------------------------------------------------
async function purgeTokens(uid, tokens) {
  const userRef = db.collection("users").doc(uid);
  const fcmRef = db.collection("fcmTokens").doc(uid);

  const delMap = {};
  tokens.forEach((t) => (delMap[`fcmTokens.${t}`] = FieldValue.delete()));

  await Promise.all([
    fcmRef.set({ tokens: FieldValue.arrayRemove(...tokens) }, { merge: true }).catch(() => {}),
    fcmRef.set(delMap, { merge: true }).catch(() => {}),
    userRef.set({ tokens: FieldValue.arrayRemove(...tokens) }, { merge: true }).catch(() => {}),
    userRef.set(delMap, { merge: true }).catch(() => {}),
  ]);
}

// -------------------------------------------------------
// Payload APNs
// -------------------------------------------------------
function apnsPayload(title, body, data) {
  const d = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  return {
    payload: {
      aps: { alert: { title, body }, sound: "default" },
      ...d,
    },
  };
}

// -------------------------------------------------------
// Match / user targeting helpers
// -------------------------------------------------------
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

function distanceKm(a, b) {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111;
}

function participantOwnsOrJoined(matchData, uid) {
  const participants = Array.isArray(matchData.participants) ? matchData.participants : [];
  const owner = matchData.createurUid || matchData.creatorUid || "";

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
  if (distanceKm(userCoords, coords) > userData.notifRadiusKm) return false;

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

// -------------------------------------------------------
// Envoi APNs + FCM
// -------------------------------------------------------
async function send(uid, tokens, title, body, data) {
  const d = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const apns = apnsPayload(title, body, d);

  try {
    const res = await messaging.sendEachForMulticast({
      notification: { title, body },
      data: d,
      apns,
      tokens,
    });

    const failures = res.responses
      .map((r, i) => (!r.success ? { token: tokens[i], code: r.error?.code } : null))
      .filter(Boolean);

    const dead = failures
      .filter((f) =>
        f.code === "messaging/invalid-registration-token" ||
        f.code === "messaging/registration-token-not-registered"
      )
      .map((f) => f.token);

    if (dead.length) await purgeTokens(uid, dead);

    return res;
  } catch (e) {
    logger.error("FCM:error", e);
    return null;
  }
}

// ======================================================
// CALLABLE — Test direct
// ======================================================
export const pushNearbyMatch = onCall({ region: "europe-west1" }, async (req) => {
  const { token, matchId, lieu = "", heure = "" } = req.data || {};
  if (!token || !matchId) throw new HttpsError("invalid-argument");

  const deeplink = `padelmatch://match/${matchId}`;
  const { title, body } = copyFor("nearby_match", { lieu, heure });

  return await messaging.send({
    token,
    notification: { title, body },
    data: { type: "nearby_match", matchId, deeplink },
    apns: apnsPayload(title, body, { type: "nearby_match", matchId, deeplink }),
  });
});

// ======================================================
// Trigger — NEW MATCH (Mode A)
// ======================================================
export const notifyUsersOnNewMatch = onDocumentCreated(
  { region: "europe-west1", document: "matches/{matchId}" },
  async (event) => {
    const matchId = event.params.matchId;
    const data = event.data?.data() || {};
    const lieu = data.lieu || data.placeName || "Match";
    const matchMs = toMillis(data.dateHeure);
    const heure = matchMs ? frTime(matchMs) : "";

    const recipientUids = await findEligibleRecipients(data, { maxHoursAhead: 24 });
    if (!recipientUids.length) return null;

    const tokensByUid = await getTokens(recipientUids);
    const deeplink = `padelmatch://match/${matchId}`;
    const { title, body } = copyFor("nearby_match", { lieu, heure });

    const ops = [];

    for (const [uid, tokens] of tokensByUid.entries()) {
      if (!tokens.length) continue;

      ops.push(
        send(uid, tokens, title, body, {
          type: "nearby_match",
          matchId,
          lieu,
          heure,
          deeplink,
        })
      );
    }

    await Promise.all(ops);
    return null;
  }
);

// ======================================================
// Trigger — CHAT (avec otherUid obligatoire pour iOS)
// ======================================================
export const notifyOnNewMessage = onDocumentCreated(
  { region: "europe-west1", document: "messages/{messageId}" },
  async (event) => {
    const m = event.data?.data();
    if (!m) return null;

    const { senderUid, receiverUid, matchId, text = "" } = m;
    if (!senderUid || !receiverUid || senderUid === receiverUid) return null;

    const senderName = await pseudoOf(senderUid);

    const tokensByUid = await getTokens([receiverUid]);
    const tokens = tokensByUid.get(receiverUid) || [];
    if (!tokens.length) return null;

    const preview = text.length <= 120 ? text : text.slice(0, 117) + "…";

    const { title, body } = copyFor("chat", {
      pseudo: senderName,
      preview,
    });

    const payload = {
      type: "chat",
      matchId,
      otherUid: senderUid,   // *** CRUCIAL POUR iOS ***
      senderUid,
      preview,
      deeplink: `padelmatch://chat/${matchId}/${senderUid}`,
    };

    await send(receiverUid, tokens, title, body, payload);

    return null;
  }
);

// ======================================================
// Trigger — join / leave + notif urgente 3/4
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

    const data = event.data.after.data() || {};
    const lieu = data.lieu || data.placeName || "Match";

    const owner = data.createurUid || data.creatorUid;
    const recipients = new Set(after);
    if (owner) recipients.add(owner);

    joined.forEach((p) => recipients.delete(p));
    left.forEach((p) => recipients.delete(p));

    const tokensByUid = await getTokens([...recipients]);
    const ops = [];

    for (const j of joined) {
      const { title, body } = copyFor("match_join", {
        pseudo: await pseudoOf(j),
        lieu,
      });

      for (const [uid, tokens] of tokensByUid.entries()) {
        if (!tokens.length) continue;
        ops.push(send(uid, tokens, title, body, { type: "match_join", matchId }));
      }
    }

    for (const l of left) {
      const { title, body } = copyFor("match_leave", {
        pseudo: await pseudoOf(l),
        lieu,
      });

      for (const [uid, tokens] of tokensByUid.entries()) {
        if (!tokens.length) continue;
        ops.push(send(uid, tokens, title, body, { type: "match_leave", matchId }));
      }
    }

    if (becameOnePlayerAway) {
      const urgentRecipientUids = await findEligibleRecipients(data, { maxHoursAhead: 12 });
      const urgentTokensByUid = await getTokens(urgentRecipientUids);

      const matchMs = toMillis(data.dateHeure);
      const heure = matchMs ? frTime(matchMs) : "";
      const deeplink = `padelmatch://match/${matchId}`;

      const title = "🔥 Plus qu’1 joueur";
      const body = heure
        ? `${lieu} • ${heure}. Une seule place reste disponible près de toi.`
        : `${lieu}. Une seule place reste disponible près de toi.`;

      for (const [uid, tokens] of urgentTokensByUid.entries()) {
        if (!tokens.length) continue;

        ops.push(
          send(uid, tokens, title, body, {
            type: "nearby_match_urgent",
            urgency: "plus_one",
            matchId,
            lieu,
            heure,
            deeplink,
          })
        );
      }
    }

    await Promise.all(ops);
    return null;
  }
);

// ======================================================
// CRON — Rappels H-24 / H-1
// ======================================================
export const remind24hBefore = onSchedule(
  { region: "europe-west1", schedule: "every 5 minutes", timeZone: "Europe/Paris" },
  async () => {
    await remindForDelta(24);
  }
);

export const remindOneHourBefore = onSchedule(
  { region: "europe-west1", schedule: "every 5 minutes", timeZone: "Europe/Paris" },
  async () => {
    await remindForDelta(1);
  }
);

async function remindForDelta(hours) {
  const now = Date.now();
  const delta = hours * 3600 * 1000;
  const win = 5 * 60 * 1000;

  const min = now + delta - win;
  const max = now + delta + win;

  const snap = await db
    .collection("matches")
    .where("dateHeure", ">=", min)
    .where("dateHeure", "<=", max)
    .get();

  for (const doc of snap.docs) {
    const m = doc.data();
    const matchId = doc.id;
    const lieu = m.lieu || m.placeName || "Match";
    const players = cleanUids(m.participants || []);
    if (!players.length) continue;

    const tokensByUid = await getTokens(players);

    const { title, body } =
      hours === 24
        ? copyFor("reminder_24h", { lieu, date: frDate(m.dateHeure) })
        : copyFor("reminder_1h", { lieu, heure: frTime(m.dateHeure) });

    for (const [uid, tokens] of tokensByUid.entries()) {
      if (!tokens.length) continue;
      await send(uid, tokens, title, body, {
        type: "reminder",
        matchId,
      });
    }
  }
}

// ======================================================
// Legacy (nécessaire pour supprimer les anciennes fonctions)
// ======================================================
export const sendChatNotification = onCall({ region: "europe-west1" }, async () => {
  throw new HttpsError("failed-precondition", "DEPRECATED");
});
export const notifyOneHourBeforeMatch = onCall({ region: "europe-west1" }, async () => {
  throw new HttpsError("failed-precondition", "DEPRECATED");
});
export const notify24HoursBeforeMatch = onCall({ region: "europe-west1" }, async () => {
  throw new HttpsError("failed-precondition", "DEPRECATED");
});
export const deleteAccount = onCall({ region: "europe-west1" }, async () => {
  throw new HttpsError("failed-precondition", "DEPRECATED");
});
export const deleteUserAccount = onCall({ region: "europe-west1" }, async () => {
  throw new HttpsError("failed-precondition", "DEPRECATED");
});
