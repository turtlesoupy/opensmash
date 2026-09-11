# Generated fighter loading failures, September 10, 2026

Production revision `opensmash-web-00052-mmw` logged terminal Firestore watch
errors beginning around 21:21 UTC. Its error callback only logged the failure.
Instances then retained stale job maps. Nineteen of twenty sampled fighter
bundle 404s came from instances with logged terminal watch failures.

The stale maps also fed `reconcileStaleJobs`: an expired cached queued record
could overwrite a completed Firestore record, commonly resetting revision 38
to revision 3 and discarding its published artifact references and capability.
This explains failures that persisted after restarting the API.

## Repair

- `1316231`: reconnect terminal watchers with bounded exponential backoff;
  reconcile deletions from the first full snapshot after reconnecting.
- `57f4c51`: atomically check the expected database revision before marking a
  job interrupted; refresh the cache when the database has moved forward.
- Regression coverage includes reconnects, missed changes/deletions, shutdown,
  stale callbacks, backoff, newer completions, and deleted records.
- All 271 server/shared tests passed.

API-only hotfix images were built on the exact deployed image, with SHA-256
checks on the original files before replacement. Engine, frontend, environment,
and worker deployment were preserved. Final API revision:
`opensmash-web-00054-4md`, image tag `watch-recovery-v2-20260911`.
Cloud Build: `bdc153ed-2886-4c83-be2e-0e018ba6f13f`.

## Data recovery

Thirty revision-3 interrupted jobs still had complete published manifests and
all referenced objects. Five completed records were recovered from Firestore's
one-hour history; the other records were reconstructed from their matching
published version manifests. Existing ownership and visibility were retained.
Each write required the audited document update time, preventing overwrites of
concurrent changes. Recovered revisions were advanced to 101.

Deleted records and jobs without complete published output were not restored.
Raw audit/recovery inputs and results were kept under `/tmp/smash-*` on the
operator machine; they contain private job data and are not committed.
