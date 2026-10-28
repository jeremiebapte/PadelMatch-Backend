// PADIMA V1: transactional, retry-safe match counters.
// Event timestamps are used for daily bucketing, not processing time.
import { participantIds, isMatchFull, newParticipantIds } from "./ProductMetricsV1.js";
const validId = x => typeof x === "string" && x.length > 0 && x.length <= 256 && !x.includes("/");
const eventKey = (kind, matchId, uid) => [kind, matchId, ...(uid ? [uid] : [])].map(v => encodeURIComponent(v).replace(/_/g,"%5F")).join("_");
const timestampDate = value => {
  if (value?.toDate) return value.toDate();
  if (value?.seconds !== undefined) return new Date(value.seconds * 1000);
  return new Date(value);
};
const creatorUid = match => match?.createurUid || match?.creatorUid || match?.createdByUid || null;
export function buildMatchMetricsRecorder({ db, FieldValue }) {
  async function once({ kind, matchId, uid = null, occurredAt }) {
    if (!["created","joined","full"].includes(kind) || !validId(matchId) || (kind === "joined" && !validId(uid))) throw new Error("INVALID_METRIC_ID");
    const date = timestampDate(occurredAt);
    if (!Number.isFinite(date.getTime())) throw new Error("INVALID_METRIC_TIMESTAMP");
    const day = date.toISOString().slice(0,10);
    const ledger = db.collection("productMetricEventsV1").doc(eventKey(kind,matchId,uid));
    const daily = db.collection("productMetricsDailyV1").doc(day);
    return db.runTransaction(async tx => {
      const previous = await tx.get(ledger);
      if (previous.exists) return false;
      tx.create(ledger, { kind, matchId, ...(uid ? { uid } : {}), day, recordedAt: FieldValue.serverTimestamp() });
      tx.set(daily, { [kind]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge:true });
      return true;
    });
  }
  async function onMatchCreated(matchId, after, occurredAt) {
    if (!after) return;
    await once({kind:"created",matchId,occurredAt});
    // Creator is not a join. Other initial participants are counted once.
    for (const uid of participantIds(after).filter(id=>id!==creatorUid(after)))
      await once({kind:"joined",matchId,uid,occurredAt});
    if (isMatchFull(after)) await once({kind:"full",matchId,occurredAt});
  }
  async function onMatchUpdated(matchId,before,after,occurredAt) {
    if (!before || !after) return;
    for (const uid of newParticipantIds(before,after).filter(id=>id!==creatorUid(after)))
      await once({kind:"joined",matchId,uid,occurredAt});
    if (isMatchFull(after)) await once({kind:"full",matchId,occurredAt});
  }
  return {once,onMatchCreated,onMatchUpdated};
}
