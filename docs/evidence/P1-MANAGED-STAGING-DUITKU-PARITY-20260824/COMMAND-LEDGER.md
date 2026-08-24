# Sanitized command ledger

All times are UTC. Exit `0` means the command completed successfully. Secret-bearing request bodies and one-off command payloads are intentionally omitted; their allowlisted results are preserved in the other receipts.

| UTC | Exit | Operation | Receipt/result |
| --- | ---: | --- | --- |
| 2026-08-24T11:31:30Z | 0 | Reuse immutable pre-task production control-plane receipt | `docs/evidence/P0-03/managed-web-classifier-canary-20260824/control-plane-final.json`; committed before this task |
| 2026-08-24T16:08:41Z | 0 | Consume canonical TASK with `bus-read builder` | Task SHA `89cfdf0...`, stale=false |
| 2026-08-24T16:12:24Z | 0 | Render API: staging web maintenance on | HTTP 200; public health transitioned 200, 200, 503 |
| 2026-08-24T16:12:29Z | 0 | Render API: suspend staging worker | HTTP 202 |
| 2026-08-24T16:12:46Z | 0 | Create read-only queue baseline one-off | `job-da66qvjbc2fs73b3uhe0`, succeeded |
| 2026-08-24T16:13:50Z | 1 | Create first read-only DB baseline one-off | `job-da66rfgjo6nc73ei7o2g`, shell quoting failure, no mutation |
| 2026-08-24T16:14:37Z | 0 | Create corrected read-only DB baseline one-off | `job-da66rrbncjis73aseku0`, succeeded |
| 2026-08-24T16:15:45Z | 0 | Atomic GET/merge/PUT staging web env | HTTP 200; 26 to 30 slots; unrelated values preserved |
| 2026-08-24T16:16:00Z | 0 | Push accepted SHA to staging-only branch | Remote branch created; `main` not touched |
| 2026-08-24T16:16:12Z | 0 | PATCH staging web/worker branch and `autoDeploy=no` | Both HTTP 200 |
| 2026-08-24T16:16:16Z | 0 | Create exact web deploy | `dep-da66sk3ncjis73asgu80` |
| 2026-08-24T16:16:22Z | 0 | Resume worker once | HTTP 202; created `dep-da66slm417fc739h2mf0` |
| 2026-08-24T16:20:05Z | 0 | Poll exact deploys to terminal state | Both live; one intended deploy each |
| 2026-08-24T16:20:36Z | 0 | Postdeploy DB/queue read-only probes | Both succeeded; matched baseline |
| 2026-08-24T16:21:02Z | 0 | Render API: staging web maintenance off | HTTP 200 |
| 2026-08-24T16:21:07Z | 0 | Three public health samples | 3/3 HTTP 200, exact SHA, Duitku sandbox, live=false |
| 2026-08-24T16:21:35Z | 0 | Unauthenticated checkout canary | HTTP 401 `UNAUTHORIZED` |
| 2026-08-24T16:21:35Z | 0 | Invalid-signature callback canary | HTTP 401 `INVALID_SIGNATURE` |
| 2026-08-24T16:21:46Z | 0 | Locally signed unknown-order callback canary | HTTP 200, ignored=true, no credit |
| 2026-08-24T16:22:07Z | 0 | Final DB/queue read-only probes | Both succeeded; matched baseline |
| 2026-08-24T16:22:20Z | 0 | Initial post-task read-only production deploy/ref check | Values unchanged; terminal output was not file-preserved and is not the claimed source receipt |
| 2026-08-24T16:31:13Z | 0 | Preserved post-task production service/deploy/ref read | `PRODUCTION-POST-READ.json`; values match immutable pre-task deploy baseline |
| 2026-08-24T16:35:40Z | 0 | Exact-value secret scan over final evidence set | 14 files, 2 keys compared, zero matches |

No deploy-create command was repeated. Repeated deploy commands in the terminal were read-only list/poll operations.
