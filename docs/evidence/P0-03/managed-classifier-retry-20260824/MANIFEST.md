# P0-B2 managed classifier retry — capable exact-SHA staging runtime

TASK=`P0-B2-MANAGED-CLASSIFIER-RETRY-20260824`

Accepted product SHA: `73280ffa342945dc08cee2fc664956975c8d5735`

Staging web deploy: `dep-da63g43tqb8s739gkasg`

Result: `live` at `2026-08-24T12:29:08.256059Z`

## Outcome

`MANAGED_DOCKER_BUILD=PASS`, `EXACT_SHA_WEB_WORKER_LIVE=PASS`,
`MANAGED_CLASSIFIER_SMOKE=PASS`, `CONTROLLED_PARITY_WINDOW=PASS`, and
`FINAL_CONTROL_STATE=PASS`.

The original task-window aggregate was insufficient and is explicitly
**UNPROVEN**: it did not fingerprint pre-existing rows or every ledger/payment
mutation. It is retained as historical evidence, but it is not the basis for
the final safety verdict. Reviewer remediation ultimately established a
retained canonical window using complete-table fingerprints and queue probes
from before worker resume/deploy through immediate and sustained post-deploy
observations. Only the `canonical-*` replay is the basis for the final safety
verdict.

Staging web and worker are live on the accepted exact SHA. Web uses `runtime=docker`,
`Dockerfile.web`, context `.`, `/api/health`, branch
`staging/exact-73280ff-20260824`, `autoDeploy=no`, and maintenance disabled.
Worker uses the same exact staging branch, `runtime=docker`, context `.`,
`Dockerfile.worker`, and `autoDeploy=no`. Its original explicit parity deploy
is `dep-da63u33bc2fs73as12j0` (`trigger=api`); the final retained replay deploy
is `dep-da64cfbncjis73alvbn0` (`trigger=service_resumed`), also live on the
exact accepted SHA.
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

The initial execution mutations were:

1. add the operator's single `/32` to the staging database allowlist;
2. push the accepted SHA to a staging-only Git ref;
3. enable staging-web maintenance;
4. update staging web only to the approved Docker configuration;
5. trigger the explicit accepted-SHA staging-web deploy;
6. disable maintenance after the candidate was live and Render's configured
   HTTP health gate had passed; and
7. clear the temporary database allowlist entry.

The first remediation (historical, not the final proof window) then:

1. re-enabled web maintenance and proved external HTTP 503;
2. pointed the staging worker at the same staging-only exact-SHA branch while
   retaining `Dockerfile.worker` and `autoDeploy=no`;
3. temporarily restored the operator's single `/32` database allowlist;
4. suspended the worker after the complete baseline found four non-terminal
   legacy promo rows;
5. proved both BullMQ queues had zero waiting, active, delayed, prioritized,
   and failed entries, so those legacy rows were neither queued nor in flight;
6. resumed the worker and allowed the exact-branch resume deploy to settle;
7. issued one explicit exact-SHA worker deploy and retained its terminal live
   record and queue-startup log;
8. compared complete fingerprints over a sustained controlled window;
9. cleared and read back the temporary database allowlist; and
10. disabled maintenance only after web/worker parity and safety checks passed.

The initial database aggregate command was retained as a failed observation:
the operator IP was not allowlisted. The `/32` was then added and read back,
the zero aggregate was captured before application mutation, and the final
aggregate remained identical before the allowlist was restored to its empty
prestate. Those narrow aggregates are not sufficient to prove the old
zero-money claim and are superseded for the final verdict.

The final canonical replay fingerprinted every row of `jobs`, `promo_jobs`,
`provider_tasks`, `credit_ledger` (all types), and `payments` (including status
and payload fields) at `2026-08-24T13:24:13Z` while worker was suspended, at
`13:26:46Z` immediately after exact-SHA deploy `dep-da64cfbncjis73alvbn0`
became live, and at `13:28:05Z` after a sustained wait. Normalized snapshots
match exactly. Counts, total costs, ledger delta, payment amount, and all
fingerprints remained identical; no row was created in the window. Jobs had
zero active/queued rows. Four legacy promo rows remained non-terminal but
unchanged. Separate retained queue probes before resume while suspended,
immediately post-deploy, and after the sustained wait prove both queues had
zero waiting, active, delayed, prioritized, or failed work at every boundary.

The maintenance sampler began before hold and retained 38 observations from
`2026-08-24T12:24:13.624Z` through `2026-08-24T12:33:39.675Z`. It observed
pre-hold HTTP 200, maintenance enabled with HTTP 503 throughout the rollout,
and maintenance disabled with stable HTTP 200 afterward. The first external
probe immediately after disable raced control-plane propagation and still saw
503; the retained retry and two later probes saw stable 200 with the identical
health-body hash. Sampling is periodic, not continuous packet capture; the
ledger gives the separate mutation timestamps.

During the first remediation, maintenance was re-enabled at
`2026-08-24T12:47:34Z` and direct public health returned HTTP 503. It was
disabled only after the explicit worker deploy, empty-queue proof, complete
fingerprint parity, and database allowlist restoration. Three final probes
Three interim probes from `2026-08-24T12:59:39Z` through
`2026-08-24T13:01:14Z` all returned HTTP
200 with the identical health-body SHA-256 and exact accepted build SHA.

The final canonical replay enabled maintenance at `2026-08-24T13:23:34Z`,
polled external health from HTTP 200 to HTTP 503, separately retained that 503
at `13:23:37Z`, and only then suspended worker and captured the baseline. A
second 503 at `13:29:26Z` proves the hold remained through the complete
pre/post/sustained fingerprint and queue comparisons. After database allowlist
restoration, maintenance release returned HTTP 200 at `13:29:34Z` and
sustained identical HTTP 200 at `13:30:12Z`.

Staging worker service/config now intentionally matches web at the accepted
exact SHA while preserving its Docker worker contract. The worker startup log
shows both `racun-jobs-staging` and `racun-promo-jobs` consumers, and the
post-deploy read-only queue probe shows zero work in both queues.
Production web and worker allowlisted service API objects were read back after
the canonical replay at `2026-08-24T13:29Z`. Their complete allowlisted `response`
objects—including branch, runtime, commands, suspension, maintenance, and
auto-deploy state—are byte-equivalent to the pre-task baselines. Their latest
deploy records are unchanged. Origin `main` stayed at
`00ee62efd86ae7e10453a2a1896e63b62228aa4d`.

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
zero-provider-task, and zero-money statement only narrowly and are retained as
**unproven**. The final safety claim is instead limited to the controlled
full-fingerprint parity window and empty-queue observations described above;
it is not a claim about unrelated actors outside that window.

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
- staging worker: live exact accepted SHA, Dockerfile.worker retained,
  `autoDeploy=no`, queue startup observed;
- staging database: 35/35 migrations and empty IP allowlist;
- production web/worker: unchanged at
  `00ee62efd86ae7e10453a2a1896e63b62228aa4d`;
- real money, paid provider work, production deploy/config, and `main`: not
  mutated.

P0-B2 runtime classification is now **VERIFIED_MANAGED: capable** for this
staging exact SHA. This does not authorize production rollout or real money.
