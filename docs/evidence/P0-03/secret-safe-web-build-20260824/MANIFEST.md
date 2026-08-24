# P0-B2 secret-safe web build boundary

TASK=`P0-B2-SECRET-SAFE-WEB-BUILD-20260824`

Baseline accepted SHA: `4f5eb05c109817ffa8f41bff819c1eccce22ba05`

## Implemented boundary

- `lib/config.ts` no longer validates or snapshots `AUTH_SECRET` at module
  import, so Next route discovery and page-data collection are secret-free.
- Root `instrumentation.ts` lazily imports the narrow Node runtime assertion
  from the server registration hook. Importing config, instrumentation, and the
  formerly failing `/api/promo/jobs` route succeeds in secretless production.
- Missing, development-default, and sub-32-byte secrets are still rejected by
  Node registration. A valid 32-byte secret is accepted.
- Every JWT/OTP/signing-key consumer now reads and validates the current
  runtime value. Valid rotation changes the key; deletion or shortening after
  import fails closed instead of falling back or using a frozen value.
- `Dockerfile.web` copies the instrumentation source but contains no
  `AUTH_SECRET`, secret ARG/ENV, database URL, provider key, or dummy secret.
  The static contract rejects those directives and rejects omission of any
  instrumentation/runtime assertion link.
- `.dockerignore` continues to exclude `.env*`, bootstrap/runtime state, and
  evidence from the build context. `render.production.yaml` was not modified.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| secret/auth/runtime/container targeted suite | 61/61 PASS |
| runtime+secret+container focused suite | 50/50 PASS |
| full `npm test` | 1,179 total; 1,135 PASS; 0 fail; 44 classified skip |
| secretless `npm run build` with AUTH_SECRET, DATABASE_URL, and provider keys removed | PASS |
| `npm run test:web-container` | 36/36 PASS; static contract PASS |
| Docker image execution | unavailable locally; not claimed |
| `render blueprints validate render.yaml` | PASS, valid=true, 4 actions |
| production Blueprint static byte-drift contract | PASS |
| `render blueprints validate render.production.yaml` | external control-plane validation reports existing `cannot downgrade Postgres major version`; file unchanged |
| built `next start` with empty AUTH_SECRET | instrumentation rejects; `/api/health` returned HTTP 500, never healthy; process terminated manually |

For the final secretless proof, `.env.local` was moved to a fixed temporary
name under an EXIT/signal restoration trap, the named process variables were
unset, and the file was restored with an identical SHA-256 afterward. Next's
build output listed no environment file. No secret value was read or printed,
and no real/dummy secret was passed as ARG, ENV, mount, or source value.

## Scope and remaining gate

This is reviewed-code/local proof only. No git ref was pushed and no Render
service/config/deploy, database, provider, payment, or production resource was
mutated. P0-B2 remains **VERIFIED_MANAGED: incapable** until the accepted exact
SHA is rebuilt in managed staging and proves sustained `mampu=true` plus a
zero-money positive canary. That repeat must preserve contemporaneous raw
per-command/control-plane evidence; this task does not repair the prior
attempt's incomplete interval-level proof.
