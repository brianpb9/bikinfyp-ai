# C9/C12 Structural Inventory — 2026-08-24

TASK=`P1-C9-C12-STRUCTURAL-INVENTORY-20260824`

Baseline exact SHA=`752684eefc60a3ccb13f59e5b3daf98a83adf652`

Baseline tree=`5ccc35b226043fdb74b177d134362d5ded4674ed`

## Verdict

- **C9 remains PARTIAL.** Every production admission atomically freezes the
  core prompt fields represented by `jobs.job_product_snapshot`; both workers
  and A6 consume that durable subset. Promo fields are excluded from the
  snapshot and remain live through compositing, so E3/E7 can change a queued or
  resumed job's discount/deadline/scarcity overlay. The requested
  `SNAPSHOT_IMMUTABLE` reason/status does not exist, and the reference identity
  is not admission-bound before its first worker install.
- **C12 remains PARTIAL.** Once `jobs.approved_reference_manifest` exists,
  mutation, retry, resume, A6, W1, and W2 retain and reverify the same ordered
  bytes. Before the first worker install, however, the worker derives its
  candidate from the then-current `products.images`.
- Shipping readiness remains **58/100**. This evidence-only task neither changes
  the score nor closes any release ceiling.

## Authority model: settled versus proposed

| Item | Classification | What the code proves |
|---|---|---|
| Core product prompt snapshot | Settled subset | All three production job creators build and insert `job_product_snapshot` in the admission transaction. It freezes name, category, price, trusted brand, visual description, brand brief, and claims. Existing snapshot wins on retry/resume; structured Story Ads without one fail closed. |
| Promo overlay fields | Live-data exception; policy unresolved | `promo_price_before_idr`, `promo_ends_at`, and `promo_stock_left` are not in `job_product_snapshot`. W1/W2 retain them from the current joined product row and pass them to `resolvePromo` at compositing. |
| Approved reference manifest | Settled, but only after installation | First successful worker-side CAS/row-lock install wins. The job-owned copies are materialized and rehashed; later `products.images` mutation cannot replace them. |
| `SNAPSHOT_IMMUTABLE` | Proposal only | No such reason/status occurs in production or tests. This inventory does not invent it. |
| `REFERENCE_IDENTITY_CHANGED` | Proposal only | No such reason/status occurs in production or tests. Current failures include `NO_APPROVED_REFERENCE`, `REF_MISSING`, `REF_HASH_MISMATCH`, `REF_MANIFEST_INVALID`, and `REF_MANIFEST_LEGACY_UNSAFE`; A6 returns its existing generic bad-request envelope. |

## Boundary inventory

“Provider reachable” means the path can eventually call a paid/external
provider after all existing guards pass; no external provider was called by
this audit.

