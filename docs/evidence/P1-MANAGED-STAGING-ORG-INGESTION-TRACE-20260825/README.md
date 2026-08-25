# Managed staging organization ingestion trace

Task: `P1-MANAGED-STAGING-ORG-INGESTION-TRACE-20260825`

Result: **PASS** on managed staging application SHA
`246fa65949a487e82e4594c0bebb6ecc5a4e53bb`.

A dedicated disposable user and organization exercised the public E6 manual
organization-product endpoint and E8 add-photo endpoint. E6 returned the exact
product and persisted its complete immutable create data under the expected
organization and owner. E8 then persisted one ordered image key identically in
the API response and PostgreSQL, with the same R2 object and valid sidecar.

The deterministic unreadable-label input returned HTTP 400
`LABEL_UNREADABLE` before DB or R2 mutation. A managed brand-mismatch request
was not manufactured: E6 manual create has no brand input and authoritatively
persists `raw_meta=null`, so E8 has no registered brand for comparison. Direct
DB mutation or inventing a new API contract would not prove the existing E6→E8
path and was outside this task.

No job, provider task, credit ledger entry, payment, invoice, refund,
settlement, or queue entry was created. All dedicated DB rows and both R2
objects (image plus sidecar) were deleted and an authoritative final read found
zero residue. Production deploy identities were unchanged.

No credential value, credential digest, JWT, signed URL, product ID, org ID, or
object key is present in this bundle.
