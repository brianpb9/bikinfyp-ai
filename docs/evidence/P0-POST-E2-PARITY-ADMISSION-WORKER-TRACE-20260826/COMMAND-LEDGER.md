# Command ledger

| UTC | Action | Result |
|---|---|---|
| 2026-08-26T09:42:33Z | Push remediation SHA `03acd0f706f225039e2f5f16810c6f55e7402b60` to `staging/exact-03acd0f-20260826` | PASS |
| 2026-08-26T09:42:52Z | Deploy staging web at exact SHA | `dep-da7ba72d0e5s73e1058g`, live |
| 2026-08-26T09:45:12Z | Run exact-SHA PostgreSQL predeploy migration | PASS; 35/35 already applied |
| 2026-08-26T09:46:01Z | Start task-bound deterministic trace command on canonical staging worker service | `dep-da7bbm8u01pc738ronpg` |
| 2026-08-26T09:47:25Z | POST supported 15-second high-quality approved script to canonical `/api/jobs` | HTTP 201; returned QUEUED job consumed exactly |
| 2026-08-26T09:47:33Z | Emit asserted worker trace and cleanup receipt | PASS; READY; provider/payment/ledger zero; DB/R2/queue cleanup true |
| 2026-08-26T09:47:54Z | Remove trace command and resume canonical worker image CMD | `dep-da7bcim417fc73f8v0c0` |
| 2026-08-26T09:49:11Z | Verify final worker exact SHA, live, not suspended, empty Docker command override | PASS |
| 2026-08-26T09:52:36Z | Read three public staging health samples | 3/3 HTTP 200; exact SHA; classifier capable; Duitku sandbox/live=false |
| 2026-08-26T09:52:36Z | Read staging and production service/deploy control plane | PASS; staging restored; production IDs/SHAs unchanged from terminal pre-task observation |
| 2026-08-26T09:55:55Z | Commit worker-side immutable admission enforcement and counterexamples | `58aeb4f19874290916a1497707632ff87e7e7d0d` |
| 2026-08-26T09:56:17Z | Deploy staging web and worker at new exact SHA | web `dep-da7bggek1f9s73cu5eg0`; worker `dep-da7bgg95efls73cp6ceg` |
| 2026-08-26T10:00:05Z | First trace-command deploy | stopped before DB/queue/provider; `EXPECTED_APP_SHA` absent |
| 2026-08-26T10:02:20Z | Corrected task-bound trace deploy | `dep-da7bjb1srm7s73823e60`; asserted PASS at 10:03:44Z |
| 2026-08-26T10:04:03Z | Remove override and restore canonical worker CMD | `dep-da7bk4navr4c73biljtg`, live |
| 2026-08-26T10:05:34Z | Final public health and control-plane reads | 3/3 HTTP 200; exact SHA; worker command empty; maintenance off |

Earlier failed attempts and their cleanup/termination are enumerated in
`ATTEMPT-LINEAGE.md`. No failed attempt reached provider or payment execution.
