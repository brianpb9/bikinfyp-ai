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
| 2026-08-26T10:16:50Z | Commit single-use request-bound capability, worker zero-ledger guard, and per-table cleanup observations | `0a2a866952e1a7729c98e9f7029c567c306467c0` |
| 2026-08-26T10:22:08Z | Canonical worker sees trace job during handoff | rejected before provider: `ZERO_LEDGER_JOB_REQUIRES_DETERMINISTIC_WORKER_GATE` |
| 2026-08-26T10:22:17Z | Exact deterministic retry and expanded cleanup receipt | PASS; 13/13 table counts zero |
| 2026-08-26T10:24:53Z | Commit explicit runtime replay counterexample | `7a54128dbaa03f808355791edffeb25d91e69f17` |
| 2026-08-26T10:28:55Z | Final canonical trace receipt | PASS; original HTTP 201; exact replay HTTP 400; READY; all cleanup zero |
| 2026-08-26T10:29:22Z | Restore final canonical worker CMD | `dep-da7c00id0e5s73e37ikg`, live |
| 2026-08-26T10:31:33Z | Final health/control-plane/production read | exact SHA; 3/3 HTTP 200; worker command empty; maintenance off; production unchanged |
| 2026-08-26T10:40:12Z | Commit job-specific trace isolation | `65d54b5b682acc6cde93ca3e32034d382b7dc57d`; held jobs rejected by trace worker |
| 2026-08-26T10:43:37Z | Start final exact-SHA trace worker | `dep-da7c6mek1f9s73cvlj70` |
| 2026-08-26T10:45:16Z | Final isolated trace receipt | PASS; replay 400; READY; 13 table counts/R2/queue all zero |
| 2026-08-26T10:45:33Z | Restore final canonical worker CMD | `dep-da7c7jfavr4c73bkk2u0`, live |
| 2026-08-26T10:47:20Z | Final health and control-plane read | exact SHA; 3/3 HTTP 200; command empty; maintenance off |
| 2026-08-26T10:55:33Z | Commit dedicated trace queue | `a92d9ebf91b9a37998dec27bab3d0e6e888596bd` |
| 2026-08-26T11:00:08Z | First isolated-queue start | failed before DB/queue/provider: BullMQ queue names reject `:` |
| 2026-08-26T11:00:50Z | Commit BullMQ-valid isolated queue name | `565f3fad6446152966bd8003a0aa8f6536bd279b` |
| 2026-08-26T11:06:51Z | Final isolated-queue trace receipt | PASS; trace/canonical queues separately zero and canonical unchanged |
| 2026-08-26T11:07:15Z | Restore canonical worker CMD | `dep-da7chou1egvs73e7bvig`, live |
| 2026-08-26T11:08:49Z | Final health/control-plane read | exact SHA; 3/3 HTTP 200; command empty; maintenance off |

Earlier failed attempts and their cleanup/termination are enumerated in
`ATTEMPT-LINEAGE.md`. No failed attempt reached provider or payment execution.
