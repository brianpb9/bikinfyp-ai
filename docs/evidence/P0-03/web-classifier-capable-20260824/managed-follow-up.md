# Mandatory managed follow-up after exact-SHA PASS

This file is a plan, not authority to mutate Render in the implementation
task. Execute only after Reviewer PASS and a bounded managed-deploy task.

1. Capture sanitized staging web/worker service identity, exact prior deploy
   IDs and full SHAs, `autoDeploy`, suspension, maintenance, job active/queued
   aggregate, health, and production latest deploy IDs/SHAs.
2. Prove the accepted commit and production Blueprint immutability. Publish
   only a staging-scoped ref if the exact commit is absent remotely.
3. Hold staging intake/traffic during any web/worker mismatch. Do not alter
   production intake. Keep staging `autoDeploy=off`.
4. Create explicit foreground deploys at the same accepted exact SHA. Preserve
   the worker's `Dockerfile.worker`; the web build must show `Dockerfile.web`
   and the staging pre-deploy migration must PASS.
5. Require control-plane parity and three sustained HTTP 200 health samples
   with exact `build_sha`, no blocking migration, sandbox/non-live payments,
   and `klasifikasi.mampu=true`, all three binaries true, `bahasaOcr=true`, and
   `smoke=true`. A binary-only result is not sufficient.
6. Run a bounded zero-real-money positive classifier/admission canary without
   a paid media-provider call. Do not enable payments or broaden admission
   policy in this follow-up.
7. On build, migration, parity, health, or smoke failure, keep staging held and
   explicitly redeploy the captured prior web/worker SHAs. Verify final health,
   maintenance restoration, `autoDeploy=off`, database allow-list restoration,
   and production non-mutation.
8. Archive sanitized build/deploy IDs, timestamps, exact SHAs, health, canary,
   rollback target/control path, and limits. Only managed proof may move P0-B2
   from current `incapable` to `capable`.
