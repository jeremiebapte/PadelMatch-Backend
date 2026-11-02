// PADIMA metrics sync preflight: read-only Firestore and Google Sheets checks.
// No writes, no scheduling, no personal data in logs.
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { metadataAccessToken, probeSheetsAccess } from "../domain/metrics/SheetsAuthProbeV1.js";
import { planSync } from "../domain/metrics/GoogleSheetsMetricsSyncV1.js";
import { runMetricsPreflight } from "../domain/metrics/MetricsPreflightV1.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "padelmatch-32186";
const today = new Date();
const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7)));
const weekStart = process.env.PADIMA_METRICS_WEEK_START || monday.toISOString().slice(0, 10);
let app;
try {
  const result = await runMetricsPreflight({
    projectId, weekStart,
    getToken: metadataAccessToken,
    probeSheets: probeSheetsAccess,
    readPlan: async () => {
      app = initializeApp({ credential: applicationDefault(), projectId });
      return planSync({ db: getFirestore(app), weekStart });
    }
  });
  console.log(JSON.stringify({ severity: result.ok ? "INFO" : "ERROR",
    message: "PADIMA metrics preflight", ...result }));
  if (!result.ok) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ severity: "ERROR", message: "PADIMA metrics preflight",
    stage: "runtime", code: "UNEXPECTED_FAILURE", writes: 0 }));
  process.exitCode = 1;
} finally {
  if (app) await deleteApp(app);
}
