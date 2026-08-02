# Production Provisioning Runbook — Infrastructure Only

This runbook is authorized for infrastructure preparation only. It does not
enable live Midtrans, direct real user traffic, remove staging/SQLite, or
delete any data.

## Immutable release

- Repository/ref: `main` at `a575932fee62754fffaa945c6bf4e4a824b9549c` or a
  later explicitly reviewed commit.
- Blueprint: `render.production.yaml`; do **not** sync `render.yaml`, which is
  staging-only.
- Region: Singapore for web, worker, Postgres, and Key Value.

## Paid resources

- Render Postgres `bikinfyp-ai-production-postgres`: `basic-256mb`, paid Hobby
  workspace, recovery window 3 days.
- Render Key Value `bikinfyp-ai-production-kv`: Starter, `journal-snapshot`,
  `noeviction`, empty external IP allow-list.
- Web and worker: separate Starter services, auto-deploy disabled.
- R2: create the private bucket `bikinfyp-production` with distinct scoped
  credentials. Never reuse staging keys or publish the bucket.

## Render secret entry checklist

Enter each secret directly into the matching service after resource creation:

| Secret | Web | Worker |
|---|:---:|:---:|
| R2 endpoint/access key/secret | yes | yes |
| BytePlus API key | yes | yes |
| Resend API key/from address | yes | no |

Do not add Midtrans server/client keys in this phase. Both services must retain
`MIDTRANS_IS_PRODUCTION=false`.

## One-off initial migration

Migrations are never implicit in a web deploy. After the initial web service
is running, open its Render Shell and run the following commands in order:

1. `npm run migrate:postgres-production:dry-run` — retain its checksum/pending
   output; it makes no database writes.
2. Set `RACUN_PRODUCTION_MIGRATION_CONFIRM=APPLY_PRODUCTION_MIGRATIONS` only
   for that Shell command, then run `npm run migrate:postgres-production`.
3. Run `npm run migrate:postgres-production` once more *without* the token.
   It must report `applied: []` and checksum skips.

The approval token must never be placed in this Blueprint or saved as a
production environment variable. A later migration requires the same separate
approval sequence; a normal application deploy never mutates schema.

## PITR reconciliation command

After restoring to a distinct temporary database, run this read-only command
from a controlled Render Shell or other approved private-network execution
context:

`SOURCE_DATABASE_URL=... RESTORED_DATABASE_URL=... npm run verify:postgres-pitr-restore`

It compares public-table counts, `schema_migrations` checksums, derived credit
balances per user (reported only as aggregate mismatch count), and foreign-key
violations. Do not point any production service at the restored clone.

## Required evidence before accepting infrastructure

1. Capture the resource plan, region, privacy, KV policy/persistence, and
   redacted environment configuration.
2. Capture production migration dry-run/checksum and healthy web/worker logs.
3. Run the PITR restore drill to a separate database; retain redacted source vs
   clone reconciliation output.
4. Configure notifications for failed deploy and unhealthy web/worker events,
   then retain an actual event plus recovery evidence.
5. Run `scripts/smoke-production-auth.sh` with the controlled inbox; retain
   response evidence only, never OTP/cookie.
6. Deploy `JOB_INTAKE_MODE=closed` on web only, demonstrate 503 for new jobs,
   preserve worker/queue, then restore `open`.
