// Read-only orchestration; never return tokens, document contents or raw errors.
import { summarizeWeek } from "./GoogleSheetsMetricsSyncV1.js";

function failure(error) {
  const code = error?.code;
  if (code === 7 || code === "7" || code === "PERMISSION_DENIED") {
    return { status: "failed", code: "PERMISSION_DENIED" };
  }
  if (code === 16 || code === "16" || code === "UNAUTHENTICATED") {
    return { status: "failed", code: "UNAUTHENTICATED" };
  }
  if (error?.message === "INVALID_METRIC_VALUE") {
    return { status: "failed", code: "INVALID_METRIC_VALUE" };
  }
  return { status: "failed", code: Number.isInteger(code) ? code : "UNKNOWN" };
}

export async function runMetricsPreflight({ projectId, weekStart, getToken, probeSheets, readPlan }) {
  const result = { mode: "read-only", projectId, databaseId: "(default)", weekStart,
    collection: "productMetricsDailyV1", writes: 0, ok: false, checks: {} };
  // Validate even when the collection is empty, before any network access.
  try {
    summarizeWeek([], weekStart);
  } catch {
    result.checks.configuration = { status: "failed", code: "INVALID_WEEK_START" };
    return result;
  }

  let token;
  try {
    token = await getToken();
    if (!token) throw new Error("EMPTY_TOKEN");
    result.checks.metadata = { status: "passed" };
  } catch (error) {
    result.checks.metadata = failure(error);
    result.checks.sheets = { status: "skipped", code: "METADATA_TOKEN_UNAVAILABLE" };
  }
  if (token) {
    try {
      const sheet = await probeSheets({ token });
      result.checks.sheets = sheet.ok ? { status: "passed", access: "read-only" } : {
        status: "failed", code: "SHEETS_READ_FAILED",
        httpStatus: Number.isInteger(sheet.status) ? sheet.status : null
      };
    } catch (error) {
      result.checks.sheets = failure(error);
    }
  }
  // Firestore uses ADC independently of the Sheets metadata-token request.
  // A Sheets failure must not hide a second failure in Firestore (or vice versa).
  try {
    const plan = await readPlan({ weekStart });
    result.checks.firestore = { status: "passed", access: "read-only" };
    result.metricsStatus = plan.status;
    result.countersPresent = plan.status === "partial";
  } catch (error) {
    result.checks.firestore = failure(error);
  }
  result.ok = Object.values(result.checks).every(check => check.status === "passed");
  return result;
}
