// PADIMA metrics sync preflight: read-only Firestore and Google Sheets checks.
// No writes, no scheduling, no personal data in logs.
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { metadataAccessToken, probeSheetsAccess } from "../domain/metrics/SheetsAuthProbeV1.js";
import { planSync } from "../domain/metrics/GoogleSheetsMetricsSyncV1.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "padelmatch-32186";
const today = new Date();
const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7)));
const weekStart = process.env.PADIMA_METRICS_WEEK_START || monday.toISOString().slice(0, 10);
let app;
try {
  const token = await metadataAccessToken();
  const sheet = await probeSheetsAccess({ token });
  if (!sheet.ok) throw new Error("SHEETS_READ_DENIED_" + (sheet.status || "UNKNOWN"));
  app = initializeApp({ credential: applicationDefault(), projectId });
  const plan = await planSync({ db: getFirestore(app), weekStart });
  console.log(JSON.stringify({
    mode: "read-only", projectId, weekStart,
    sheets: "accessible", firestore: "accessible",
    metricsStatus: plan.status,
    countersPresent: plan.status === "partial",
    writes: 0
  }));
} catch (error) {
  console.error("PADIMA metrics preflight failed:", error.message);
  process.exitCode = 1;
} finally {
  if (app) await deleteApp(app);
}
