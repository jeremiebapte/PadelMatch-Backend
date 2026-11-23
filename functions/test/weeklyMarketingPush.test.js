import test from "node:test";
import assert from "node:assert/strict";
import { MPG_CAMPAIGNS, parisWeekKey, campaignForWeek, buildWeeklyMarketingPushCron } from "../weeklyMarketingPush.js";

test("Paris week starts Monday, including DST transition", () => {
  assert.equal(parisWeekKey(new Date("2026-11-24T17:30:00Z")), "2026-11-23");
  assert.equal(parisWeekKey(new Date("2026-03-29T22:30:00Z")), "2026-03-30");
});
test("campaign selection deterministic and rotates", () => {
  assert.equal(campaignForWeek("2026-11-23"), campaignForWeek("2026-11-23"));
  assert.notEqual(campaignForWeek("2026-11-23").key, campaignForWeek("2026-11-30").key);
  assert.equal(MPG_CAMPAIGNS.length, 5);
  assert.ok(MPG_CAMPAIGNS.every(c => c.title.length <= 45 && c.body.length <= 110));
});
test("disabled configuration sends nothing", async () => {
  let sent = 0;
  const run = buildWeeklyMarketingPushCron({
    db: { doc: () => ({ get: async () => ({ get: () => false }) }) },
    messaging: { sendEachForMulticast: async () => { sent++; } },
    tokensOf: async () => ["token"],
    isPushAllowed: async () => true,
    logger: { info() {} },
  });
  assert.deepEqual(await run(), { skipped: "disabled" });
  assert.equal(sent, 0);
});
test("atomic duplicate claim prevents sending", async () => {
  let sent = 0;
  const run = buildWeeklyMarketingPushCron({
    db: {
      doc: () => ({ get: async () => ({ get: () => true }) }),
      collection: () => ({ doc: () => ({ create: async () => { const e = new Error("duplicate"); e.code = 6; throw e; } }) }),
    },
    messaging: { sendEachForMulticast: async () => { sent++; } },
    tokensOf: async () => ["token"],
    isPushAllowed: async () => true,
    logger: { info() {} },
  });
  assert.deepEqual(await run(), { skipped: "already_claimed" });
  assert.equal(sent, 0);
});
