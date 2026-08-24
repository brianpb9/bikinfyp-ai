# Managed staging exact-SHA evidence — 24 August 2026

TASK=`P0-MANAGED-STAGING-EXACT-SHA-20260824`

TARGET_SHA=`4a1d258155b128fee0fcd5a6143198f36a558163`

EVIDENCE_LEVEL=`VERIFIED_MANAGED` for the bounded claims in this bundle only.
This is not production, payment, legal, incident-response, or shipping approval.

## Outcome

- `racun-ai-staging-worker` deploy `dep-da61n0qjobas73894nfg`: `live` at the
  exact target SHA, finished `2026-08-24T10:25:52.593457Z`.
- `racun-ai-staging-web` deploy `dep-da61oebl550s73864vsg`: `live` at the exact
  target SHA, finished `2026-08-24T10:31:11.705401Z`.
- Both staging services remained `autoDeploy=no`, unsuspended. Web maintenance
  was enabled during the mismatch window and restored to `false` afterward.
- The staging Postgres allow-list was empty before access. Every temporary
  `/32` window was protected by an exit/signal cleanup trap and independently
  observed at length zero afterward. No CIDR is stored in this bundle.
- Production web and worker remained on
  `00ee62efd86ae7e10453a2a1896e63b62228aa4d`; no production deploy was created.

## Files and provenance

| File | Source | Sanitization |
|---|---|---|
| `baseline.json` | allowlisted fields from `render services` and latest `render deploys list` before mutation | IDs, names, deploy IDs, SHAs, lifecycle flags/times only |
| `control-plane-final.json` | same Render commands after completion | same allow-list; includes production latest deploy solely to prove no change |
| `health.json` | `GET /api/health` after parity plus three sustained samples | only documented public health fields; no headers/cookies |
| `database.txt` | aggregate `BEGIN READ ONLY` queries through temporary staging-only allow-list | counts, safe states, migration IDs/invariants; no rows or customer fields |
| `smoke.txt` | staging dev-login cookie held only in a temporary directory; authenticated GETs and deliberately missing-script admission | HTTP/result shape only; phone, cookie, user ID, and message text omitted |
| `runtime-logs.txt` | allowlisted Render log messages/counts after deploy | worker startup lines, migration result, provider/failure aggregate only |
| `rollback.md` | captured prior deploys and exact explicit deploy command path | no execution claimed; rollback was not needed |
| `commands.txt` | reproducible command classes, UTC/exit status | secrets/CIDR/cookies/phone/connection strings omitted |
| `SHA256SUMS` | local SHA-256 over bundle payload files, excluding this manifest and checksum file | integrity metadata only |

## Security and money boundary

- No paid provider call was made. Worker log scan in the observed window found
  zero provider activity and zero worker failure events.
- The synthetic authenticated user had one staging bonus ledger row and zero
  `hold`/`capture`/`regen` rows. The deliberate admission returned `404
  NOT_FOUND`, and job count remained zero for that identity.
- `payments_env=sandbox` and `payments_live=false` in every health sample.
- No production config, intake, deploy, database, or payment state was changed.

## Material managed finding

The web runtime is not classifier-capable: ffmpeg and ffprobe execute, but
tesseract does not; OCR language and smoke are false. This proves P0-B2's
runtime question, but the answer is negative. Upload evidence produced at the
web boundary will honestly remain `belum_diperiksa` pending a capable boundary.

## Limits

- No valid-product render was admitted: the configured video provider is not a
  free stub, so the canary deliberately stopped at a no-provider admission
  boundary.
- The database half of legacy audit access is now proven, but no paired R2
  access was available; no legacy media verdict or B3 population claim is made.
- Rollback readiness is proven by captured exact targets and accepted explicit
  command path, not by performing a rollback drill.
- Production/public launch and real money remain HOLD.
