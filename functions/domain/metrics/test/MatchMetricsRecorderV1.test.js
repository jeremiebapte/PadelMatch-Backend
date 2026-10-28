import test from "node:test";
import assert from "node:assert/strict";
import { buildMatchMetricsRecorder } from "../MatchMetricsRecorderV1.js";
function fakeDb() {
 const docs = new Map();
 const FieldValue = { increment: n => ({ increment:n }), serverTimestamp:()=> "SERVER_TIME" };
 const db = {
  collection: name => ({ doc: id => ({ key: name+"/"+id }) }),
  runTransaction: async fn => {
   const writes=[];
   const tx={
    get: async ref => ({ exists: docs.has(ref.key) }),
    create: (ref,val)=>writes.push(["create",ref,val]),
    set: (ref,val)=>writes.push(["set",ref,val])
   };
   const result=await fn(tx);
   for(const [op,ref,val] of writes) {
    if(op==="create") { if(docs.has(ref.key)) throw Error("ALREADY_EXISTS"); docs.set(ref.key,val); }
    else { const old=docs.get(ref.key)||{}; const merged={...old}; for(const [k,v] of Object.entries(val)) merged[k]=v&&typeof v==="object"&&"increment" in v?(old[k]||0)+v.increment:v; docs.set(ref.key,merged); }
   }
   return result;
  }
 };
 return { db, FieldValue, docs };
}
test("created match counted once across retries", async()=>{
 const f=fakeDb(), rec=buildMatchMetricsRecorder({...f,now:()=>new Date("2026-10-28T12:00:00Z")});
 await rec.onMatchCreated("m1",{participants:["a","b"]}); await rec.onMatchCreated("m1",{participants:["a","b"]});
 assert.deepEqual({created:f.docs.get("productMetricsDailyV1/2026-10-28").created,joined:f.docs.get("productMetricsDailyV1/2026-10-28").joined},{created:1,joined:2});
});
test("replacement counts one new join, never two full matches",async()=>{
 const f=fakeDb(),rec=buildMatchMetricsRecorder({...f,now:()=>new Date("2026-10-28T12:00:00Z")});
 const three={participants:["a","b","c"]},four={participants:["a","b","c","d"]},replacement={participants:["a","b","c","e"]};
 await rec.onMatchCreated("m1",three);
 await rec.onMatchUpdated("m1",three,four);
 await rec.onMatchUpdated("m1",four,three);
 await rec.onMatchUpdated("m1",three,replacement);
 await rec.onMatchUpdated("m1",three,replacement);
 const d=f.docs.get("productMetricsDailyV1/2026-10-28");
 assert.equal(d.created,1);assert.equal(d.joined,5);assert.equal(d.full,1);
});
test("fake participants excluded and malformed IDs rejected",async()=>{
 const f=fakeDb(),rec=buildMatchMetricsRecorder({...f});
 await rec.onMatchCreated("m1",{participants:["a","ami_de_123","invite:foo"]});
 assert.equal([...f.docs.keys()].filter(k=>k.startsWith("productMetricEventsV1/joined")).length,1);
 await assert.rejects(()=>rec.once({kind:"created",matchId:"bad/id"}),/INVALID_METRIC_ID/);
});

test("creator does not count as a match join",async()=>{
 const f=fakeDb(),rec=buildMatchMetricsRecorder({...f,now:()=>new Date("2026-10-28T12:00:00Z")});
 await rec.onMatchCreated("m2",{createurUid:"a",participants:["a","b"]});
 assert.equal(f.docs.get("productMetricsDailyV1/2026-10-28").joined,1);
});
test("late retry keeps original event day",async()=>{
 const f=fakeDb(),rec=buildMatchMetricsRecorder({...f});
 await rec.once({kind:"created",matchId:"m3",occurredAt:"2026-10-20T12:00:00Z"});
 await rec.once({kind:"created",matchId:"m3",occurredAt:"2026-10-28T12:00:00Z"});
 assert.equal(f.docs.get("productMetricsDailyV1/2026-10-20").created,1);
 assert.equal(f.docs.has("productMetricsDailyV1/2026-10-28"),false);
});
test("event keys cannot collide across underscore-delimited IDs",async()=>{
 const f=fakeDb(),rec=buildMatchMetricsRecorder({...f});
 const at="2026-10-28T12:00:00Z";
 await rec.once({kind:"joined",matchId:"a_b",uid:"c",occurredAt:at});
 await rec.once({kind:"joined",matchId:"a",uid:"b_c",occurredAt:at});
 assert.equal(f.docs.get("productMetricsDailyV1/2026-10-28").joined,2);
});
