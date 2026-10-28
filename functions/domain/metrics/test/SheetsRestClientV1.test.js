import test from "node:test";
import assert from "node:assert/strict";
import {createSheetsClient} from "../SheetsRestClientV1.js";
test("requires short-lived access token",()=>assert.throws(()=>createSheetsClient({accessToken:""}),/REQUIRED/));
test("REST adapter reads and writes with bearer token",async()=>{
 const calls=[];
 const sheets=createSheetsClient({accessToken:"fake-test-token",fetchImpl:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({values:[["2026-10-26"]]})};}});
 await sheets.spreadsheets.values.get({spreadsheetId:"id",range:"'Historique hebdo'!A2:A500"});
 await sheets.spreadsheets.values.batchUpdate({spreadsheetId:"id",requestBody:{valueInputOption:"RAW",data:[]}});
 assert.equal(calls.length,2);
 assert.ok(calls[0].url.includes("sheets.googleapis.com"));
 assert.equal(calls[0].init.headers.Authorization,"Bearer fake-test-token");
 assert.equal(calls[1].init.method,"POST");
});
