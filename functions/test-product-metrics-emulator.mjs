// Run only through firebase emulators:exec. Never connects to production.
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { buildMatchMetricsRecorder } from "./domain/metrics/MatchMetricsRecorderV1.js";
import { planSync, applySyncPlan } from "./domain/metrics/GoogleSheetsMetricsSyncV1.js";
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
  assert.equal(data.joined,4,"four distinct joiners, excluding creator");
  assert.equal(data.full,1,"filled once after replacement");
  const ledgers=await db.collection("productMetricEventsV1").get();
  assert.equal(ledgers.size,6,"one creation, four joins, one full");
  // Out-of-order delivery must not create duplicate records.
  await rec.onMatchUpdated("m1",three,four,at);
  assert.deepEqual((await metrics.get()).data().joined,4);
  console.log("PASS: Firestore transactions, concurrent retries, replacements, out-of-order duplicates");

  // Exercise the actual Firestore range query against the recorder's output.
  const plan = await planSync({db,weekStart:"2026-10-26"});
  assert.equal(plan.status,"partial");
  assert.deepEqual(plan.totals,{created:1,joined:4,full:1});
  assert.deepEqual(plan.weeklyRow.slice(0,7),["2026-10-26","","",1,4,1,""]);
  // A new empty week does not mean the recorder has never produced counters.
  const emptyWeek = await planSync({db,weekStart:"2026-11-02"});
  assert.equal(emptyWeek.status,"no_data");
  assert.deepEqual(emptyWeek.writes,[]);

  // Sheets is an in-memory fake: this test never accesses the real dashboard.
  const sent = [];
  const sheets = {spreadsheets:{values:{
    get:async()=>({data:{values:[["2026-10-26"]]}}),
    batchUpdate:async request=>{sent.push(request);return {data:{}};}
  }}};
  await applySyncPlan({sheets,spreadsheetId:"test-only",plan});
  await applySyncPlan({sheets,spreadsheetId:"test-only",plan});
  assert.equal(sent.length,2);
  assert.deepEqual(sent[0],sent[1],"retries must target the same weekly row");
  assert.equal(sent[0].requestBody.data[0].range,"'Historique hebdo'!A2:I2");
  assert.deepEqual(sent[0].requestBody.data.slice(1).map(cell=>cell.values[0][0]),[1,4,1]);
  const skipped = await applySyncPlan({sheets,spreadsheetId:"test-only",plan:emptyWeek});
  assert.equal(skipped.status,"skipped");
  assert.equal(sent.length,2,"empty week must not overwrite the dashboard with zeros");
  console.log("PASS: recorder -> Firestore weekly query -> Sheets plan/upsert (fake Sheets), empty-week protection");
} finally {
  await deleteApp(app);
}
