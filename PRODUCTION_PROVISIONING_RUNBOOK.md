# Production Provisioning Runbook — Infrastructure Only

This runbook is authorized for infrastructure preparation only. It does not
enable live Midtrans, direct real user traffic, remove staging/SQLite, or
delete any data.

## Immutable release

- Repository/ref: `main` at `b60ade73395c62b4fb1ad9aacf5e483029963337` or a
  later explicitly reviewed commit.
- Blueprint: `render.production.yaml`; do **not** sync `render.yaml`, which is
  staging-only.
- Region: Singapore for web, worker, Postgres, and Key Value.

## Paid resources

- Render Postgres `racun-ai-production-postgres`: `basic-256mb`, paid Hobby
  workspace, recovery window 3 days.
- Render Key Value `racun-ai-production-kv`: Starter, `journal-snapshot`,
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
