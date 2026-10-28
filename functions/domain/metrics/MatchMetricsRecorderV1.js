// PADIMA V1 — server-authoritative, idempotent match metric recording.
// One transaction per unique metric key: a retry cannot increment twice.
// Aggregates use UTC calendar days. Do not call from clients.
import { participantIds, isMatchFull, newParticipantIds } from "./ProductMetricsV1.js";
const dayOf = (date) => new Date(date).toISOString().slice(0, 10);
const validId = x => typeof x === "string" && x.length > 0 && !x.includes("/");
export function buildMatchMetricsRecorder({ db, FieldValue, now = () => new Date() }) {
  async function once({ kind, matchId, uid = null, occurredAt = now() }) {
    if (!validId(matchId) || (uid !== null && !validId(uid))) throw new Error("INVALID_METRIC_ID");
    const key = kind === "joined" ? `joined_${matchId}_${uid}` : `${kind}_${matchId}`;
    const ledger = db.collection("productMetricEventsV1").doc(key);
    const date = dayOf(occurredAt);
    const daily = db.collection("productMetricsDailyV1").doc(date);
    return db.runTransaction(async tx => {
      const previous = await tx.get(ledger);
      if (previous.exists) return false;
      tx.create(ledger, { kind, matchId, ...(uid ? { uid } : {}), day: date, recordedAt: FieldValue.serverTimestamp() });
      tx.set(daily, { [kind]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
  }
  async function onMatchCreated(matchId, after, occurredAt) {
    if (!after) return;
    await once({ kind: "created", matchId, occurredAt });
    for (const uid of participantIds(after)) await once({ kind: "joined", matchId, uid, occurredAt });
    if (isMatchFull(after)) await once({ kind: "full", matchId, occurredAt });
  }
  async function onMatchUpdated(matchId, before, after, occurredAt) {
    if (!before || !after) return;
    for (const uid of newParticipantIds(before, after)) await once({ kind: "joined", matchId, uid, occurredAt });
    if (isMatchFull(after)) await once({ kind: "full", matchId, occurredAt });
  }
  return { once, onMatchCreated, onMatchUpdated };
}
