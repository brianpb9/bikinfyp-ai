# P0-B2 managed classifier retry — capable exact-SHA staging runtime

TASK=`P0-B2-MANAGED-CLASSIFIER-RETRY-20260824`

Accepted product SHA: `73280ffa342945dc08cee2fc664956975c8d5735`

Staging web deploy: `dep-da63g43tqb8s739gkasg`

Result: `live` at `2026-08-24T12:29:08.256059Z`

## Outcome

`MANAGED_DOCKER_BUILD=PASS`, `EXACT_SHA_LIVE=PASS`,
`MANAGED_CLASSIFIER_SMOKE=PASS`, `ZERO_MONEY_WINDOW=PASS`, and
`FINAL_CONTROL_STATE=PASS`.

Staging web is live on the accepted exact SHA using `runtime=docker`,
`Dockerfile.web`, context `.`, `/api/health`, branch
`staging/exact-73280ff-20260824`, `autoDeploy=no`, and maintenance disabled.
The managed health body repeatedly reports:

- `build_sha=73280ffa342945dc08cee2fc664956975c8d5735`;
- `payments_env=sandbox` and `payments_live=false`;
- `klasifikasi.mampu=true`;
- ffmpeg, ffprobe, and tesseract all executable;
- OCR language data present; and
- the production classifier pipeline smoke passed.

The build/runtime log shows the Docker runtime stage installing the three
binaries and `tesseract-ocr-eng`, the exact `Dockerfile.web` runtime contract,
root instrumentation copied into the Next build, the 0035 migration asset,
successful pre-deploy migration, Next startup, and `Ready`. The live health
body proves the secret-validating startup boundary reached a healthy runtime
without any secret value being printed or stored.

## Safety window and mutations

The only external mutations were:

1. add the operator's single `/32` to the staging database allowlist;
2. push the accepted SHA to a staging-only Git ref;
3. enable staging-web maintenance;
4. update staging web only to the approved Docker configuration;
5. trigger the explicit accepted-SHA staging-web deploy;
6. disable maintenance after the candidate was live and Render's configured
   HTTP health gate had passed; and
7. clear the temporary database allowlist entry.

The initial database aggregate command was retained as a failed observation:
the operator IP was not allowlisted. The `/32` was then added and read back,
the zero aggregate was captured before application mutation, and the final
aggregate remained identical before the allowlist was restored to its empty
prestate. Both task-window aggregates report zero jobs, provider tasks, promo
jobs, job/promo cost, credit mutations, payments, and payment amount.

The maintenance sampler began before hold and retained 38 observations from
`2026-08-24T12:24:13.624Z` through `2026-08-24T12:33:39.675Z`. It observed
pre-hold HTTP 200, maintenance enabled with HTTP 503 throughout the rollout,
and maintenance disabled with stable HTTP 200 afterward. The first external
probe immediately after disable raced control-plane propagation and still saw
503; the retained retry and two later probes saw stable 200 with the identical
health-body hash. Sampling is periodic, not continuous packet capture; the
ledger gives the separate mutation timestamps.

Staging worker service/config/deploy identity is byte-equivalent before/after.
Production web and worker allowlisted service objects are equivalent
before/after, and their latest-deploy artifacts are byte-identical. Origin
`main` stayed at `00ee62efd86ae7e10453a2a1896e63b62228aa4d`.

## Canary disposition

The positive managed canary is the existing classifier capability smoke invoked
by `/api/health`. It runs the production `klasifikasiGambar` path against the
committed 1440x180 text fixture
`assets/probe/probe-teks.png` (SHA-256
`2bfb611aa6c40f25a47aff1b3826c33327ceb3214ac05bfba738fcf70c40277d`),
requires real OCR words and a non-fallback ffprobe-derived text-area ratio, and
returned `smoke=true` / `mampu=true` in the managed image.

`SAFE_ADMISSION_CANARY=NOT_RUN`. Route inventory found no dedicated safe,
unauthenticated, no-provider admission-only endpoint. Creating a paid/provider
job or manufacturing an admission result was forbidden and unnecessary because
the approved acceptance explicitly permits the managed classifier smoke as the
minimum positive path. The task-window database aggregates scope the zero-job,
zero-provider-task, and zero-money statement to this window; they are not a
claim about unrelated actors outside it.

Two read-only private-health SSH attempts are retained as failures: the current
operator session had no accepted SSH public key. They caused no mutation and do
not weaken the direct managed health result.

## Evidence verification

- append-only command-ledger artifact hashes: PASS;
- committed JSON parse: PASS;
- evidence sanitization guard: PASS;
- shell/Node helper syntax: PASS;
- `npm run test:web-container`: 36/36 PASS;
- `npx tsc --noEmit`: PASS; and
- `git diff --check`: PASS.

The already accepted product SHA retains its prior full 1,187-test proof. This
managed task changed only evidence/canonical state and generic capture helpers;
it did not alter the accepted application runtime.

## Final state

- staging web: live exact accepted SHA, Docker classifier-capable, maintenance
  off, `autoDeploy=no`;
- staging worker: unchanged at
  `4a1d258155b128fee0fcd5a6143198f36a558163`;
- staging database: 35/35 migrations and empty IP allowlist;
- production web/worker: unchanged at
  `00ee62efd86ae7e10453a2a1896e63b62228aa4d`;
- real money, paid provider work, production deploy/config, and `main`: not
  mutated.

P0-B2 runtime classification is now **VERIFIED_MANAGED: capable** for this
staging exact SHA. This does not authorize production rollout or real money.
