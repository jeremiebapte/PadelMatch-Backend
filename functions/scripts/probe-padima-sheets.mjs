// Read-only probe. Never writes to Sheets or Firestore.
import { metadataAccessToken, probeSheetsAccess } from "../domain/metrics/SheetsAuthProbeV1.js";
try {
  const token = await metadataAccessToken();
  const result = await probeSheetsAccess({ token });
  if (!result.ok) throw new Error("SHEETS_PROBE_FAILED_" + (result.status || "UNKNOWN"));
  console.log("PADIMA Sheets read-only probe: PASS");
} catch (error) {
  console.error("PADIMA Sheets read-only probe: FAIL", error.message);
  process.exitCode = 1;
}
