# C9 promo output counterexample evidence manifest

TASK=`P1-C9-PROMO-OUTPUT-COUNTEREXAMPLE-20260824`

Code-under-test SHA: `618ba6355e7a8afd336031db8dadaf6a0dd8b41f`

All commands ran from the repository root on 2026-08-24 and exited `0`.

| Artifact | Command | Result |
|---|---|---|
| `affected.*.txt` | `npx tsx --test tests/http-photo-mutation-resume-w2.test.ts tests/promo.test.ts` | 19/19 PASS |
| `w1.*.txt` | disposable loopback `npm run test:postgres-product-truth-w1` | 29/29 PASS |
| `full-test.*.txt` | `npm test` | 1,135 total; 1,091 PASS; 0 fail; 44 skip |
| `typescript.*.txt` | `npx tsc --noEmit` | PASS |
| `build.*.txt` | `npm run build` | PASS |
| `catalog.*.txt` | `npm run audit:script-catalog` | `summary.passed=true` |
| `postgres-residue*.txt` | query disposable W1 database prefix | empty; residue zero |

The aggregate's 44 skips are 40 generic-suite PostgreSQL skips without
`UJI_PG_URL` (1 D2, 11 money/reconciler, 28 W1), plus four unavailable
historical QCF1 artifact cases, three of which also require paid Gemini opt-in.
W1 ran separately against disposable local PostgreSQL. No paid/network model
call or replacement historical artifact was created.

The two `*.snapshot.md` files are immutable copies of the final task report and
append-only PATH matrix. `sha256.txt` hashes every file in this directory except
itself. Validate here with `shasum -a 256 -c sha256.txt`.
