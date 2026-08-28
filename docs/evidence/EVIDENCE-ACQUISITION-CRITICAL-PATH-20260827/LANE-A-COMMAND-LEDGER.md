# Lane A independent read-only refresh

All commands below were read-only. JSON was parsed in memory and only the
allowlisted fields committed in `LANE-A-READONLY-ARTIFACT.json`.

| UTC window | Command class | Result |
|---|---|---|
| 2026-08-27 15:33–15:34 | `render services --output json --confirm` | staging and production service identity/config allowlist captured |
| 2026-08-27 15:33–15:34 | `render deploys list <service-id> --output json --confirm` for both staging and both production services | terminal deploy ID/status/SHA/times captured |
| 2026-08-27 15:33–15:34 | `render jobs list <staging-service-id> --output json --confirm` | exact readback job terminal status/times captured |
| 2026-08-27 15:34 | `render postgres get <staging-postgres-id> --output json --confirm` | status/plan/version/HA allowlist captured; no connection data persisted |
| 2026-08-27 15:34 | HTTPS GET staging `/api/health` | HTTP 200, exact build SHA, sandbox/live=false, classifier capability captured |
| 2026-08-27 15:34 | `render logs --resources <readback-job-id>` within exact one-minute window | one structured `lane-a-managed-readback/v1` line parsed; no raw logs persisted |

No `deploys create`, service/database update, job creation, environment read,
production behavior probe, provider call, payment, or real-money operation was
performed by this refresh.
