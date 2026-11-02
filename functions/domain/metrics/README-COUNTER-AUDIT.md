# Counter ingestion audit — 2026-11-02

## Verified in source

The feature branch exports two Firestore functions in `functions/index.js`:

| Function | Source event | Effect |
| --- | --- | --- |
| recordProductMatchCreatedV1 | Create matches/{matchId} | Created count, initial non-creator joins, full count if applicable |
| recordProductMatchUpdatedV1 | Update matches/{matchId} | New non-creator joins, full count if applicable |

Both run in `europe-west1`. The recorder writes daily UTC counters into
`productMetricsDailyV1` and deduplication records into `productMetricEventsV1`
in one transaction per metric event. The reader job only reads these counters;
running it cannot populate them. Existing matches are not replayed by these
source handlers; no backfill command has been implemented or executed.

Current GitHub main (`7a824ba06e8b99bf894e8302417ec5ff113766f9`) does not contain
these exports. The feature branch is behind main by two commits as of this audit.
Neither fact proves that the functions are absent from production: someone may
have deployed directly from another branch. Do not deploy the whole feature
branch as a shortcut to checking their existence.

The successful production probe only checked the week starting 2026-11-02.
`no_data` proves no daily counter documents matched that week, not that all
historical counters are absent or that the functions are undeployed.

## Validation

`test-product-metrics-emulator.mjs` now exercises the recorder, real emulator
weekly range query and resulting Sheets payload together. It checks retry-safe
weekly upserts with a fake Sheets client and verifies that an empty new week
cannot overwrite the dashboard with zeros. It does not invoke deployed triggers
or call Google Sheets. The GitHub emulator workflow uses a demo project only.

## Remaining live check (read only)

The agent's Google Cloud Console and Cloud Shell pages return Site Unavailable.
Run this inventory from an authenticated Cloud Shell; no deployment or writes:

```sh
gcloud functions list --project=padelmatch-32186 --regions=europe-west1 --filter='name~recordProductMatch' --format='json(name,state,status,buildConfig.entryPoint,eventTrigger)'
```

A successful empty list means no matching functions were listed in this region.
An authorization/API error is inconclusive. If functions are present, inspect
their state and event filters, then their execution logs. If absent, prepare a
separate deployment of these two functions only for explicit authorization.
Do not give the read-only Sheets job Firestore write permissions: its identity
is separate from the counter-writing functions' runtime identity.

No production counter writes, backfill, Sheets writes, merge or deployment were
performed during this audit. Sheets write access remains untested.

CLI reference: https://docs.cloud.google.com/sdk/gcloud/reference/functions/list
