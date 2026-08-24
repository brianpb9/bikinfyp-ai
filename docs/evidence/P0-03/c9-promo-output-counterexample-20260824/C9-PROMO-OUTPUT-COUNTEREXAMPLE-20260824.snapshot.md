# C9 promo output counterexample — 2026-08-24

TASK=`P1-C9-PROMO-OUTPUT-COUNTEREXAMPLE-20260824`

Baseline accepted SHA: `2073ba84fe179c9fde82bdd7b27027c4cec88ca3`

Code-under-test SHA: `618ba6355e7a8afd336031db8dadaf6a0dd8b41f`

## Boundary executed

The proof uses the actual production admissions, HTTP mutation handlers,
workers, and `compositeVideo()` entrypoint. A minimal test-only observer is
invoked inside `compositeVideo(input)` before any FFmpeg work. It records the
exact `CompositeInput` and throws a sentinel, so the test observes the real
overlay/compositor contract without rendering media or contacting a provider.
The observer is unset by default and reset after every test.

## Deterministic counterexamples

Retail SQLite E3→W2 executes `POST /api/jobs`, then the authenticated
`PATCH /api/products/[id]`, then `processJob`:

- gain: admission has no promo; E3 writes before=Rp99.000, deadline 3 Feb 2031,
  stock=7, and live sell price Rp72.000. The provider prompt still uses the
  admission name/description. The compositor receives the admission sell price
  Rp85.000 plus live promo, producing `Rp99.000 > Rp85.000` and `-14% · s.d. 3 Feb`;
- removal: admission has before=Rp110.000, deadline 2 Jan 2031, stock=11; E3
  clears all promo fields. The compositor receives `Cuma Rp85.000`.

Organization PostgreSQL executes `renderSatuSel`, authenticated E7
`PATCH /api/dashboard/campaign/product`, first `processPostgresJob`, the actual
A6 scene-approval handler, then resumed `processPostgresJob`. The first worker
persists its scene and stops at `AWAITING_APPROVAL`; the resume reuses that
scene and reaches the compositor. The provider prompt retains admission name,
visual description, and brand brief, while the compositor receives live
before=Rp98.000 and deadline 3 Feb 2031 against admission sell price Rp85.000,
producing `Rp98.000 > Rp85.000` and `-13% · s.d. 3 Feb`.

`promo_stock_left` is mutated and persisted through both real handlers, but it
is semantically inert at this compositor boundary: `formatPromoOverlayText()`
does not format `stockLeft`. The tests assert that stock 7/9 is absent from
`priceText`. This evidence therefore supports live discount/deadline mutation,
not rendered scarcity mutation.

## Scope and decision boundary

No production promo semantics, snapshot schema, reason code, provider, remote
service, or deployment changed. This evidence does not choose whether promo
must become admission-bound. C9 remains **PARTIAL** pending Founder choice:
snapshot promo at admission (Reviewer recommendation), or explicitly declare
promo intentionally live. Canonical shipping readiness remains **58/100**.

Exact-code results: affected **19/19**, disposable W1 **29/29**, full suite
**1,135 total / 1,091 PASS / 0 fail / 44 classified skip**, TypeScript,
production build, and script catalog PASS. The 44 skips are 40 generic-suite
PostgreSQL skips without `UJI_PG_URL` (1 D2, 11 money/reconciler, 28 W1) plus
four unavailable historical QCF1 artifact cases, three also requiring paid
Gemini opt-in. W1 ran separately against disposable loopback PostgreSQL. No
network provider call occurred and database residue was zero.
