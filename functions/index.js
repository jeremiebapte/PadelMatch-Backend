// ======================================================
// index.js – PadelMatch Backend (Node 22, Admin SDK 12)
// Version UNIQUE, stable, Android + iOS
// ======================================================

import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

// Init
const app = initializeApp();
const db = getFirestore(app);
const messaging = getMessaging(app);

// -----------------------------
// Helpers
// -----------------------------
const isFriendMarker = (p) => typeof p === "string" && p.startsWith("ami_de_");
const onlyStrings = (list) =>
  Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
const cleanUids = (list) => onlyStrings(list).filter((p) => !isFriendMarker(p));

const mask = (t) => {
  if (!t || typeof t !== "string") return String(t);
  if (t.length <= 12) return `***${t}`;
  return `${t.slice(0, 4)}…${t.slice(-8)}`;
};

async function pseudoOf(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return (snap.exists && snap.get("pseudo")) || "Quelqu’un";
  } catch {
    return "Quelqu’un";
  }
}

function sanitizeFriendName(raw) {
  const s = (raw ?? "").toString().trim().replaceAll(":", "·");
  return s.length ? s.slice(0, 40) : "Ami";
}

function parseDateHeure(v) {
  if (v && typeof v.toDate === "function") return v.toDate();
  if (typeof v === "number") return new Date(v > 1_000_000_000_000 ? v : v * 1000);
  return null;
}

/* ======================================================
   TRIGGER — notifyUsersOnNewMatch : Nouveau match créé
   ====================================================== */

export const notifyUsersOnNewMatch = onDocumentCreated(
  { document: "matches/{matchId}", region: "europe-west1" },
  async (event) => {
    const matchId = event.params.matchId;
    const snap = event.data;
    if (!snap) return null;

    const match = snap.data() || {};
    const lieu = match.lieu || match.placeName || "";

    // Compat : supporte latitude/longitude ET lat/lng
    const rawLat =
      typeof match.latitude === "number" ? match.latitude : match.lat;
    const rawLng =
      typeof match.longitude === "number" ? match.longitude : match.lng;
    const lat = rawLat;
    const lng = rawLng;

    const niveau = match.niveau ?? null;

    logger.info("notifyUsersOnNewMatch:start", {
      matchId,
      lieu,
      lat,
      lng,
      niveau,
    });

    // Protection : match sans localisation → pas de ciblage
    if (typeof lat !== "number" || typeof lng !== "number") {
      logger.warn("notifyUsersOnNewMatch:no-location", {
        matchId,
        latType: typeof lat,
        lngType: typeof lng,
      });
      return null;
    }

    // 1) Récupération des utilisateurs avec notifications activées
    const usersSnap = await db
      .collection("users")
      .where("notificationsEnabled", "==", true)
      .get();

    logger.info("notifyUsersOnNewMatch:eligibleUsers", {
      count: usersSnap.size,
    });

    if (usersSnap.empty) return null;

    // 2) Filtrage par rayon
    const EARTH = 6371; // km
    function distanceKm(aLat, aLng, bLat, bLng) {
      const dLat = ((bLat - aLat) * Math.PI) / 180;
      const dLng = ((bLng - aLng) * Math.PI) / 180;
      const lat1 = (aLat * Math.PI) / 180;
      const lat2 = (bLat * Math.PI) / 180;

      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

      return 2 * EARTH * Math.asin(Math.sqrt(x));
    }

    const recipients = [];

    usersSnap.forEach((doc) => {
      const u = doc.data() || {};
      const uid = doc.id;

      const rLat = u.notifLat;
      const rLng = u.notifLng;
      const radius = u.notifRadiusKm || 5;

      if (
        typeof rLat !== "number" ||
        typeof rLng !== "number" ||
        typeof radius !== "number"
      ) {
        return;
      }

      const d = distanceKm(rLat, rLng, lat, lng);
      if (d <= radius) {
        recipients.push(uid);
      }
    });

    logger.info("notifyUsersOnNewMatch:recipientsFiltered", {
      matchId,
      count: recipients.length,
      recipients,
    });

    if (!recipients.length) return null;

    // 3) Récupération des tokens
    const tokensByUid = await getTokens(recipients);

    // 4) Payload enrichi
    const title = "Nouveau match proche de toi";
    const body = lieu
      ? `Un match vient d’être créé à ${lieu}.`
      : "Un nouveau match a été créé près de toi.";

    const sends = [];

    for (const [uid, tokens] of tokensByUid.entries()) {
      if (!tokens.length) continue;

      logger.info("notifyUsersOnNewMatch:send", {
        uid,
        tokenPreview: mask(tokens[0]),
        matchId,
      });

      sends.push(
        send(uid, tokens, title, body, {
          type: "new_match",
          matchId,
          lieu: lieu || "",
          lat: String(lat),
          lng: String(lng),
        })
      );
    }

    await Promise.all(sends);

    logger.info("notifyUsersOnNewMatch:done", {
      matchId,
      sentTo: recipients.length,
    });

    return null;
  }
);

