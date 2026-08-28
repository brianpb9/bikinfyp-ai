# SCORE-80 deterministic NSFW zero-spend evidence

This bounded lane is authorized by Founder task `1787854482000-reviewer-TASK`.
It centralizes the provider-content-rejection classifier used by the read-only
KPI report, formalizes per-format threshold calculation, and exercises the
real SQLite `failJob`/append-only credit release lifecycle with a deterministic
content-rejection reason.

The fixture makes no provider call, records `cost_actual_idr=0`, creates no
invoice, and performs no production or public mutation. It proves classifier,
KPI, and refund behavior only. It is not a representative production sample
and must not award SCORE-80 points without an independent exact-SHA PASS and
the additional production evidence required by the canonical score matrix.

Verification:

```sh
npx tsx --test tests/laporan-nsfw-pola.test.ts tests/nsfw-zero-spend-evidence.test.ts
node docs/evidence/SCORE80-NSFW-ZERO-SPEND-EVIDENCE-20260828/verify.mjs
```
