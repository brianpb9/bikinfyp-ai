# P0-C10 Legacy Job Quarantine — Direct Evidence

TASK=`P0-C10-LEGACY-JOB-QUARANTINE-20260827`

BASELINE=`7475ddb3ccbfe6390ec79dda789d3f2d9325ca3d`

## Verified gates

- `npx tsc --noEmit` — PASS.
- Focused classifier, W1 deterministic/provider fixture, and W2 runtime
  controls — PASS (real-PG cases explicitly skipped without a local server).
- `npm test` — 1264 total, 1220 pass, 0 fail, 44 skipped.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- Production symbol/static guard: no worker-time
  `loadOrCreateJobReferenceManifest`, `installReferenceManifestIfSafe`, or W1
  `product_images` selection — PASS.

Reviewer remediation also binds current W1 fixtures to admission-owned
manifest bytes, retains explicit null legacy jobs, removes obsolete canary and
mutable source-path assertions, adds a provider-branch product-type quarantine
case, and verifies typed legacy/product-type reasons survive worker audit
serialization.

## PostgreSQL availability

`bash scripts/test-postgres-product-truth-w1.sh` stopped at its guarded local
readiness check. `localhost:54329` refused connections and Docker is not
installed. No remote database was contacted and no PostgreSQL PASS is claimed.

## Scope boundary

This evidence records local code and test proof only. It does not claim a
production population audit, backfill, deploy, replay, provider call, payment,
credit mutation, or new policy decision.