// ======================================================
// Token loader — UNIVERSAL (Android old/new + iOS)
// ======================================================
async function getTokens(uids) {
  const map = new Map();

  await Promise.all(
    uids.map(async (uid) => {
      const all = new Set();

      // root fcmTokens/{uid}
      try {
        const doc = await db.collection("fcmTokens").doc(uid).get();
        if (doc.exists) {
          const d = doc.data() || {};
          if (Array.isArray(d.tokens))
            d.tokens.forEach((t) => t && all.add(String(t)));
          if (typeof d.token === "string") all.add(d.token);
          if (d.fcmTokens && typeof d.fcmTokens === "object")
            Object.keys(d.fcmTokens).forEach((k) => all.add(k));
        }
      } catch {}

      // users/{uid}
      try {
        const doc = await db.collection("users").doc(uid).get();
        if (doc.exists) {
          const d = doc.data() || {};
          if (Array.isArray(d.tokens))
            d.tokens.forEach((t) => t && all.add(String(t)));
          if (typeof d.fcmToken === "string") all.add(d.fcmToken);
          if (d.fcmTokens && typeof d.fcmTokens === "object")
            Object.keys(d.fcmTokens).forEach((k) => all.add(k));
        }
      } catch {}

      // subcollection users/{uid}/fcmTokens/{token}
      try {
        const sub = await db
          .collection("users")
          .doc(uid)
          .collection("fcmTokens")
          .get();
        sub.docs.forEach((d) => all.add(d.id));
      } catch {}

      map.set(uid, [...all]);
    })
  );

  return map;
}

// ======================================================
// Purge invalid tokens
// ======================================================
async function purgeTokens(uid, tokens) {
  const userRef = db.collection("users").doc(uid);
  const fcmRef = db.collection("fcmTokens").doc(uid);

  const delObj = {};
  tokens.forEach((t) => (delObj[`fcmTokens.${t}`] = FieldValue.delete()));

  await Promise.all([
    fcmRef
      .set({ tokens: FieldValue.arrayRemove(...tokens) }, { merge: true })
      .catch(() => {}),
    fcmRef.set(delObj, { merge: true }).catch(() => {}),
    userRef
      .set({ tokens: FieldValue.arrayRemove(...tokens) }, { merge: true })
      .catch(() => {}),
    userRef.set(delObj, { merge: true }).catch(() => {}),
  ]);
}

// ======================================================
// Unified FCM sender
// ======================================================
async function send(uid, tokens, title, body, data) {
  try {
    logger.info("FCM:send", { uid, title, tokens: tokens.map(mask) });

    const res = await messaging.sendEachForMulticast({
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      tokens,
    });

    const failures = res.responses
      .map((r, i) =>
        !r.success
          ? { token: tokens[i], code: r.error?.code, msg: r.error?.message }
          : null
      )
      .filter(Boolean);

    if (failures.length)
      logger.error(
        "FCM:failures",
        failures.map((f) => ({ token: mask(f.token), code: f.code }))
      );

    const dead = failures
      .filter(
        (f) =>
          f.code === "messaging/registration-token-not-registered" ||
          f.code === "messaging/invalid-registration-token"
      )
      .map((f) => f.token);

    if (dead.length) {
      logger.info("FCM:purge", { uid, count: dead.length });
      await purgeTokens(uid, dead);
    }

    return res;
  } catch (e) {
    logger.error("FCM:error", e);
    return null;
  }
}

