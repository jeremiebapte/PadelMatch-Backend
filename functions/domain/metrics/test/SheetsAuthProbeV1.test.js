import test from "node:test";
import assert from "node:assert/strict";
import {probeSheetsAccess,metadataAccessToken} from "../SheetsAuthProbeV1.js";
test("read-only probe sends GET, never token in output",async()=>{
 const calls=[];
 const result=await probeSheetsAccess({token:"dummy",fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({spreadsheetId:"1wFpGfWDU8D86J3XcwigQw6oUcz0S_liG3KiZhioiCPs",properties:{title:"PADIMA"}})};}});
 assert.deepEqual(result,{ok:true,title:"PADIMA"});
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.method,undefined);
 assert.equal(JSON.stringify(result).includes("dummy"),false);
});
test("403 reports denied without exposing token",async()=>{
 const result=await probeSheetsAccess({token:"secret",fetchImpl:async()=>({ok:false,status:403})});
 assert.deepEqual(result,{ok:false,status:403});
});
test("metadata fetch requires Google metadata flavor",async()=>{
 const token=await metadataAccessToken({fetchImpl:async(url,opts)=>{assert.equal(opts.headers["Metadata-Flavor"],"Google");return {ok:true,json:async()=>({access_token:"temporary"})};}});
 assert.equal(token,"temporary");
});
