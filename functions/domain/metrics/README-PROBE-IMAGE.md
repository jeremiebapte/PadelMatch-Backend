# PADIMA Sheets read-only probe container

The Dockerfile at `functions/Dockerfile.metrics-probe` builds a minimal Node 22 image containing only the Sheets read-only probe. It does **not** import Firebase Admin or the metrics sync writer.

Run locally from repository root:
```sh
docker build -f functions/Dockerfile.metrics-probe -t padima-metrics-probe:local functions
```

GitHub Actions `PADIMA Metrics V1 Probe Image` builds the container on demand, but does **not** publish an image, configure Cloud Run or execute against Google APIs.

Cloud Run Job intended name: `padima-metrics-sheets-probe`
Region: `europe-west1`
Runtime service account: `padima-metrics-sheets@padelmatch-32186.iam.gserviceaccount.com`
Tasks: 1, no automatic execution.

The job checks its runtime identity and reads only spreadsheet metadata. It makes no Sheets writes. The image must be built and published to a private Artifact Registry repository before the Cloud Run console can accept a real image URL. Do not use the job name as an image URL. Avoid granting any Firestore permissions to this probe identity.

After a separate approval, configure a least-privilege image build/publish workflow using workload identity federation rather than a JSON service-account key. Then create and execute the job explicitly.
