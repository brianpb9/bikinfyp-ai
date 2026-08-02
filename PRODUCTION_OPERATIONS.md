# Production Operations Baseline — Preparation Only

This is a preparation document. It does not provision, deploy, alter Render accounts, or enable Midtrans live. The current blueprint remains staging-only.

## Observed controls

- `render.yaml` declares web health check `/api/health`; the endpoint returns `503` for invalid queue/runtime/storage configuration and exposes no secrets.
- `JOB_INTAKE_MODE=closed` rejects new `POST /api/jobs` with `503 JOB_INTAKE_PAUSED` before auth, DB, holds, or enqueue. Existing jobs stay available to drain.
- Staging Key Value has `noeviction` but `persistenceMode: off`; this is not acceptable for production queue durability.

## Required production configuration

| Concern | Required setting | Evidence | Current status |
|---|---|---|---|
| Postgres recovery | Paid Render Postgres with PITR. Make a logical export and test a PITR restore into a **new** database. | Recovery window, restore timestamp, schema/count/balance/FK report. | Not provisioned; cannot activate. |
| Queue durability | Paid Key Value, `noeviction`, `journal-snapshot`, private networking, internal auth after authenticated URLs are wired. | Settings and worker reconnect/drain log. | Not provisioned; cannot activate. |
| Web/worker down | Enable Render email/Slack failure notifications for both production services; configure `/api/health`; name incident owner. | Destination and test event. | No account access/owner supplied; not activated. |
| Error/stuck jobs | Install approved alert destination and monitor for elevated 5xx plus jobs exceeding per-state timeout. | Rule, threshold, owner, test alert. | No production telemetry/destination; not activated. |

Render sources reviewed 2 Aug 2026: paid Postgres has PITR (Hobby 3 days; Pro+ 7) and restores into a new instance; free DBs lack recovery. Paid Key Value supports `journal-snapshot` (up to roughly one second of writes can be lost), and Render recommends `noeviction` for queues. Render notifications include unhealthy services and failed deploys; Metrics provides web HTTP/CPU/memory graphs. [Postgres recovery](https://render.com/docs/postgresql-backups), [Key Value](https://render.com/docs/key-value), [notifications](https://render.com/docs/notifications), [metrics](https://render.com/docs/service-metrics).

## Backup/restore proof runbook

1. In Dashboard → database → Recovery, confirm paid-instance PITR and record the window.
2. Create an export; restore a point at least ten minutes old to a **new isolated** database. Do not change application URLs.
3. Run migration checksum, schema/table counts, per-user ledger balances, and FK checks on the clone. Retain redacted output.
4. Only after match is proven may the clone be discarded. Production remains untouched.

## Freeze/drain runbook

1. Set only web `JOB_INTAKE_MODE=closed` and deploy that configuration; verify a new job gets `503 JOB_INTAKE_PAUSED`.
2. Keep worker/Key Value up; observe jobs until finished, refunded, or state-timeout.
3. For worker faults, preserve queue/job IDs and logs before pause/rollback. Never manually replay captures/refunds.
4. Reopen with `JOB_INTAKE_MODE=open`, deploy web, then run a non-payment canary job.

## RPO/RTO: conditional targets, not claims

Proposed targets are **RPO ≤ 1 hour** and **RTO ≤ 2 hours** only after paid plan, timed restore drill, durable Key Value, alerts, and incident owner are evidenced. Until then, RPO/RTO are **unproven**. Key Value does not replace Postgres as ledger of record.

## Production-realistic auth smoke

The unit proof uses `NODE_ENV=production`, `ALLOW_DEV_LOGIN=0`, no Resend credential, and `PROVIDER_VIDEO=byteplus`: dev login is denied, mock OTP is refused, and the provider registry has no mock fallback. A genuine email OTP was **not sent**: this workspace lacks an isolated HTTPS deployment, controlled test inbox, and production-equivalent Resend credential. This is the exact external blocker; no mock was substituted.

When those prerequisites exist, run `BASE_URL=https://<production-web> TEST_EMAIL=<controlled inbox> OTP_CODE=<inbox code> bash scripts/smoke-production-auth.sh`. It requires response `mode=live`, `email_live=true`, no `dev_hint`, then verifies the receipt outside logs. Its retained files never include the OTP or cookie. Do not test payments.
