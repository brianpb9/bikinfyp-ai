# Provenance and sanitization

The append-only `command-ledger.tsv` records UTC start/end, exit code,
sanitized invocation, retained artifact, and the artifact SHA-256 for each
captured command. Local credentials were supplied only by the authenticated
operator session and were never retained as arguments, artifacts, source paths,
or values. Committed API helpers require an injected token and contain no
credential locator.

Evidence groups:

- `pre-*service*.json` and `final-*service*.json`: allowlisted official Render
  service API responses; no environment variables or secrets;
- `*-deploys.json` and `mutation-exact-sha-deploy.json`: official Render CLI
  deploy records;
- `pre-staging-database-allowlist.json`, `post-add-*`, and `final-staging-*`:
  allowlisted database API state;
- `pre-app-mutation-job-aggregate.txt` and
  `final-task-window-job-aggregate.txt`: direct staging PostgreSQL aggregates
  bounded from task dispatch time;
- `maintenance-health-sampler.jsonl`: periodic allowlisted control-plane state
  plus HTTP status/body hashes, without response bodies;
- `hold-external-health.txt`, `final-external-health-retry.txt`, and
  `sustained-health-*.txt`: direct public probes. The maintenance HTML is
  retained because it is the raw 503 response; it contains no application or
  credential data;
- `candidate-build-runtime-logs.txt`: task-window Render build/runtime logs;
- `candidate-migration-state.txt`: direct 35-row migration ledger;
- `pre-*ref.txt`, `post-push-*`, and `final-*ref.txt`: Git remote observations;
- `candidate-private-health-via-ssh*.txt`: failed read-only attempts retained
  rather than silently omitted.
- `remediation-parity-baseline.txt` and
  `remediation-parity-sustained-final.txt`: direct PostgreSQL snapshots that
  hash every relevant table row while exposing only counts, totals, and
  digests; `remediation-parity-compare.txt` proves normalized equality;
- `remediation-queue-final.txt`: read-only BullMQ queue counts from a bounded
  staging one-off job, without Redis credentials or job payloads;
- `remediation-worker-*.json` and `remediation-web-*.json`: allowlisted service
  and exact-deploy fields after web/worker parity remediation; and
- `remediation-health-*.txt`: direct public health probes after the controlled
  hold was released.
- `replay-pre-rollout-*`, `replay-post-rollout-*`, and `replay-sustained-*`:
  the final retained worker-suspended baseline, exact-SHA rollout, and
  immediate/sustained full-table plus BullMQ observations;
- `replay-worker-suspend.txt`, `replay-worker-resume.txt`, and matching service
  and deploy artifacts: retained control-plane transitions for the final
  replay; and
- `replay-production-*-service-final.json` plus
  `replay-production-service-compare.txt`: post-replay allowlisted production
  configuration and exact comparison with pre-task baselines.

The first four `pre-*-service.json` files ending without `-retry` record a
capture-helper credential-parser failure before the successful allowlisted
reads. They contain only the error and no credential material. The initial
database aggregate failure is likewise retained.

The evidence ledger covers all captured external reads and mutations used for
the managed conclusion. An earlier remediation attempt had uncaptured initial
transitions and only post-rollout fingerprints; it is historical and not the
final safety basis. The final `replay-*` sequence retains maintenance hold,
worker suspend/resume, suspended service readback, pre-resume fingerprints and
queue counts, deploy terminal state, immediate and sustained observations,
allowlist restoration, post-replay production service readbacks, and release
health.
Additional local `jq`, `sed`, `rg`, `head`, `tail`, and `wc` inspections were
read-only conveniences and are not the sole source for any conclusion.
Pre-helper read-only discovery is disclosed in `NOTES.md` without invented
timestamps.

The operator IPv4 address was post-capture redacted to `<REDACTED_IP>` in the
five artifacts that contained it. Their ledger SHA-256 fields identify the
sanitized committed bytes; `NOTES.md` records this narrow sanitation step.
