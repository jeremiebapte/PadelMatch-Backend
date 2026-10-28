// Run only through firebase emulators:exec. Never connects to production.
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { buildMatchMetricsRecorder } from "./domain/metrics/MatchMetricsRecorderV1.js";
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_CONFIG) {
  throw new Error("FIRESTORE_EMULATOR_REQUIRED");
}
const app = initializeApp({projectId:"demo-padima-metrics-v1"});
const db = getFirestore(app);
const at = "2026-10-28T12:00:00Z";
const rec = buildMatchMetricsRecorder({db,FieldValue});
const metrics = db.collection("productMetricsDailyV1").doc("2026-10-28");
const three = {createurUid:"a",participants:["a","b","c"]};
const four = {createurUid:"a",participants:["a","b","c","d"]};
const replacement = {createurUid:"a",participants:["a","b","c","e"]};
try {
  // Concurrent duplicate delivery: Firestore transaction must count once.
  await Promise.all(Array.from({length:5},()=>rec.onMatchCreated("m1",three,at)));
  await Promise.all(Array.from({length:5},()=>rec.onMatchUpdated("m1",three,four,at)));
  await rec.onMatchUpdated("m1",four,three,at);
  await rec.onMatchUpdated("m1",three,replacement,at);
  await rec.onMatchUpdated("m1",three,replacement,at);
  const data=(await metrics.get()).data();
  assert.equal(data.created,1,"creation once");
  assert.equal(data.joined,4,"three distinct joiners, excluding creator");
  assert.equal(data.full,1,"filled once after replacement");
  const ledgers=await db.collection("productMetricEventsV1").get();
  assert.equal(ledgers.size,6,"one creation, four joins, one full");
  // Out-of-order delivery must not create duplicate records.
  await rec.onMatchUpdated("m1",three,four,at);
  assert.deepEqual((await metrics.get()).data().joined,4);
  console.log("PASS: Firestore transactions, concurrent retries, replacements, out-of-order duplicates");
} finally {
  await deleteApp(app);
}
