# P1 ship-readiness reconciliation — 2026-08-24

Task: `P1-SHIP-READINESS-RECONCILE-20260824`

Baseline: `0fa86ca60882fed1ff6881bfb028e53e2a1124a9`

Result: `SHIPPING_READINESS=58/100`, public paid/private beta `HOLD`.

This docs/evidence-only reconciliation uses the existing 13-row board rubric.
It adds no weight, policy, owner, price, COGS, legacy treatment, promo behavior,
OCR behavior, or production authority.

## Current accepted delta

- C8 A1–A7/new admission: accepted `d49c973...`.
- E1 every-upload/reference/rollback gate: accepted `da34ba9...`.
- C3 explicit W1/W2 brand mismatch: accepted `8a37f2e...`.
- Duitku HMAC sandbox code/local matrix: accepted app `89cfdf0...`; external
  POP status reconciliation remains HTTP 404/HOLD.
- Managed staging parity: evidence `0fa86ca...`, app `89cfdf0...`, exact
  web+worker live, classifier capable, Duitku sandbox/live=false, non-money
  canaries and DB/queue invariants accepted.

## Why the score does not move

The source board still has 13 rows totaling 77/130, normalized to 59.23. The
existing R2A evidence ceiling remains 58. Closing bounded technical slices does
not manufacture the missing valid-product exact-tree E2E, legacy paired audit,
C9/C12 aggregate closure, OCR/promo/legacy policy, known-order payment status
reconciliation, production release control, legal, incident/DR, owners, price,
or go-live authority.

## Counterexample-sensitive checks

- A parser that accepted only one-letter evidence tiers omitted the `V/C` row
  and produced 12 rows / 70. The corrected parser explicitly accepts `V/C` and
  proves 13 rows / 77. This guards against a plausible false score.
- Exact PASS and DONE messages are required for each new accepted task; a
  READY or local test claim is not counted.
- Managed parity is checked against four independent receipt types: service
  deploy, health, DB/queue, and exact canary response shapes.
- The score remains held by concrete negative controls: Duitku status 404/HOLD,
  production `autoDeploy=yes`, and code/tests preserving the current null/OCR
  fail-open behavior while only explicit mismatch rejects.

## Evidence classification

- `VERIFIED_REPOSITORY`: exact source-board arithmetic, Git ancestry, archived
  PASS/DONE, immutable receipt parsing, links, JSON, checksums, and diff checks.
- `VERIFIED_MANAGED_FROM_ACCEPTED_RECEIPTS`: exact staging deploy/health/data/
  canary facts already accepted at `0fa86ca...`; this task made no remote call.
- `HISTORICAL`: E.25–E.27 deployment/classifier snapshots, now labeled and
  superseded by E.28/E.33.
- `NOT_RUN`: remote mutation, provider call, paid call, full regression, deploy,
  production action, real invoice/payment/refund/settlement.

Full regression was not rerun because this slice changes Markdown/JSON evidence
only. Dependency-free receipt, link, checksum, ancestry, score, and secret
checks are proportionate and are recorded in this directory.
