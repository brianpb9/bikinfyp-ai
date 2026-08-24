# Provenance and sanitization

| Artifact | Primary source | Kept | Removed |
|---|---|---|---|
| `control-plane-baseline.json` | official Render service API + deploy list, read before mutation | IDs, runtime/config, deploy SHA/status, timestamps | token, env vars/values |
| `control-plane-attempt.json` | later file transcription of the contemporaneous official PATCH response + health status probe + deploy list shown in the operator session | candidate config, maintenance boolean, HTTP status, exact SHA/status | token, response headers/body from 503 |
| `control-plane-final.json` | official Render service API + deploy lists after rollback | allowlisted config/deploy fields and DB allowlist count | token, env vars/values, IP/CIDR |
| `health-final.json` | public staging `/api/health` | operational booleans and exact build SHA | verbose user-facing classifier reason |
| `failed-build-log.txt` | Render logs bounded to task window | Docker stages and terminal error class | unrelated lines; any secret or request material |
| `commands.md` | operator transcript | command classes, order, exit/result | bearer token and local credential path details |

Production non-mutation is established by identical deploy IDs, SHAs, and
service `updatedAt` values in the task-start and final captures. The staging
rollback is established by exact config-field equality to baseline plus a new
live rollback deploy at the baseline SHA. The no-canary/no-paid-provider claim
is intentionally scoped to this task/operator and follows from the complete
ledger and failure-before-runtime sequence. The attempt capture proves the hold
at its endpoints, not continuous independent sampling during every intervening
second.
