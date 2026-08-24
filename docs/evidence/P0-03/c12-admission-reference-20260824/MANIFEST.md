# C12 admission reference evidence manifest

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

Code-under-test SHA: `6c3b1d431a8564c13e51b218af5403dbfb8bb3e0`

All commands below ran from the repository root on 2026-08-24. Every listed
command exited `0`.

| Artifact | Command | Result |
|---|---|---|
| `targeted.stdout.txt`, `targeted.stderr.txt` | `npx tsx --test tests/hitl.test.ts tests/http-photo-mutation-resume-w2.test.ts tests/job-reference-manifest.test.ts tests/job-product-snapshot.test.ts tests/product-truth-worker-reference.test.ts` | 52/52 PASS |
| `w1.stdout.txt`, `w1.stderr.txt` | `DATABASE_URL=postgresql://hadrava@127.0.0.1:5432/postgres npm run test:postgres-product-truth-w1` | disposable PG, 28/28 PASS |
| `pg-admission-retry.stdout.txt`, `pg-admission-retry.stderr.txt` | `DATABASE_URL=postgresql://hadrava@127.0.0.1:5432/postgres npm run test:postgres-admission-retry` | 20 jobs, 20 holds; duplicate/readmission PASS |
| `full-test.stdout.txt`, `full-test.stderr.txt` | `npm test` | 1,129 total; 1,086 PASS; 0 fail; 43 skip |
| `typescript.stdout.txt`, `typescript.stderr.txt` | `npx tsc --noEmit` | PASS |
| `build.stdout.txt`, `build.stderr.txt` | `npm run build` | PASS |
| `catalog.stdout.txt`, `catalog.stderr.txt` | `npm run audit:script-catalog` | `summary.passed=true` |
| `mechanical-inventory.txt` | `rg` inventory of production job INSERTs and admission helper callers | exactly 3 INSERT creators; all bind both snapshots |
| `postgres-residue.txt`, `postgres-residue.stderr.txt` | query `pg_database` for task disposable database prefixes | empty; residue zero |

The 43 aggregate skips are classified, not treated as passes: 39 PostgreSQL
tests were skipped because the generic aggregate had no `UJI_PG_URL` (1 D2,
11 money/reconciler, and 27 W1); four `qcf1-tiga-keadaan` tests lacked the
historical real-image artifact, with three also requiring explicit paid Gemini
opt-in. This task separately ran the entire W1 file against disposable local
PostgreSQL (28/28) and its dedicated admission retry proof. It did not create a
replacement historical artifact or make a paid/network model call.

`sha256.txt` hashes every raw artifact and this manifest/report set. Validate
from the evidence directory with `shasum -a 256 -c sha256.txt`.
