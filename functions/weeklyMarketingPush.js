// Weekly MPG-style PADIMA marketing push.
// Firestore:
// marketingPush/config { enabled:false, dryRun:true, audience:"all" }
// marketingPush/messages/{id} {title,body,status:"approved",order:0,active:true}
// marketingPush/deliveries/{YYYY-Www} { status, messageId, counts, ... }
// Ideas can be submitted as status:"idea"; they are NEVER sent until approved.
// Disabled by default. A production send requires enabled=true AND dryRun=false.
import { MPG_LIBRARY } from "./weeklyMarketingCopy.js";

const MAX_TITLE = 45;
const MAX_BODY = 110;
const WEEK_MS = 7 * 86400000;

function parisWeek(date) {
  // ISO week based on Europe/Paris calendar date.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = type => parts.find(p => p.type === type)?.value;
  const d = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1,
    Number(part("day")), 12));
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const firstThursday = new Date(jan4.getTime() + (3 - jan4Weekday) * 86400000);
  const week = 1 + Math.round((d - firstThursday) / WEEK_MS);
  return year + "-W" + String(week).padStart(2, "0");
}

export function buildWeeklyMarketingPush({db, messaging, logger, tokensOf, isPushAllowed}) {
  return async function weeklyMarketingPush({now = new Date()} = {}) {
    const configSnap = await db.doc("marketingPush/config").get();
    const config = configSnap.data() || {};
    if (config.enabled !== true) return {status:"disabled"};
    if (config.audience !== "all") return {status:"unsupported_audience"};
    const dryRun = config.dryRun !== false;
    const week = parisWeek(now);
    const deliveryRef = db.doc("marketingPush/deliveries/" + week);
    const approved = await db.collection("marketingPush/messages")
      .where("status", "==", "approved").get();
    const messages = approved.docs.filter(d => {
      const m = d.data();
      return m.active === true && typeof m.title === "string" &&
        m.title.trim().length > 0 && m.title.length <= MAX_TITLE &&
        typeof m.body === "string" && m.body.trim().length > 0 &&
        m.body.length <= MAX_BODY;
    }).sort((a,b) => (a.data().order || 0) - (b.data().order || 0) ||
      a.id.localeCompare(b.id));
    // The curated library is the default; optional approved Firestore campaigns override rotation.
    const library = MPG_LIBRARY.map((m, i) => ({id:m.id, data:()=>({...m,order:i})}));
    const candidates = messages.length ? messages : library;
    const last = await db.collection("marketingPush/deliveries")
      .orderBy("createdAt", "desc").limit(10).get();
    const used = new Set(last.docs.map(d => d.get("messageId")));
    const selected = candidates.find(d => !used.has(d.id)) || candidates[
      (Number(week.split("W")[1]) - 1) % candidates.length
    ];
    const message = selected.data();
    if (dryRun) {
      logger.info("weekly marketing dry run", {week, messageId:selected.id});
      return {status:"dry_run",week,messageId:selected.id};
    }
    // A transaction ensures that retries do not double-send.
    const claimed = await db.runTransaction(async tx => {
      const prior = await tx.get(deliveryRef);
      if (prior.exists) return false;
      tx.create(deliveryRef, {
        status:"sending", messageId:selected.id, title:message.title,
        body:message.body, createdAt:now, checkedUsers:0,
        eligibleTokens:0, successCount:0, failureCount:0,
      });
      return true;
    });
    if (!claimed) return {status:"already_claimed",week};
    let checkedUsers=0, successCount=0, failureCount=0;
    const tokens = new Set();
    try {
      let lastUser=null;
      while (true) {
        let q=db.collection("users").orderBy("__name__").limit(100);
        if(lastUser) q=q.startAfter(lastUser);
        const snap=await q.get();
        if(snap.empty) break;
        for(const userDoc of snap.docs) {
          checkedUsers++;
          try {
            if(!await isPushAllowed({uid:userDoc.id,category:"news",event:"marketing"})) continue;
            for(const token of await tokensOf(userDoc.id)) tokens.add(token);
          } catch(err) {
            logger.warn("weekly marketing recipient skipped", {code:err?.code || "unknown"});
          }
        }
        lastUser=snap.docs[snap.docs.length-1];
        if(snap.size<100) break;
      }
      const allTokens=[...tokens];
      for(let i=0;i<allTokens.length;i+=500) {
        const result=await messaging.sendEachForMulticast({
          tokens:allTokens.slice(i,i+500),
          notification:{title:message.title,body:message.body},
          data:{type:"admin",subtype:"marketing",campaign:week},
        });
        successCount+=result.successCount;
        failureCount+=result.failureCount;
      }
      await deliveryRef.update({status:"completed",checkedUsers,
        eligibleTokens:allTokens.length,successCount,failureCount,
        completedAt:new Date()});
      return {status:"completed",week,checkedUsers,eligibleTokens:allTokens.length,
        successCount,failureCount};
    } catch(err) {
      await deliveryRef.update({status:"failed",checkedUsers,
        eligibleTokens:tokens.size,successCount,failureCount,
        errorCode:err?.code || "unknown",completedAt:new Date()});
      logger.error("weekly marketing failed; manual review required", {
        week,code:err?.code || "unknown",
      });
      throw err; // Never auto-retry a partially sent campaign.
    }
  };
}
