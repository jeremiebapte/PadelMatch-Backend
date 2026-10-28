# PADIMA metrics V1 — Sheets access (not deployed)

Target spreadsheet: `1wFpGfWDU8D86J3XcwigQw6oUcz0S_liG3KiZhioiCPs`

Service account: `padima-metrics-sheets@padelmatch-32186.iam.gserviceaccount.com`

## Current state
- The service account has editor access to this spreadsheet only.
- The sync code remains on `feature/product-metrics-v1`.
- No Cloud Scheduler, Cloud Run job, Firebase deployment, production Firestore read or live Sheets write has been authorized.
- `npm run metrics:sync:dry-run` performs a **configuration-only** dry run, without connecting to either API.
- Unit tests mock Sheets HTTP calls. They do not prove OAuth works against Google Sheets.

## Keyless production design (future approval required)
1. Enable Google Sheets API in Google Cloud project `padelmatch-32186`.
2. Run a Cloud Run Job as the service account above; use Application Default Credentials with the OAuth scope `https://www.googleapis.com/auth/spreadsheets`. Ensure the job also has *read-only* Firestore permissions.
3. Obtain a short-lived OAuth access token from the runtime identity; supply it in-memory as `GOOGLE_OAUTH_ACCESS_TOKEN`. Never store JSON keys or tokens in GitHub.
4. Explicitly set `GOOGLE_CLOUD_PROJECT=padelmatch-32186`, `PADIMA_METRICS_ALLOW_WRITE=yes` and optionally `PADIMA_METRICS_WEEK_START=YYYY-MM-DD`.
5. Execute `node scripts/sync-padima-metrics.mjs --write` after approval. Only partial metrics are written; missing metrics remain blank.
6. Schedule only after reviewing the first real sync and reconciling the Firestore counters.

**Caveat:** A Cloud Run runtime identity's default token scopes may not include Sheets. Verify scoped access token acquisition and API enablement before activation. The existing adapter expects a valid scoped token; the token-acquisition component is not yet implemented.
