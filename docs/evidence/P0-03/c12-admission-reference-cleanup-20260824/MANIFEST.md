# C12 rejected-admission cleanup evidence manifest

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

Reviewer finding: `1787561141000-reviewer-CHANGES_REQUESTED`

Code-under-test SHA: `e52e0ef15113ebb6d6fe2817bdc50c7d62d9df7d`

All commands ran from the repository root on 2026-08-24 and exited `0`.

| Artifact | Command | Result |
|---|---|---|
| `targeted.*.txt` | `npx tsx --test tests/hitl.test.ts tests/http-photo-mutation-resume-w2.test.ts tests/job-reference-manifest.test.ts tests/job-product-snapshot.test.ts tests/product-truth-worker-reference.test.ts` | 56/56 PASS |
| `pg-admission-retry.*.txt` | disposable loopback `npm run test:postgres-admission-retry` | insufficient 0 PUT; known rollback cleaned; 8 same-script calls/1 winner; retained prefixes equal DB jobs |
| `w1.*.txt` | disposable loopback `npm run test:postgres-product-truth-w1` | 28/28 PASS |
| `money.*.txt` | disposable loopback `npm run test:pg` | 11/11 PASS |
| `full-test.*.txt` | `npm test` | 1,133 total; 1,090 PASS; 0 fail; 43 skip |
| `typescript.*.txt` | `npx tsc --noEmit` | PASS |
| `build.*.txt` | `npm run build` | PASS |
| `catalog.*.txt` | `npm run audit:script-catalog` | `summary.passed=true` |
| `postgres-residue*.txt` | query disposable task DB prefixes | empty; residue zero |
| `mechanical-cleanup.txt` | source inventory of preflight/final checks, target tracking, commit ambiguity, cleanup | PASS |

The aggregate's 43 skips remain explicitly classified as in the parent
evidence: 39 generic-aggregate PostgreSQL skips without `UJI_PG_URL` (1 D2,
11 money/reconciler, 27 W1), plus four unavailable historical QCF1 artifact
cases, three of which also require paid Gemini opt-in. This follow-up separately
ran W1 and money against disposable PostgreSQL. No paid/network model call or
replacement historical artifact was created.

The two `*.at-04bc074.snapshot.md` files preserve the amended task report and
PATH matrix exactly as reviewed at evidence SHA `04bc074a`. `sha256.txt` hashes
every file in this directory except itself. Validate from this directory with
`shasum -a 256 -c sha256.txt`; later append-only report/matrix changes outside
the directory cannot invalidate this historical bundle.
