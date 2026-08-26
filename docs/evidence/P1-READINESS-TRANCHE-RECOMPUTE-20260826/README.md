# P1 readiness tranche recompute — 2026-08-26

Task: `P1-READINESS-TRANCHE-RECOMPUTE-20260826`

Result: `SHIPPING_READINESS=58/100`; public paid/private beta `HOLD`.

This docs/evidence-only slice recomputes the existing 13-row board rubric. It
adds no weight and does not promote managed staging, an accepted non-ancestor
onboarding branch, or agent-bus reliability into production/product points.

Files:

- [`../SHIP-READINESS-CANONICAL-20260826.md`](../SHIP-READINESS-CANONICAL-20260826.md): current decision and gate split;
- [`SCORE-RECEIPT.json`](SCORE-RECEIPT.json): machine ledger and counterexample;
- [`BUS-SOURCE-MESSAGES.json`](BUS-SOURCE-MESSAGES.json): committed sanitized immutable PASS/DONE projections;
- [`verify.mjs`](verify.mjs): dependency-free omission/double-count/receipt validator;
- [`VALIDATION.json`](VALIDATION.json): final verification result;
- `MANIFEST.sha256`: checksums of immutable bundle inputs.

No remote call, deploy, provider/payment action, production action, policy
decision, secret mutation, product-code edit, or full regression was performed.
The live `.agent-bus/archive` is intentionally absent from an immutable review
tree. `verify.mjs` therefore validates the committed projections themselves and
reports runtime-archive recomparison as unavailable; it does not claim a check
that exact-tree reviewers cannot reproduce.