// ======================================================
// CALLABLE — joinMatch
// ======================================================
export const joinMatch = onCall({ region: "europe-west1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated");

  const matchId = req.data?.matchId;
  if (!matchId) throw new HttpsError("invalid-argument");

  logger.info("joinMatch:start", { uid, matchId });

  const ref = db.collection("matches").doc(matchId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found");

      const data = snap.data();
      const parts = onlyStrings(data.participants || []);
      const capacity = Number.isInteger(data.capacity) ? data.capacity : 4;

      if (parts.includes(uid)) throw new HttpsError("already-exists");
      if (parts.length >= capacity) throw new HttpsError("failed-precondition");

      parts.push(uid);

      tx.update(ref, { participants: parts });
    });

    return { ok: true };
  } catch (e) {
    logger.error("joinMatch:error", e);
    throw e instanceof HttpsError ? e : new HttpsError("internal");
  }
});

// ======================================================
// CALLABLE — leaveMatch
// ======================================================
export const leaveMatch = onCall({ region: "europe-west1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated");

  const matchId = req.data?.matchId;
  if (!matchId) throw new HttpsError("invalid-argument");

  logger.info("leaveMatch:start", { uid, matchId });

  const ref = db.collection("matches").doc(matchId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found");

      const data = snap.data();
      const prefix = `ami_de_${uid}:`;

      const next = onlyStrings(data.participants || []).filter(
        (p) => p !== uid && !p.startsWith(prefix)
      );

      tx.update(ref, { participants: next });
    });

    return { ok: true };
  } catch (e) {
    logger.error("leaveMatch:error", e);
    throw e instanceof HttpsError ? e : new HttpsError("internal");
  }
});

// ======================================================
// TRIGGER — notifyOnNewMessage
// ======================================================
export const notifyOnNewMessage = onDocumentCreated(
  { document: "messages/{messageId}", region: "europe-west1" },
  async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const msg = snap.data();
    const receiverUid = msg.receiverUid;
    const senderUid = msg.senderUid;
    const matchId = msg.matchId;
    const text = msg.text || "";

    logger.info("notifyOnNewMessage:start", { matchId, senderUid, receiverUid });

    if (!receiverUid || !senderUid) return null;
    if (receiverUid === senderUid) return null;

    const [senderName, tokensByUid] = await Promise.all([
      pseudoOf(senderUid),
      getTokens([receiverUid]),
    ]);

    const tokens = tokensByUid.get(receiverUid) || [];
    if (!tokens.length) return null;

    const title = `${senderName} t’a envoyé un message`;
    const body = text.length <= 120 ? text : text.slice(0, 117) + "…";

    await send(receiverUid, tokens, title, body, {
      type: "chat",
      matchId,
      senderUid,
    });

    return null;
  }
);

// ======================================================
// TRIGGER — onMatchParticipantsChange
// ======================================================
export const onMatchParticipantsChange = onDocumentUpdated(
  { document: "matches/{matchId}", region: "europe-west1" },
  async (event) => {
    const matchId = event.params.matchId;

    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};

    const beforeParts = cleanUids(before.participants || []);
    const afterParts = cleanUids(after.participants || []);

    const joined = afterParts.filter((p) => !beforeParts.includes(p));
    const left = beforeParts.filter((p) => !afterParts.includes(p));

    if (joined.length === 0 && left.length === 0) return null;

    const ownerUid =
      after.createurUid ||
      after.creatorUid ||
      before.createurUid ||
      before.creatorUid;

    const recipients = new Set();

    if (ownerUid) recipients.add(ownerUid);
    afterParts.forEach((p) => recipients.add(p));
    joined.forEach((p) => recipients.delete(p));
    left.forEach((p) => recipients.delete(p));

    const tokensByUid = await getTokens([...recipients]);
    const lieu = after.lieu || after.placeName || "Match";

    const ops = [];

    for (const j of joined) {
      const body = `${await pseudoOf(j)} a rejoint « ${lieu} ».`;
      for (const [uid, tokens] of tokensByUid.entries()) {
        if (tokens.length)
          ops.push(
            send(uid, tokens, "Nouveau joueur", body, {
              type: "match_join",
              matchId,
            })
          );
      }
    }

    for (const l of left) {
      const body = `${await pseudoOf(l)} s’est désisté de « ${lieu} ».`;
      for (const [uid, tokens] of tokensByUid.entries()) {
        if (tokens.length)
          ops.push(
            send(uid, tokens, "Désistement", body, {
              type: "match_leave",
              matchId,
            })
          );
      }
    }

    await Promise.all(ops);

    return null;
  }
);

