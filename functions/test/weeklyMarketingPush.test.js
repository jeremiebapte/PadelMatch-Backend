import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyMarketingPush } from "../weeklyMarketingPush.js";
import { MPG_LIBRARY } from "../weeklyMarketingCopy.js";

function fakeStore({enabled = false, dryRun = true, audience = "all", users = [{id:"user1"}],
  approved = [], deliveries = [], testUid = "", isPushAllowed = async()=>true} = {}) {
  const state = {claims:new Map(), sends:[], events:[], users};
  const messages = approved.map(m=>({id:m.id,data:()=>m}));
  const savedDeliveries = deliveries.map(d=>({id:d.id,get:key=>d[key]}));
  const db={
    doc(path) {
      assert.equal(path.split("/").length % 2, 0, `Invalid Firestore document path: ${path}`);
      if(path==="marketingPush/config") return {get:async()=>({data:()=>({enabled,dryRun,audience,testUid})})};
      return {
        path, get:async()=>({exists:state.claims.has(path)}),
        update:async patch=>{state.claims.set(path,{...state.claims.get(path),...patch});},
      };
    },
    collection(path){
      assert.equal(path.split("/").length % 2, 1, `Invalid Firestore collection path: ${path}`);
      if(path==="marketingPush/config/messages") return {where:(field,op,value)=>({get:async()=>({docs:messages.filter(doc=>doc.data()[field] === value)})})};
      if(path==="marketingPush/config/deliveries") return {orderBy:()=>({limit:()=>({
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
  },tokensOf:async()=>["token1"],isPushAllowed});
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
  const {sender,state}=fakeStore({enabled:true,audience:"unsupported"});
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


test("test audience without UID fails closed",async()=>{
  const {sender,state}=fakeStore({enabled:true,dryRun:false,audience:"test"});
  assert.equal((await sender()).status,"missing_test_uid");
  assert.equal(state.sends.length,0);
});

test("test audience targets only the configured UID",async()=>{
  const {sender,state}=fakeStore({enabled:true,dryRun:false,audience:"test",testUid:"my-test-uid",
    users:[{id:"other-user"},{id:"another-user"}]});
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.status,"completed");
  assert.equal(result.checkedUsers,1);
  assert.equal(state.sends.length,1);
  assert.equal(state.claims.has("marketingPush/config/deliveries/test-2026-W48"),true);
});

// Regression: dry-run must traverse both Firestore subcollections with valid paths.
test("dry-run uses valid Firestore document and collection paths", async () => {
  const {sender,state} = fakeStore({enabled:true,dryRun:true,audience:"test",testUid:"tester"});
  assert.equal((await sender({now:new Date("2026-11-24T17:30:00Z")})).status,"dry_run");
  assert.equal(state.sends.length,0);
});


test("production rotation ignores test campaign history",async()=>{
  const {sender}=fakeStore({enabled:true,audience:"all",deliveries:[
    {id:"test-2026-W48",messageId:"create-match"},
  ]});
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.messageId,"create-match");
});

test("test rotation ignores production campaign history",async()=>{
  const {sender}=fakeStore({enabled:true,audience:"test",testUid:"tester",deliveries:[
    {id:"2026-W48",messageId:"create-match"},
  ]});
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.messageId,"create-match");
});

test("recipient errors are counted without stopping other sends",async()=>{
  const {sender,state}=fakeStore({enabled:true,dryRun:false,
    users:[{id:"broken"},{id:"valid"}],
    isPushAllowed:async({uid})=>{
      if(uid==="broken")throw new Error("preference read failed");
      return true;
    },
  });
  const result=await sender({now:new Date("2026-11-24T17:30:00Z")});
  assert.equal(result.status,"completed");
  assert.equal(result.checkedUsers,2);
  assert.equal(result.skippedUsers,1);
  assert.equal(result.successCount,1);
  assert.equal(state.sends.length,1);
  assert.equal(state.claims.get("marketingPush/config/deliveries/2026-W48").skippedUsers,1);
});
