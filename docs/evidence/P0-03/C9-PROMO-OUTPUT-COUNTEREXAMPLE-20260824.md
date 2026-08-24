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

## Reviewer follow-up: rendered frame proof

Reviewer finding `1787563838000` correctly rejected the input-only boundary
above as proof of rendered output. Code-under-test
`e1e80c052ee7d77339239af09f83eb2b37649289` now lets the actual compositor
finish. A test-only QC seam then extracts a crop at the midpoint calculated
from the compositor's `demoRange` and runs local OCR over that rendered frame.
Production behavior and the default QC runner are unchanged.

- W2 gain: 172,131-byte crop,
  `9d38a479fa934bd74461017fae3fc6957f5db594f7da8339928ee16d17233351`;
  OCR `RpI9°000)> Rp85:000 -147% - s°d:3) Feb`.
- W2 removal: 77,529-byte crop,
  `28991a686325ac29234e0d1d937e84ec94a4387ecaf0f9dd5f5b191fc789321c`;
  OCR `Cuma! Rp&s5:000`; the crop differs and contains no promo separator,
  percent, or deadline.
- W1 E7 change: 260,975-byte crop,
  `13466b394de276bfebaaf3700184fb566c9eeec63a2212b3225faaecbe7d912a`;
  OCR retains before price 98,000, admission price 85,000, discount 13, and
  deadline 3 Feb despite lossy glyph confusion.

The tests still assert the exact compositor strings and admission-bound core
prompt. OCR is treated honestly as lossy corroboration, not as the sole source
of truth; substantive, distinct pixel hashes prove the rendered outputs are
not empty or identical. Stock 7/9 remains absent and semantically inert.

The first aggregate run after adding the PostgreSQL QC seam was **1,090 PASS /
1 fail / 44 skip**. Its only failure was a source guard whose callee regex knew
`runQc|sqliteQcRunner` but not `postgresQcRunner`; the required
`visualSubjectPolicy` was still present in runtime code. Extending that guard
to recognize all three runners yielded a focused **13/13 PASS** and final
exact-code aggregate **1,091 PASS / 0 fail / 44 skip**. Affected tests are
**19/19**, disposable W1 **29/29**, TypeScript/build/catalog PASS, and database
residue zero. The policy boundary is unchanged: C9 remains **PARTIAL** and
canonical readiness remains **58/100**.
