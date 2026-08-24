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
