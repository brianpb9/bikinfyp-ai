# Production Cutover Proposal — Draft Only

This is a proposal for founder review. It does **not** authorize a production deploy, data deletion, SQLite removal, or enabling live payments.

## Entry criteria

1. Staging web, worker, Render Postgres, Key Value, and private R2 have passed a fresh end-to-end smoke.
2. A genuine Midtrans **sandbox** settlement has produced a valid webhook and exactly one ledger credit.
3. Provider output passes all QC gates, including QC-09, and R2 proxy authorization/range behavior is verified.
4. Production accounts, budget/plan, domains, DNS, monitoring, and incident owner are explicitly approved by the founder.
5. A current SQLite backup and PostgreSQL migration/reconciliation report are retained.

## Proposed production sequence

1. Founder explicitly approves production provisioning and separately approves live Midtrans activation.
2. Create isolated production Render Postgres, Key Value, web, worker, and private R2 bucket. Do not reuse staging credentials.
3. Set production environment variables and run versioned PostgreSQL migrations with checksum verification.
4. If production data exists, run the transactional SQLite-to-PostgreSQL rehearsal/import and verify table counts, balances per user, and FK integrity before traffic.
5. Deploy worker first, verify queue connection and health logs, then deploy web with `RACUN_DB_RUNTIME=postgres`, `RACUN_QUEUE_MODE=redis`, and `STORAGE_MODE=r2`.
6. Run remote production smoke using non-payment paths. Verify authenticated media proxy, worker output, QC, R2 object, and refund behavior.
7. Only after a separate founder confirmation, set `MIDTRANS_IS_PRODUCTION=true` with production Midtrans keys and conduct a controlled live-payment validation.

## SQLite retirement rule

Do not delete or disable SQLite merely because production is deployed. Retire it only after all of the following:

- production has been stable for an agreed observation period;
- database/queue/storage monitoring and backups are operational;
- reconciliation has no discrepancy;
- rollback has been tested on a non-production clone;
- founder explicitly approves removal.

Until then, SQLite code and a read-only backup remain the rollback path. No production process should silently fall back to SQLite: production configuration must fail closed.

## Rollback plan

| Trigger | Action |
|---|---|
| Web/runtime fault | Stop new job intake; roll web back to prior Render deploy; retain Postgres/R2 data for diagnosis. |
| Worker/queue fault | Pause worker, preserve queue and job states, then roll worker back; do not duplicate captures or refunds. |
| Storage fault | Keep R2 private; roll back app release while preserving object keys and metadata. |
| Migration discrepancy | Halt traffic, preserve database snapshot, restore/repair from verified backup; never overwrite ledger history. |
| Payment anomaly | Disable checkout, retain webhook/audit evidence, reconcile ledger before resuming. |

## Explicit non-actions

- No `MIDTRANS_IS_PRODUCTION=true` without a new founder decision.
- No promotion of staging resources to production by renaming.
- No deletion of SQLite, R2 objects, ledger rows, or audit records as part of cutover.
