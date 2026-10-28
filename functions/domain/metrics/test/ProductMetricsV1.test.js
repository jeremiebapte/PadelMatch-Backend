import test from "node:test";
import assert from "node:assert/strict";
import { participantIds, isMatchFull, firstBecameFull, newParticipantIds, isActivatedWithin7Days, aggregateMatchChanges } from "../ProductMetricsV1.js";
test("deduplicates real players and excludes placeholders", () => {
 assert.deepEqual(participantIds({participants:["u1","u1","ami_de_1","invite:123",{uid:"u2"}]}),["u1","u2"]);
});
test("full means four unique real players by default", () => {
 assert.equal(isMatchFull({participants:["a","b","c","ami_de_4"]}),false);
 assert.equal(isMatchFull({participants:["a","b","c","d"]}),true);
});
test("first full transition only", () => {
 const three={participants:["a","b","c"]}, four={participants:["a","b","c","d"]};
 assert.equal(firstBecameFull(three,four),true);
 assert.equal(firstBecameFull(four,four),false);
});
test("new join only, not duplicate membership", () => {
 assert.deepEqual(newParticipantIds({participants:["a"]},{participants:["a","b","b"]}),["b"]);
});
test("activation must happen in the first seven days", () => {
 const t=Date.UTC(2026,9,1);
 assert.equal(isActivatedWithin7Days({userCreatedAt:t,firstMatchActionAt:t+6*86400000}),true);
 assert.equal(isActivatedWithin7Days({userCreatedAt:t,firstMatchActionAt:t+7*86400000}),false);
 assert.equal(isActivatedWithin7Days({userCreatedAt:t,firstMatchActionAt:t-1}),false);
});
test("aggregates repeated changes idempotently within a batch", () => {
 const a={participants:["a","b","c"]},b={participants:["a","b","c","d"]};
 const row={matchId:"m1",before:a,after:b};
 assert.deepEqual(aggregateMatchChanges([row,row]),{matchesCreated:0,participantJoins:1,matchesFirstFull:1});
});