| Boundary | Exact production path / symbol | Mutation or re-entry | Durable authority and identity result | Current reason/status | Provider reachable | Existing direct proof | Missing proof |
|---|---|---|---|---|---|---|---|
| E3 | `app/api/products/[id]/route.ts:13-80`, `PATCH`; PostgreSQL branch calls `pgUpdateProduct` | Retail metadata and promo edit | Core prompt subset remains at admission, but current-row promo fields reach `resolvePromo`/compositor and can change the output overlay | HTTP success; no snapshot-change reason | Yes, through later W2 **or W1** according to runtime mode | W2 provider-prompt only: `http-photo-mutation-resume-w2.test.ts:206`; `product-truth-worker-reference.test.ts:686` | Direct E3→W1 route proof and W1/W2 rendered promo-output boundary are uncovered; snapshot-vs-live promo policy unresolved |
| E5 | `app/api/products/[id]/photos/route.ts:147-174`, `DELETE` via `lib/retail-product-images.ts:40-59`; PostgreSQL branch calls `pgRemoveRetailProductImage` | Retail image delete | Installed manifest remains authoritative; missing job-owned bytes fail closed | `REF_MISSING` when durable bytes are absent; mutation itself succeeds | Yes, through later W2 **or W1** according to runtime mode | W2: `http-photo-mutation-resume-w2.test.ts:270,319,352` | Direct E5→W1 route proof and admission-to-first-install mutation proof are uncovered; proposed identity-change reason absent |
| E7 | `app/api/dashboard/campaign/product/route.ts:99-155`, `PATCH` | Org metadata and promo edit | Core prompt subset remains at admission, but current-row promo fields reach `resolvePromo`/compositor and can change the output overlay | HTTP success; no snapshot-change reason | Yes, only through later W1 | `pg-product-truth-w1.test.ts:858` observes the provider prompt, not rendered promo output | W1 rendered promo-output boundary; snapshot-vs-live promo policy unresolved; A6 route counterexample absent |
| E9 | `app/api/dashboard/campaign/product/[id]/photos/route.ts:118-135`, `DELETE` via `lib/postgres/smoke-runtime.ts` | Org image delete | Installed manifest remains authoritative; missing job-owned bytes fail closed | `REF_MISSING` when durable bytes are absent; mutation itself succeeds | Yes, only through later W1 | `pg-product-truth-w1.test.ts:953,1000,1032` | Admission-to-first-install mutation case; proposed identity-change reason |
| A6 approve | `app/api/dashboard/campaign/job/[jobId]/route.ts:110-203` | Approval re-entry | Parses core product snapshot and parses/materializes manifest before approval mutation or enqueue; this does not freeze promo fields used after resume | Legacy/invalid guard becomes existing bad-request response | Yes, after guard and resume | `job-product-snapshot.test.ts:130`; `job-reference-manifest.test.ts:188` | Full HTTP counterexample and rendered promo-output boundary after approval |
| A6 regenerate | `app/api/dashboard/campaign/job/[jobId]/route.ts:204-318` | Regeneration ledger, reset, resume | Same guards run before charge, ledger, reset, and enqueue; durable core snapshot/manifest are not replaced, while promo remains live | Existing bad-request response on guard failure | Yes, after guard and resume | Same structural tests bind guard ordering | Full HTTP counterexample, rendered promo-output boundary, and explicit immutable reason/status |
| Retry/resume | `lib/job-queue.ts:67-97`, `enqueueJob`, `enqueueJobResume`; `scripts/worker.ts:28` | Queue carries `jobId` only | Worker reloads the same job. Existing core snapshot/manifest wins, but promo fields are reloaded live from products | Existing worker failure state and truthful error | Yes, after guards | W1/W2 resume tests and manifest concurrency/crash tests | No output-boundary proof for promo mutation; no direct cross-process crash test spanning admission before first manifest install |
| W1 | `lib/postgres/worker.ts:292-423,808-809`, `processPostgresJob` | PostgreSQL worker entry | Core prompt fields load from job snapshot. Promo stays from joined current product row. Manifest is loaded or first-installed with row lock, then materialized | Existing reference codes; job failure/refund path | Yes, after all guards | Disposable PostgreSQL suite: 25/25; prompt observers only for E7 mutation | Admission-to-first-install mutation proof and rendered promo-output mutation proof |
| W2 | `lib/worker.ts:109-230,396-401`, `processJob` | SQLite worker entry | Core prompt fields load from job snapshot. Promo stays from current product row. Manifest is loaded or first-installed with CAS transaction, then materialized | Existing reference codes; job failure/refund path | Yes, after all guards | W2 suite: 19/19; prompt observers only for E3 mutation | Admission-to-first-install mutation proof and rendered promo-output mutation proof |
| Reference install/reuse | `lib/job-reference-manifest.ts:46-125`; PG writer `lib/postgres/jobs.ts:53-82`; SQLite writer `lib/worker.ts:202-230` | First install, concurrent install, reuse | After installation: immutable ordered identity and job-owned bytes. Before installation: candidate comes from current product images | `NO_APPROVED_REFERENCE` for no acceptable candidate; `REF_MISSING`, `REF_HASH_MISMATCH`, `REF_MANIFEST_INVALID`; `REF_MANIFEST_LEGACY_UNSAFE` for unsafe legacy install | Yes, only after materialization succeeds | Helper concurrency/crash suite plus W1/W2 reorder/delete/add tests | Admission-bound identity policy is unresolved; direct retail E3/E5→W1 route proof is absent |
| Product snapshot install/reuse | `lib/job-product-snapshot.ts:24-135`; admission writers below; legacy fallbacks in both workers | Admission, legacy fallback, reuse | Represented core fields are admission-bound and existing snapshot wins. Promo fields are not represented and stay live. Legacy fallback refuses unsafe provider-touched rows | `PRODUCT_SNAPSHOT_LEGACY_UNSAFE` for unsafe legacy; parse failures otherwise | Yes, only after parsing succeeds | `job-product-snapshot.test.ts` and W1/W2 provider-prompt mutation tests | W1/W2 rendered promo-output boundary absent; requested new reason/status absent |

## Mechanical writer and alternate-route enumeration

Exactly three production `INSERT INTO jobs` call sites exist and all include
`job_product_snapshot`:

1. retail SQLite — `app/api/jobs/route.ts:199-220`;
2. org PostgreSQL — `lib/dashboard/render-cell.ts:145-232`;
3. retail PostgreSQL smoke runtime — `lib/postgres/smoke-runtime.ts:213-254`.

