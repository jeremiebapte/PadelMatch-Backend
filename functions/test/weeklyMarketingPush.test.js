import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyMarketingPush } from "../weeklyMarketingPush.js";
import { MPG_LIBRARY } from "../weeklyMarketingCopy.js";

function fakeStore({enabled = false, dryRun = true, audience = "all", users = [{id:"user1"}],
  approved = [], deliveries = []} = {}) {
  const state = {claims:new Map(), sends:[], events:[], users};
  const messages = approved.map(m=>({id:m.id,data:()=>m}));
  const savedDeliveries = deliveries.map(d=>({get:key=>d[key]}));
  const db={
    doc(path) {
      if(path==="marketingPush/config") return {get:async()=>({data:()=>({enabled,dryRun,audience})})};
      return {
        path, get:async()=>({exists:state.claims.has(path)}),
        update:async patch=>{state.claims.set(path,{...state.claims.get(path),...patch});},
      };
    },
    collection(path){
      if(path==="marketingPush/messages") return {where:()=>({get:async()=>({docs:messages})})};
      if(path==="marketingPush/deliveries") return {orderBy:()=>({limit:()=>({
        get:async()=>({docs:savedDeliveries}),
      })})};
      if(path==="users") return {orderBy:()=>({limit:()=>({
        get:async()=>({empty:!users.length, docs:users,size:users.length}),
      })})};
      throw new Error("unexpected collection "+path);
    },
    runTransaction:async fn=>fn({
      get:async ref=>({exists:state.claims.has(ref.path)}),
      create:(ref,data)=>{state.claims.set(ref.path,data);},
    }),
  };
  const messaging={sendEachForMulticast:async payload=>{
    state.sends.push(payload);
    return {successCount:payload.tokens.length,failureCount:0};
  }};
  const sender=buildWeeklyMarketingPush({db,messaging,logger:{
    info:()=>{},warn:()=>{},error:()=>{},
  },tokensOf:async()=>["token1"],isPushAllowed:async()=>true});
  return {state,sender};
}

test("curated library respects title/body limits and unique IDs",()=>{
  const ids=new Set();
  for(const m of MPG_LIBRARY){
    assert.ok(m.title.length>0 && m.title.length<=45, m.id+" title");
    assert.ok(m.body.length>0 && m.body.length<=110, m.id+" body");
    assert.ok(!ids.has(m.id));ids.add(m.id);
  }
});

test("disabled by default: no pushes",async()=>{
  const {sender,state}=fakeStore();
  assert.deepEqual(await sender(),{status:"disabled"});
  assert.equal(state.sends.length,0);
});

test("unsupported audience: fail closed",async()=>{
  const {sender,state}=fakeStore({enabled:true,audience:"test"});
  assert.deepEqual(await sender(),{status:"unsupported_audience"});
  assert.equal(state.sends.length,0);
});

test("dry-run: selects copy, sends nothing",async()=>{
  const {sender,state}=fakeStore({enabled:true});
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.status,"dry_run");
  assert.equal(result.messageId,MPG_LIBRARY[0].id);
  assert.equal(state.sends.length,0);
});

test("approved special message overrides library; idea is ignored",async()=>{
  const {sender}=fakeStore({enabled:true,approved:[
    {id:"draft",status:"idea",active:true,title:"Draft",body:"Never send"},
    {id:"special",status:"approved",active:true,title:"Actualité",body:"Joue aujourd'hui",order:1},
  ]});
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.messageId,"special");
});

test("live mode sends only once for a week and audits successes",async()=>{
  const {sender,state}=fakeStore({enabled:true,dryRun:false});
  const date=new Date("2026-11-24T17:30:00Z");
  const first=await sender({now:date});
  assert.equal(first.status,"completed");
  assert.equal(first.successCount,1);
  assert.equal(state.sends.length,1);
  const second=await sender({now:date});
  assert.equal(second.status,"already_claimed");
  assert.equal(state.sends.length,1);
});

test("excluded recipient receives nothing",async()=>{
  const {sender,state}=fakeStore({enabled:true,dryRun:false,users:[]});
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.eligibleTokens,0);
  assert.equal(state.sends.length,0);
});
