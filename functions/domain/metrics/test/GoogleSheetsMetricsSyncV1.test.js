import test from "node:test";
import assert from "node:assert/strict";
import {summarizeWeek,weeklySheetRow,overviewCells,planSync,applySyncPlan} from "../GoogleSheetsMetricsSyncV1.js";
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

test("Sheets retry updates existing week rather than appending",async()=>{
 const sent=[];
 const sheets={spreadsheets:{values:{
  get:async()=>({data:{values:[["2026-10-26"]]}}),
  batchUpdate:async args=>{sent.push(args);return {data:{}};}
 }}};
 const plan={status:"partial",weekStart:"2026-10-26",weeklyRow:["2026-10-26","","",2,3,1,"","Partiel","Firestore"],writes:overviewCells({created:2,joined:3,full:1})};
 const result=await applySyncPlan({sheets,plan});
 assert.equal(result.rowNumber,2);
 assert.equal(sent[0].requestBody.data[0].range,"'Historique hebdo'!A2:I2");
 assert.equal(sent[0].requestBody.data[1].range,"'Vue d''ensemble'!B5");
});
