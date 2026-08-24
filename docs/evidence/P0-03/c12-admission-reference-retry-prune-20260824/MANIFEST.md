# C12 successful-retry surplus-key pruning evidence manifest

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

Reviewer finding: `1787562132000-reviewer-CHANGES_REQUESTED`

Code-under-test SHA: `57d1a34883f68088d7f5cd8d5f4ffa736acfc54e`

All commands ran from the repository root on 2026-08-24 and exited `0`.

| Artifact | Command | Result |
|---|---|---|
| `targeted.*.txt` | `npx tsx --test tests/hitl.test.ts tests/http-photo-mutation-resume-w2.test.ts tests/job-reference-manifest.test.ts tests/job-product-snapshot.test.ts tests/product-truth-worker-reference.test.ts` | 56/56 PASS |
| `pg-admission-retry.*.txt` | disposable loopback `npm run test:postgres-admission-retry` | transient retry reused one job id and retained exactly committed manifest keys; PASS |
| `w1.*.txt` | disposable loopback `npm run test:postgres-product-truth-w1` | 28/28 PASS |
| `full-test.*.txt` | `npm test` | 1,133 total; 1,090 PASS; 0 fail; 43 skip |
| `typescript.*.txt` | `npx tsc --noEmit` | PASS |
| `build.*.txt` | `npm run build` | PASS |
| `catalog.*.txt` | `npm run audit:script-catalog` | `summary.passed=true` |
| `postgres-residue*.txt` | query disposable task DB prefixes | empty; residue zero |

The aggregate's 43 skips remain explicitly classified as in the parent
evidence: 39 generic-aggregate PostgreSQL skips without `UJI_PG_URL` (1 D2,
11 money/reconciler, 27 W1), plus four unavailable historical QCF1 artifact
cases, three of which also require paid Gemini opt-in. This remediation
separately ran W1 and the PostgreSQL admission retry/prune verifier against
disposable PostgreSQL. No paid/network model call or replacement historical
artifact was created.

The two `*.at-final.snapshot.md` files preserve this task's final amended
report and PATH matrix. `sha256.txt` hashes every file in this directory except
itself. Validate from this directory with
`shasum -a 256 -c sha256.txt`; later append-only changes outside this directory
cannot invalidate this bundle.
