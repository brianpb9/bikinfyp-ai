# Managed staging valid-product trace

Task: `P1-MANAGED-STAGING-VALID-PRODUCT-TRACE-20260825`

Result: **PASS** on the managed staging runtime deployed at exact application SHA
`246fa65949a487e82e4594c0bebb6ecc5a4e53bb`.

The trace used a dedicated disposable identity and deterministic product-photo
fixture. The positive request returned HTTP 201 and created an exact PostgreSQL
product row plus an R2 image and evidence sidecar. The sidecar identified a
valid product photo, a readable three-word label, and a matching content digest.
Bounded counterexamples returned `BRAND_MISMATCH` and `LABEL_UNREADABLE`.

No job-admission request was made. In the PostgreSQL retail path, the balance
check precedes evidence-manifest preparation. Zero balance therefore cannot
reach the next Product Truth boundary, while adding balance would necessarily
enable a hold and enqueue. That would violate this task's zero-money and
zero-queue constraints. No policy or runtime was weakened to manufacture the
remaining negative cases.

The authoritative post-cleanup read found zero task-identity rows across users,
products, scripts, jobs, provider tasks, ledger, payments, and audits; all
BullMQ counts were zero; and both the R2 image and sidecar were absent. Production
service and deploy identities were unchanged from pre-read to post-read.

Files:

- `TRACE-RECEIPT.json`: primary sanitized one-off receipt.
- `CONTROL-PLANE.json`: exact deploy and production non-interference receipts.
- `FIRST-ATTEMPT.json`: fail-closed discovery and clean recovery evidence.
- `VALIDATION.json`: focused tests, source provenance, health samples, and scope.

No credential value or credential digest is present in this bundle.
