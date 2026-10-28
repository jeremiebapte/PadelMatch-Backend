// PADIMA V1 — read-only daily Firestore counters -> Sheets values.
// No credential access or network side effects at module import.
export const DASHBOARD_SPREADSHEET_ID = "1wFpGfWDU8D86J3XcwigQw6oUcz0S_liG3KiZhioiCPs";
const keys = ["created","joined","full"];
export function summarizeWeek(dailyDocs, weekStart) {
 const start = Date.parse(weekStart+"T00:00:00Z");
 if (!Number.isFinite(start) || new Date(start).toISOString().slice(0,10)!==weekStart || new Date(start).getUTCDay()!==1) throw Error("INVALID_WEEK_START");
 const end=start+7*86400000;
 const totals={created:0,joined:0,full:0};
 for(const doc of dailyDocs) {
  const day=doc.day;
  const date=Date.parse(day+"T00:00:00Z");
  if (!Number.isFinite(date) || date<start || date>=end) continue;
  for(const k of keys) {
   const n=doc[k]??0;
   if(!Number.isSafeInteger(n)||n<0) throw Error("INVALID_METRIC_VALUE");
   totals[k]+=n;
  }
 }
 return totals;
}
export function weeklySheetRow(weekStart, totals) {
 // B/C/G intentionally blank: signups, unique actives and activation not yet measured.
 return [weekStart,"","",totals.created,totals.joined,totals.full,"","Partiel — backend uniquement","Firestore productMetricsDailyV1 (UTC)"];
}
export function overviewCells(totals) {
 return [
  {range:"'Vue d''ensemble'!B5",values:[[totals.created]]},
  {range:"'Vue d''ensemble'!B6",values:[[totals.joined]]},
  {range:"'Vue d''ensemble'!B7",values:[[totals.full]]}
 ];
}
export async function readWeekFromFirestore(db, weekStart) {
 const end=new Date(Date.parse(weekStart+"T00:00:00Z")+6*86400000).toISOString().slice(0,10);
 const snap=await db.collection("productMetricsDailyV1").where("__name__",">=",weekStart).where("__name__","<=",end).get();
 return snap.docs.map(d=>({day:d.id,...d.data()}));
}
export async function planSync({db,weekStart}) {
 const docs=await readWeekFromFirestore(db,weekStart);
 // An empty collection is NOT proof of zero activity or a deployed recorder.
 if(docs.length===0) return {status:"no_data",weekStart,writes:[]};
 const totals=summarizeWeek(docs,weekStart);
 return {status:"partial",weekStart,totals,writes:overviewCells(totals),weeklyRow:weeklySheetRow(weekStart,totals)};
}

export async function applySyncPlan({sheets,spreadsheetId=DASHBOARD_SPREADSHEET_ID,plan}) {
 if(plan.status!=="partial") return {status:"skipped",reason:plan.status};
 // Upsert by week key. A retry replaces the same row, never appends a duplicate.
 const current=await sheets.spreadsheets.values.get({spreadsheetId,range:"'Historique hebdo'!A2:A500"});
 const values=current.data.values||[];
 const found=values.findIndex(row=>row[0]===plan.weekStart);
 const rowNumber=found>=0?found+2:values.length+2;
 const data=[
  {range:`'Historique hebdo'!A${rowNumber}:I${rowNumber}`,values:[plan.weeklyRow]},
  ...plan.writes
 ];
 await sheets.spreadsheets.values.batchUpdate({spreadsheetId,requestBody:{valueInputOption:"RAW",data}});
 return {status:"written",rowNumber,weekStart:plan.weekStart};
}
