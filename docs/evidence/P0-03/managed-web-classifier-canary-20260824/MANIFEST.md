# P0-B2 managed web classifier canary — fail-safe rollback

TASK=`P0-B2-MANAGED-WEB-CLASSIFIER-CANARY-20260824`

Candidate exact SHA: `d2edab0972ea407148138c72f38e67e159748c64`

Attempted deploy: `dep-da62h4ajobas738bkbug`

Result: `build_failed` at `2026-08-24T11:20:48.598666Z`

Rollback deploy: `dep-da62i9ek1f9s738r52r0`

Rollback result: `live` at `2026-08-24T11:26:30.182631Z`

## Result

The staging-only Docker candidate was not promoted. Render built the image far
enough to install ffmpeg and run the Next build, but page-data collection
stopped with `SecretConfigurationError`: `AUTH_SECRET` was unavailable inside
the Docker build context. This is a build/runtime secret-boundary mismatch; it
does not prove the candidate runtime capable.

The service stayed behind maintenance hold throughout the failed attempt. No
positive classifier/admission canary ran, no paid provider was invoked, and no
production resource was mutated.

## Rollback proof

- staging web config restored to `runtime=node`, `branch=main`,
  `autoDeploy=no`, original build/start/pre-deploy commands, and empty health
  path;
- staging web is live at exact prestate SHA
  `4a1d258155b128fee0fcd5a6143198f36a558163`;
- maintenance is disabled after rollback;
- `/api/health` returned `ok=true`, `intake=open`, `payments_env=sandbox`,
  `payments_live=false`, and the exact rollback SHA;
- the restored native runtime truthfully remains classifier-incapable:
  ffmpeg/ffprobe true, tesseract/OCR language/smoke false;
- staging worker remains live at `4a1d258155b128fee0fcd5a6143198f36a558163`;
- production web and worker remain live at
  `00ee62efd86ae7e10453a2a1896e63b62228aa4d`;
- staging database IP allowlist count is zero.

## Gate disposition

`MANAGED_CLASSIFIER_CANARY=FAIL` and `ROLLBACK=PASS`.

P0-B2 remains **VERIFIED_MANAGED: incapable**. A follow-up must provide a
secret-safe Docker build contract (without baking production/runtime secrets
into image layers), then repeat exact-SHA managed build, sustained health, and
zero-money positive canary. This evidence does not authorize production or a
paid provider.
