# C12 admission-time approved reference snapshot

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

Code-under-test: `6c3b1d431a8564c13e51b218af5403dbfb8bb3e0`

## Outcome

The bounded local C12 admission gap identified in E.18 is closed for new jobs.
All three production job creators now install both
`approved_reference_manifest` and `job_product_snapshot` in the admitting
database transaction:

1. retail SQLite `app/api/jobs/route.ts`;
2. retail PostgreSQL `smokeCreateJob`;
3. organization PostgreSQL `renderSatuSel`.

No queue-visible new job can commit without a non-null manifest whose ordered
approved bytes were already copied to deterministic, job-owned keys. Existing
worker first-install/CAS behavior remains only as a safe compatibility path for
legacy rows. No promo-field behavior or reference reason code was changed;
`REFERENCE_IDENTITY_CHANGED` was not introduced.

## Boundary and failure semantics

- The shared preparation helper resolves current approval sidecars, re-reads
  the exact source bytes, verifies SHA-256, and writes ordered keys under
  `jobs/<jobId>/approved-references/<index>-<sha256><ext>` before returning a
  versioned manifest.
- SQLite prepares outside its synchronous transaction, then rechecks the exact
  raw ordered `products.images` value in the INSERT+hold transaction. A race
  retries at most three times with one job id and deterministic keys. Storage
  failure or repeated mutation leaves no job and no hold; enqueue happens only
  after the committed row.
- Both PostgreSQL creators hold `FOR SHARE` on the product row through
  preparation and INSERT. Retail creates one job id outside its bounded
  `40001`/`40P01` retry loop. Storage failure occurs before the hold.
- Prepared storage and the application DB cannot be one transaction. A crash
  may therefore leave harmless unreferenced objects, but never a committed
  manifest pointing to unwritten bytes. No prepared key is deleted on an
  ambiguous commit/CAS result. Future orphan collection is explicitly bounded
  to a grace period plus a fresh authoritative proof that the job id is absent;
  this task intentionally adds no eager admission cleanup or GC policy.
- Admission preserves the established `NO_APPROVED_REFERENCE` machine code
  (HTTP 422 at the API boundary) and existing `REF_MISSING`,
  `REF_HASH_MISMATCH`, `REF_MANIFEST_INVALID`, and
  `REF_MANIFEST_LEGACY_UNSAFE` behavior.

## Acceptance evidence

- Mechanical inventory finds exactly three application production
  `INSERT INTO jobs` creators, and every one includes both manifest and product
  snapshot columns.
- Helper tests prove deterministic idempotence/raw equality, partial PUT failure
  before DB callback, source mutation detected by the exact second read/hash,
  empty/rejected `NO_APPROVED_REFERENCE`, and no delete after ambiguous CAS.
- SQLite tests execute admission, delay, actual E5 source deletion, then first
  W2 attempt. W2 receives admitted bytes/order without installing a manifest.
  A second case mutates the exact images list during PUT and proves bounded
  re-prepare, one job, and one hold; injected storage failure proves zero job
  and zero hold.
- Disposable PostgreSQL W1 tests execute retail admission→E3, retail
  admission→E5 deletion, and organization `renderSatuSel`→E9 deletion before
  first W1. All preserve admitted bytes/order with no worker first-install.
- PostgreSQL retry evidence admits 20 concurrent scripts with exactly 20 jobs
  and 20 holds, preserves active duplicate and terminal readmission semantics,
  and leaves the disposable database residue at zero.
- Exact-SHA checks: targeted 52/52; W1 disposable 28/28; full suite 1,086 PASS,
  0 fail, 43 classified skips; TypeScript, production build, and script catalog
  PASS. Raw outputs and hashes are in
  `docs/evidence/P0-03/c12-admission-reference-20260824/`.

This evidence closes the approved local admission-time C12 slice. It does not
claim deployment, staging exact-SHA proof, production traffic, or resolution of
unrelated C9 promo semantics. Canonical shipping readiness remains **58/100**.

## Reviewer follow-up: rejected-admission storage cleanup

Reviewer finding `1787561141000` correctly identified that storage-first
preparation could leave persistent job-prefixed objects for known-insufficient
SQLite/retail PostgreSQL requests and SQLite concurrent duplicate losers. The
follow-up code `e52e0ef15113ebb6d6fe2817bdc50c7d62d9df7d` closes that leak without
weakening the immutable snapshot boundary:

- SQLite and retail PostgreSQL perform a balance preflight before storage, but
  retain the authoritative admission-transaction balance check.
- Every attempted deterministic target is tracked before PUT. Partial PUT
  failure, SQLite duplicate loser, bounded images-change exhaustion, and known
  PostgreSQL rollback clean only this prepared job id after a fresh database
  read proves the job absent.
- PostgreSQL marks COMMIT as attempted before issuing it. COMMIT/network
  uncertainty never deletes prepared keys. Legacy ambiguous CAS behavior is
  unchanged.
- Cleanup is best-effort. A delete failure retains the orphan, records an
  explicit operational error, and does not change a safe duplicate/failure
  outcome into a retry that could charge twice.
- Regressions prove zero PUT/job/hold for known-insufficient SQLite and
  PostgreSQL requests; SQLite same-script concurrency leaves one job, one hold,
  and winner keys only; PostgreSQL 8-way same-script concurrency has one winner
  and storage prefixes exactly equal admitted job ids; partial PUT and repeated
  SQLite mutation exhaustion leave zero prepared keys; a known PostgreSQL
  rollback cleans its attempted key.

Exact follow-up evidence: targeted **56/56**, W1 **28/28**, money **11/11**,
full suite **1,133 total / 1,090 PASS / 0 fail / 43 classified skip**, plus
TypeScript/build/catalog PASS and disposable PostgreSQL residue zero. Raw logs
and hashes are in `c12-admission-reference-cleanup-20260824/`. Shipping
readiness remains **58/100**; no deployment claim is added.

## Reviewer follow-up: successful-retry surplus-key pruning

Reviewer finding `1787562132000` correctly identified that a successful
SQLite re-prepare or PostgreSQL transient retry could commit a later manifest
while leaving deterministic keys attempted by an earlier try under the same
job prefix. Code `57d1a34883f68088d7f5cd8d5f4ffa736acfc54e` closes that gap:

- After a confirmed successful commit, cleanup re-reads the authoritative
  committed manifest and deletes only tracked job-prefixed targets that are
  absent from that winning manifest.
- A failed authoritative read, invalid committed manifest, delete failure, or
  ambiguous commit outcome retains objects and logs the condition; it cannot
  weaken the existing uncertainty boundary.
- SQLite's successful image-list re-prepare regression now requires the exact
  retained key set to equal the committed manifest. The PostgreSQL verifier
  injects a post-PUT `40001`, changes the approved image list before retry,
  admits with the same job id, and requires the retained winner prefix to
  equal the committed manifest exactly.
- The two earlier evidence bundles now include immutable snapshots of their
  reviewed report and matrix. Their checksums no longer depend on later
  append-only changes to these live documents.

Exact remediation evidence: targeted **56/56**, W1 disposable **28/28**, full
suite **1,133 total / 1,090 PASS / 0 fail / 43 classified skip**, PostgreSQL
retry/prune PASS, TypeScript/build/catalog PASS, and disposable PostgreSQL
residue zero. Raw logs and local-only hashes are in
`c12-admission-reference-retry-prune-20260824/`. Reason codes, promo policy,
deployment state, and canonical shipping readiness **58/100** are unchanged.
