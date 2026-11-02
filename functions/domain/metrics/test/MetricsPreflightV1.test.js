import test from "node:test";
import assert from "node:assert/strict";
import { runMetricsPreflight } from "../MetricsPreflightV1.js";
import { planSync } from "../GoogleSheetsMetricsSyncV1.js";

function options(overrides = {}) {
  return { projectId: "demo-padima-metrics-v1", weekStart: "2026-10-26",
    getToken: async () => "secret-token",
    probeSheets: async () => ({ ok: true, title: "private-title" }),
    readPlan: async () => ({ status: "no_data", writes: [] }), ...overrides };
}

test("Firestore gRPC 7 preserves successful Sheets check and redacts raw error", async () => {
  const result = await runMetricsPreflight(options({ readPlan: async () => {
    throw Object.assign(new Error("secret-token private-doc"), { code: 7 });
  } }));
  assert.equal(result.ok, false);
  assert.equal(result.checks.sheets.status, "passed");
  assert.deepEqual(result.checks.firestore, { status: "failed", code: "PERMISSION_DENIED" });
  assert.equal(result.writes, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|private-doc|private-title/);
});

test("Sheets denial does not skip the real Firestore read-only plan", async () => {
  const calls = [];
  const query = { where: (...args) => { calls.push(args); return query; },
    get: async () => ({ docs: [] }) };
  const db = { collection: name => { assert.equal(name, "productMetricsDailyV1"); return query; } };
  const result = await runMetricsPreflight(options({
    probeSheets: async () => ({ ok: false, status: 403 }),
    readPlan: ({ weekStart }) => planSync({ db, weekStart })
  }));
  assert.equal(result.ok, false);
  assert.equal(result.checks.sheets.httpStatus, 403);
  assert.equal(result.checks.firestore.status, "passed");
  assert.equal(result.metricsStatus, "no_data");
  assert.deepEqual(calls, [["__name__", ">=", "2026-10-26"], ["__name__", "<=", "2026-11-01"]]);
});

test("both service failures remain visible", async () => {
  const result = await runMetricsPreflight(options({
    probeSheets: async () => ({ ok: false, status: 403 }),
    readPlan: async () => { throw { code: "PERMISSION_DENIED" }; }
  }));
  assert.equal(result.checks.sheets.status, "failed");
  assert.equal(result.checks.firestore.code, "PERMISSION_DENIED");
});

test("metadata failure skips Sheets but still diagnoses ADC", async () => {
  const result = await runMetricsPreflight(options({
    getToken: async () => { throw Error("private-token"); },
    probeSheets: async () => assert.fail("must not call Sheets without token"),
    readPlan: async () => { throw { code: 16 }; }
  }));
  assert.equal(result.ok, false);
  assert.equal(result.checks.metadata.status, "failed");
  assert.equal(result.checks.sheets.status, "skipped");
  assert.equal(result.checks.firestore.code, "UNAUTHENTICATED");
  assert.doesNotMatch(JSON.stringify(result), /private-token/);
});

test("empty collection passes access checks without claiming zero activity", async () => {
  const result = await runMetricsPreflight(options());
  assert.equal(result.ok, true);
  assert.equal(result.metricsStatus, "no_data");
  assert.equal(result.countersPresent, false);
  assert.equal(result.writes, 0);
});

test("partial metrics do not expose or apply the write plan", async () => {
  const result = await runMetricsPreflight(options({ readPlan: async () => ({
    status: "partial", totals: { created: 123 }, writes: [{ private: "value" }]
  }) }));
  assert.equal(result.ok, true);
  assert.equal(result.countersPresent, true);
  assert.equal(result.writes, 0);
  assert.doesNotMatch(JSON.stringify(result), /123|private|value/);
});

test("invalid Monday/date is rejected before any network operation", async () => {
  for (const weekStart of ["2026-10-27", "bad", "2026-02-30"]) {
    const forbidden = async () => assert.fail("no network for invalid config");
    const result = await runMetricsPreflight(options({ weekStart, getToken: forbidden,
      probeSheets: forbidden, readPlan: forbidden }));
    assert.equal(result.ok, false);
    assert.equal(result.checks.configuration.code, "INVALID_WEEK_START");
  }
});

test("invalid counters and unknown errors are not misreported as IAM denials", async () => {
  for (const [error, code] of [[Error("INVALID_METRIC_VALUE"), "INVALID_METRIC_VALUE"],
    [Error("Authorization: Bearer secret"), "UNKNOWN"]]) {
    const result = await runMetricsPreflight(options({ readPlan: async () => { throw error; } }));
    assert.equal(result.checks.firestore.code, code);
    assert.doesNotMatch(JSON.stringify(result), /Bearer|secret/);
  }
});