// ======================================================
// Scheduled reminders (H-24 & H-1)
// ======================================================
export const remind24hBefore = onSchedule(
  { schedule: "every 5 minutes", region: "europe-west1" },
  async () => {
    logger.info("remind24hBefore:tick");
    await remindForDelta(24);
  }
);

export const remindOneHourBefore = onSchedule(
  { schedule: "every 5 minutes", region: "europe-west1" },
  async () => {
    logger.info("remindOneHourBefore:tick");
    await remindForDelta(1);
  }
);

async function remindForDelta(hours) {
  const now = Date.now();
  const deltaMs = hours * 3600 * 1000;
  const win = 5 * 60 * 1000;

  const min = now + deltaMs - win;
  const max = now + deltaMs + win;

  logger.info("remindForDelta:range", { hours, min, max });

  const snap = await db
    .collection("matches")
    .where("dateHeure", ">=", min)
    .where("dateHeure", "<=", max)
    .get();

  logger.info("remindForDelta:found", { hours, count: snap.size });

  for (const doc of snap.docs) {
    const m = doc.data();
    const matchId = doc.id;
    const lieu = m.lieu || m.placeName || "Match";

    const players = cleanUids(m.participants || []);
    if (!players.length) {
      logger.info("remindForDelta:no-participants", { matchId });
      continue;
    }

    const tokensByUid = await getTokens(players);

    const title = hours === 24 ? "Match demain" : "Match bientôt";
    const body =
      hours === 24
        ? `Ton match « ${lieu} » est dans 24h.`
        : `Ton match « ${lieu} » commence dans 1h.`;

    for (const [uid, tokens] of tokensByUid.entries()) {
      if (!tokens.length) {
        logger.info("remindForDelta:no-tokens", { matchId, uid });
        continue;
      }
      await send(uid, tokens, title, body, {
        type: "reminder",
        matchId,
      });
    }
  }
}

// ======================================================
// LEGACY fallbacks
// ======================================================
export const sendChatNotification = onCall(
  { region: "europe-west1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated");

    const receiverUid = req.data?.receiverUid;
    const matchId = req.data?.matchId;
    const text = String(req.data?.text || "");

    const [senderName, tokensByUid] = await Promise.all([
      pseudoOf(uid),
      getTokens([receiverUid]),
    ]);

    const tokens = tokensByUid.get(receiverUid) || [];
    if (!tokens.length) return { ok: true };

    const title = `${senderName} t’a envoyé un message`;
    const body = text.length <= 120 ? text : text.slice(0, 117) + "…";

    await send(receiverUid, tokens, title, body, {
      type: "chat",
      matchId,
      senderUid: uid,
      trigger: "legacy",
    });

    return { ok: true };
  }
);

export const notifyOneHourBeforeMatch = onCall(
  { region: "europe-west1" },
  () => {
    throw new HttpsError("failed-precondition", "DEPRECATED");
  }
);
export const notify24HoursBeforeMatch = onCall(
  { region: "europe-west1" },
  () => {
    throw new HttpsError("failed-precondition", "DEPRECATED");
  }
);
export const deleteAccount = onCall({ region: "europe-west1" }, () => {
  throw new HttpsError("failed-precondition", "DEPRECATED");
});
export const deleteUserAccount = onCall(
  { region: "europe-west1" },
  () => {
    throw new HttpsError("failed-precondition", "DEPRECATED");
  }
);