None includes `approved_reference_manifest`. The only production update writers
for that field are `lib/worker.ts:202-230` and
`lib/postgres/jobs.ts:53-82`. The only product-snapshot fallback writers are
`lib/worker.ts:141-168` and `lib/postgres/jobs.ts:85-113`.

Product metadata writers include both retail E3 branches (SQLite direct update
and PostgreSQL `pgUpdateProduct`), D1 wrapper paths in
`lib/postgres/product-persona-script.ts:112-140`, and org E7. Image-list writers
are both E4/E5 branches through `lib/retail-product-images.ts:19-63`
(`pgRemoveRetailProductImage` on PostgreSQL) and E8/E9 through
`lib/postgres/smoke-runtime.ts:307-397`. Thus E3/E5 can re-enter W1 as well as
W2; the current direct tests cover only E3/E5→W2. Script-side direct job inserts are
disposable verifier fixtures, not application admission routes;
`smokeCompleteJob` is a deterministic test-only bypass, not a provider path.
The raw mechanical enumeration is preserved in
`c9-c12-structural-20260824/mechanical-inventory.txt`.

## Preserved counterexample: mutable promo output after admission

`JobProductSnapshot` does not contain `promo_price_before_idr`,
`promo_ends_at`, or `promo_stock_left`. After the workers replace the represented
core fields with snapshot values, W2 still calls `resolvePromo` with current-row
fields at `lib/worker.ts:396-401`; W1 does the same at
`lib/postgres/worker.ts:808-809`. Therefore:

1. admission freezes the represented core fields;
2. the job waits or resumes;
3. E3/E7 adds, removes, or changes promo price, deadline, or stock;
4. W1/W2 computes the compositor overlay from the changed current row;
5. the approved job can gain, lose, or change discount/deadline/scarcity text.

Existing E3/E7 tests deliberately prove the provider prompt still receives the
core admission snapshot, but stop before the rendered/compositor output. They do
not disprove this live promo path. Whether promo should be snapshotted or remain
intentionally live is a policy decision outside this evidence task.

## Preserved counterexample: reference identity before first install

The following deterministic sequence remains possible:

1. production admission inserts a job with `job_product_snapshot` but
   `approved_reference_manifest = NULL`;
2. the job waits in the queue;
3. E5 or E9 mutates `products.images`;
4. the first W1/W2 run reads the current product image list;
5. `loadOrCreateJobReferenceManifest(existingRaw: null, candidateRels: current
   images)` installs that post-mutation identity.

This does **not** contradict the settled rule “manifest is immutable after its
first installation,” so this task does not silently repair code under a stronger
unstated rule. The bounded follow-up recommendation is to make admission install
the reference manifest in the same durable job-creation boundary, then retain
the existing worker reuse/materialization rules. That closes the observed race
without selecting or inventing a new reason code. Adopting this stronger
admission-time contract still requires an approved implementation work order.

## Verification at the exact baseline

| Check | Result |
|---|---|
| Structural + route tests | 31/31 PASS, 0 skip |
| Complete W2 reference suite | 19/19 PASS, 0 skip |
| Disposable PostgreSQL W1 suite | 25/25 PASS, 0 skip; database dropped |
| `npx tsc --noEmit` | PASS |
| Structural assertions | PASS: 3/3 production admissions install the represented core-field product snapshot; 0/3 install reference manifest |

Raw stdout, stderr, timings, structural assertions, and mechanical inventory are
under `docs/evidence/P0-03/c9-c12-structural-20260824/`. Tests used only local
fixtures and a disposable loopback PostgreSQL database; no remote, paid,
deployment, or production-data operation occurred.

## Required follow-up boundary

The recommended next bounded C12 implementation is admission-time reference-manifest
installation across all three production job creators, with exact W1/W2 tests
for admission → queue delay → E5/E9 mutation → first worker. The evidence slice
should also add the currently uncovered retail PostgreSQL E3/E5→W1 route cases.
It should preserve the current set of reason codes—including
`NO_APPROVED_REFERENCE` and `REF_MANIFEST_LEGACY_UNSAFE`—unless a separate
approved work order changes them.
Because this strengthens the reference-identity authority beyond the current
settled after-install contract, implementation still requires approval.
Separately, C9 needs W1/W2 output-boundary tests that preserve the current live
promo behavior as a counterexample, followed by an approved policy choice
between admission snapshot and intentionally live promo. This inventory makes
no such choice. Until then, C9 and C12 remain PARTIAL and this task is
evidence-complete.
