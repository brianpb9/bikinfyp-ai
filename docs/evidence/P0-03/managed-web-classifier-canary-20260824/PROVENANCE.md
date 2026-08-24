# Provenance and sanitization

| Artifact | Primary source | Kept | Removed |
|---|---|---|---|
| `control-plane-baseline.json` | later transcription of official Render service API + deploy-list output read before mutation | IDs, runtime/config, deploy SHA/status, timestamps | token, env vars/values; no contemporaneous raw file |
| `control-plane-attempt.json` | later file transcription of the contemporaneous official PATCH response + health status probe + deploy list shown in the operator session | candidate config, maintenance boolean, HTTP status, exact SHA/status | token, response headers/body from 503 |
| `control-plane-final.json` | official Render service API + deploy lists after rollback | allowlisted config/deploy fields and DB allowlist count | token, env vars/values, IP/CIDR |
| `health-final.json` | public staging `/api/health` | operational booleans and exact build SHA | verbose user-facing classifier reason |
| `failed-build-log.txt` | Render logs bounded to task window | Docker stages and terminal error class | unrelated lines; any secret or request material |
| `commands.md` | later reconstruction from operator-session tool calls | literal sanitized invocations, per-command timestamps/results, artifact links | bearer token value |

The direct final-state read establishes that staging web is live/healthy at the
known prestate SHA with the original Node config. Because the baseline,
intermediate responses, and ledger were not preserved as contemporaneous raw
files, this bundle does not independently prove maintenance continuity, the
full mutation sequence, or interval-level non-mutation for worker, database,
jobs, or production. No job aggregate was taken. The reconstructed ledger also
cannot prove absence of an unrecorded/provider command.
