# Managed staging Duitku parity — 2026-08-24

Task: `P1-MANAGED-STAGING-DUITKU-PARITY-20260824`

Authority: managed staging configuration, deploy, non-money canaries, and rollback preparation only. Production mutation, public production launch, `PAYMENTS_GO_LIVE`, and real-money invoice/pay/refund/settlement were forbidden and were not performed.

## Result

`VERIFIED_MANAGED: PASS`

- Accepted application SHA: `89cfdf0ebf3290aa3b42376a9da194988f6d6db3`.
- Staging-only branch: `staging/exact-89cfdf0-20260824`.
- Web deploy: `dep-da66sk3ncjis73asgu80`, trigger `api`, one intended deploy, terminal `live` at the accepted SHA.
- Worker deploy: `dep-da66slm417fc739h2mf0`, trigger `service_resumed`, one intended deploy, terminal `live` at the accepted SHA.
- Web maintenance was enabled before config/deploy and disabled at `2026-08-24T16:21:02Z` after exact-SHA deploy and pre-release safety probes passed.
- Worker was suspended before config/deploy and resumed once, which created the single intended worker deploy. Final state is `not_suspended`.
- Both staging services remain `autoDeploy=no`.

## Managed payment contract

Observed after an atomic read/merge/write of the staging web environment at `2026-08-24T16:15:45Z`:

| Check | Managed result |
| --- | --- |
| `PAYMENT_GATEWAY` | `duitku` |
| `DUITKU_IS_PRODUCTION` | `false` |
| `PAYMENTS_GO_LIVE` | absent or `false` |
| `APP_BASE_URL` | exact approved staging HTTPS origin |
| Duitku merchant slot | present and nonempty |
| Duitku API-key slot | present and nonempty |
| Local-to-managed merchant equality | true, constant-time in-memory comparison |
| Local-to-managed API-key equality | true, constant-time in-memory comparison |
| Worker Duitku merchant/API slots | both absent |
| Unrelated web env values | preserved exactly |

The managed update changed only the four initially missing/drifted slots: gateway, sandbox flag, merchant code, and API key. No secret value or secret-derived digest was written to this evidence.

## Health and non-money canaries

After maintenance release, three consecutive public health requests returned HTTP 200 and reported:

- `payments_provider=duitku`
- `payments_env=sandbox`
- `payments_live=false`
- `build_sha=89cfdf0ebf3290aa3b42376a9da194988f6d6db3`
- classifier capability `true`

Canaries:

1. Unauthenticated `POST /api/credits/checkout` returned HTTP 401 with `UNAUTHORIZED`.
2. Duitku callback with an invalid signature returned HTTP 401 with `INVALID_SIGNATURE`.
3. Only after managed/local credential equality was proven, a correctly signed callback for unknown order `parity-unknown-20260824-1622` returned HTTP 200 with `ok=true`, `ignored=true`, and no credit.

No invoice was created, paid, refunded, or settled. No authenticated checkout was attempted.

## Queue and database invariants

Queue snapshots before deploy, after deploy, and after canaries all reported zero `wait`, `active`, `delayed`, `prioritized`, and `failed` jobs for both `racun-jobs-staging` and `racun-promo-jobs`.

Tracked database snapshots were identical at baseline, postdeploy, and post-canary:

| Store | Rows | Active / total | Stable row fingerprint |
| --- | ---: | ---: | --- |
| jobs | 74 | active 0 | `a41e0cd975ff0e06e7e68cccf581d6ae` |
| promo_jobs | 15 | active 4 (pre-existing baseline) | `3592f7bf2ab1d34c9df1cb7fce136f78` |
| provider_tasks | 0 | — | `d41d8cd98f00b204e9800998ecf8427e` |
| credit_ledger | 341 | total 2,203,000 | `87247fe22040a2d474b6e31e26f04dd4` |
| payments | 13 | total 1,520,000 | `a5a12d4f3a42178280a36aec385ef3e3` |

For every snapshot, rows created since task start (`2026-08-24T16:08:41Z`) were zero across jobs, promo jobs, provider tasks, credit ledger, and payments. The invalid-signature path intentionally records a rejection audit event; it did not alter any payment or ledger row.

## Production no-touch proof

Production state before and after the staging work remained:

- Web service `srv-d9nhccfqj5pc73et9hrg`: branch `main`, `autoDeploy=yes`, live deploy `dep-da3bfg142hec73arfot0`, SHA `00ee62efd86ae7e10453a2a1896e63b62228aa4d`.
- Worker service `srv-d9ni3ndaeets73c07kq0`: branch `main`, `autoDeploy=yes`, live deploy `dep-da3bfg142hec73arfpfg`, SHA `00ee62efd86ae7e10453a2a1896e63b62228aa4d`.
- `origin/main`: `00ee62efd86ae7e10453a2a1896e63b62228aa4d`.

No production API mutation or Git push to `main` occurred.

## Rollback target (captured, not executed)

Previous known-good staging SHA: `73280ffa342945dc08cee2fc664956975c8d5735`.

Previous web deploy: `dep-da63g43tqb8s739gkasg`. Previous worker deploy: `dep-da64cfbncjis73alvbn0`.

Exact deploy commands, if an authorized staging rollback is later required:

```sh
render deploys create srv-d9n28tijnfac73a87lt0 --commit 73280ffa342945dc08cee2fc664956975c8d5735 --wait --confirm --output json
render deploys create srv-d9n28ue417fc73ch2b60 --commit 73280ffa342945dc08cee2fc664956975c8d5735 --wait --confirm --output json
```

The service branches would first be returned to the prior staging-only branch under maintenance/worker hold. These rollback commands were not run because both exact-SHA deploys passed.

## Evidence classification

- `VERIFIED_MANAGED`: service configuration, env presence/classification/equality result, deploy IDs and terminal states, public health, canary responses, Render one-off queue/DB probes, and production fingerprints.
- `LOCAL`: local sandbox credential slots were read only for nonempty/equality checks and signing the allowed unknown-order callback. Values were never printed or persisted.
- `NOT_RUN`: real invoice creation, payment, refund, settlement, production mutation, and rollback.

One initial read-only DB probe job (`job-da66rfgjo6nc73ei7o2g`) failed because of shell quoting. It made no mutation and was replaced by corrected successful probe `job-da66rrbncjis73aseku0`; the failure is retained here rather than hidden.
