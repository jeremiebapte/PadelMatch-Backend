import test from "node:test";
import assert from "node:assert/strict";
import {summarizeWeek,weeklySheetRow,overviewCells,planSync} from "../GoogleSheetsMetricsSyncV1.js";
test("UTC week boundaries and totals",()=>{
 const totals=summarizeWeek([{day:"2026-10-26",created:2,joined:3,full:1},{day:"2026-11-01",created:1},{day:"2026-11-02",created:50}],"2026-10-26");
 assert.deepEqual(totals,{created:3,joined:3,full:1});
 const row=weeklySheetRow("2026-10-26",totals);
 assert.equal(row[1],"");assert.equal(row[2],"");assert.equal(row[6],"");
 assert.deepEqual(overviewCells(totals).map(x=>x.values[0][0]),[3,3,1]);
});
test("reject invalid or negative counters",()=>{
 assert.throws(()=>summarizeWeek([{day:"2026-10-26",created:-1}],"2026-10-26"),/INVALID_METRIC_VALUE/);
 assert.throws(()=>summarizeWeek([],"2026-10-27"),/INVALID_WEEK_START/);
});
test("no Firestore records means no sheet writes",async()=>{
 const db={collection:()=>({where:()=>({where:()=>({get:async()=>({docs:[]})})})})};
 const result=await planSync({db,weekStart:"2026-10-26"});
 assert.equal(result.status,"no_data");assert.deepEqual(result.writes,[]);
});
