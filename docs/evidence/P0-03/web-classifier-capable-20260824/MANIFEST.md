# Staging web classifier-capable runtime candidate — 24 August 2026

TASK=`P0-B2-WEB-CLASSIFIER-CAPABLE-20260824`

BASELINE=`c3c99fcb004975c629758353c63f072fabf3c225`

EVIDENCE_LEVEL=`LOCAL_IMPLEMENTATION_PENDING_REVIEW`

## Outcome

- `Dockerfile.web` defines a reproducible multi-stage Next web image on Debian,
  installs ffmpeg/ffprobe, tesseract, and English OCR data, and copies the real
  classifier probe asset.
- Runtime drops to UID/GID 10001, carries the Next runtime, public and
  process-relative assets, staging migration runner/migrations, and owns the
  writable `.next/cache`, `storage/jobs`, and `storage/uploads` paths.
- `render.yaml` binds only `racun-ai-staging-web` to `Dockerfile.web`; the
  staging worker remains on `Dockerfile.worker`, health/pre-deploy/auto-deploy
  contracts remain present, and Render Blueprint validation returns valid.
- Validation initially exposed the pre-existing unsupported `diskSizeGB` field
  on the Free staging Postgres plan. The declaration was removed; database
  identity/plan/version/wiring are unchanged and no Blueprint was applied.
- `render.production.yaml` SHA-256 remains the accepted baseline
  `3b1a33a4e4556717481d10e2dbe7a6ff9982bd7ce41b3ec0b92013f19b3710f7`.

## Evidence files

| File | Purpose |
|---|---|
| `verification.txt` | exact command outcomes and test totals |
| `managed-follow-up.md` | mandatory post-PASS staging build/probe and rollback plan |
| `SHA256SUMS` | integrity hashes for the two payload files |

## Limits

- No local Docker/Podman engine was available. Static and mutation-sensitive
  contract tests passed, but no local image build or container execution is
  claimed.
- No ref was pushed and no Render service, deploy, config, database, intake,
  payment, provider, staging, or production state was mutated.
- Current managed staging truth remains `klasifikasi.mampu=false` on deployed
  product SHA `4a1d258...` until a separately reviewed managed deployment proves
  the new image builds and the real health smoke reports capable.
- Classification thresholds, OCR fail-open behavior, reason codes, promo,
  price, payment, owner, production configuration, and readiness **58/100** are
  unchanged.
