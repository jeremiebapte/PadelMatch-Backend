# Metrics preflight: PERMISSION_DENIED investigation (2026-11-02)

## Resolution confirmed by the user's Cloud Shell output

At 2026-11-02 13:44:05 UTC, execution `padima-metrics-probe-v5j6d`
completed with exit 0. Logs report `firestore: accessible`, `sheets: accessible`,
`mode: read-only`, `writes: 0`, `weekStart: 2026-11-02`,
`metricsStatus: no_data`, `countersPresent: false`.

The user created `projects/padelmatch-32186/roles/padimaMetricsReader` with only
`datastore.entities.get` and `datastore.entities.list`, and bound it to the
runtime account with condition
`resource.name=="projects/padelmatch-32186/databases/(default)"`.
This grants database-wide reads, not collection-scoped reads.

The job still uses preflight image tag `5a3540c9f7de82c9fb5234930f1981cc45472647`.
The diagnostic improvements in commit `77eb457` have not been deployed. This
successful run validates read access, not Sheets writes or counter production.
See `README-COUNTER-AUDIT.md` for the remaining ingestion check.

## Original evidence and limits (before the IAM correction)

The supplied 2026-10-29 logs show four `7 PERMISSION_DENIED` failures from
`padima-metrics-probe`, execution `padima-metrics-probe-kwd6m` (15:07–15:09 UTC).
The preceding job update includes actAs for
`padima-metrics-sheets@padelmatch-32186.iam.gserviceaccount.com`.

At branch commit `5a3540c9f7de82c9fb5234930f1981cc45472647`, the preflight awaits
the metadata token and successful Sheets GET before calling Firestore `planSync`.
Consequently these logs, with that image, isolate the failure to Firestore; a
Sheets denial would instead produce `SHEETS_READ_DENIED_403`. This establishes
historical Sheets read access, not present access or write access. It does not
prove which IAM binding is missing. The live job image, identity, ADC overrides,
project and IAM conditions must still be inspected.

The agent could read/write GitHub, but the Cloud Console returned `Site
Unavailable`; no authenticated gcloud environment was available. No IAM change,
deployment, job execution, registry publication or production write was made.

## Corrected diagnostic

`scripts/preflight-padima-metrics.mjs` now emits separate metadata, Sheets and
Firestore results, plus explicit project, default database and collection.
Failure of one service no longer masks the other. Invalid week configuration is
rejected before API access. Raw errors, tokens, document contents, counters and
spreadsheet titles are not logged. A failed/skipped check sets exit code 1.
`no_data` is a successful read, not evidence of zero activity or deployed metrics.
The diagnostic only reads; it does not exercise Sheets write permission.

## Read-only checks from an authenticated Cloud Shell

These commands inspect existing resources without executing or modifying the job:

```sh
gcloud run jobs describe padima-metrics-probe --project=padelmatch-32186 --region=europe-west1 --format='yaml(spec.template.spec.template.spec.serviceAccountName,spec.template.spec.template.spec.containers.image,spec.template.spec.template.spec.containers.command,spec.template.spec.template.spec.containers.args)'
gcloud projects get-iam-policy padelmatch-32186 --flatten='bindings[].members' --filter='bindings.members:padima-metrics-sheets@padelmatch-32186.iam.gserviceaccount.com' --format='json(bindings.role,bindings.condition)'
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="padima-metrics-probe"' --project=padelmatch-32186 --freshness=7d --limit=30 --format='json(timestamp,severity,textPayload,jsonPayload)'
```

Also inspect the job's explicit project environment variables, any
`GOOGLE_APPLICATION_CREDENTIALS` override, and inherited/conditional IAM grants.
Do not export credentials or all environment variables into a public report.
The build publisher identity is distinct from the runtime identity: granting the
publisher more permissions will not repair runtime reads.

## Least privilege remediation, only after verifying the failing identity

The current `readWeekFromFirestore` uses a nontransactional query of
`productMetricsDailyV1`. Firestore `runQuery` requires
`datastore.entities.get` and `datastore.entities.list`.
If these permissions are absent, prefer a custom read role containing those two
permissions, with a binding restricted to database `(default)` using the
supported database resource condition. Inspect IAM deny policies and existing
conditions before granting anything. Do not add Owner, Editor, Firebase Admin,
Datastore User, or service-account impersonation privileges to fix this read.
Even the predefined Datastore Viewer contains more permissions than this query
needs. Firestore server IAM cannot restrict this read role to one collection;
a database-scoped reader still exposes other documents in that database.

Do not change Firestore Security Rules: the server Admin SDK authenticates with
IAM. Do not broaden spreadsheet sharing or change Sheets OAuth permissions to
fix a Firestore gRPC denial. For an independent Sheets 403, verify the runtime
identity's existing access to spreadsheet
`1wFpGfWDU8D86J3XcwigQw6oUcz0S_liG3KiZhioiCPs`, API enablement and token scope.

After an approved minimal IAM correction, rerun the existing read-only job only
after verifying its image/command. The new diagnostic requires a separately
authorized image publication/job update; committing this change deploys nothing.

References:
- https://firebase.google.com/docs/firestore/security/iam
- https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions

Validation: `cd functions && npm run test:metrics`. Unit tests inject API
responses and therefore cannot certify production IAM or OAuth.
