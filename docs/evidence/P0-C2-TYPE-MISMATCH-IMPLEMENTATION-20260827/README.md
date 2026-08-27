# C2 TYPE_MISMATCH implementation — 2026-08-27

Task: `P0-C2-TYPE-MISMATCH-IMPLEMENTATION-20260827`

## Result

C2 is implemented as a fail-closed, provenance-bearing boundary. Product type
is now persisted separately from merchandising category. New and legacy rows
default to `QUARANTINED`; only a version-1 human self-assertion whose normalized
opaque token matches the declaration can move the record to `CONFIRMED`.

The central module exposes only `buildAuthoritativeTypeBoundaryInput` and
`validateAuthoritativeProductType` at runtime. Its capability is identity-bound,
so a frozen structural clone cannot forge a trusted boundary input. Missing or
invalid confirmation returns `PRODUCT_TYPE_CONFIRMATION_REQUIRED`; a different
token returns `TYPE_MISMATCH`; a match executes the protected callback once.

E1/E3/E6/E7 validate before product, image, audit, or extraction effects. A1,
A2, A3, and the A4 locked-cell boundary validate the durable `CONFIRMED` state
before generation, snapshot, job, hold, enqueue, provider, or related writes.
The PostgreSQL migration adds state/shape/equality constraints; SQLite new
schema has equivalent constraints, while additive runtime migration quarantines
existing rows.

Retail and campaign UI require an explicit type plus a separate confirmation
checkbox explaining that the value is the user's own assertion, not staff
verification. No taxonomy, OCR, classifier, promo, deployment, provider,
payment, credit, queue, or production operation is bundled here.

## Verification

- `node scripts/verify-c2-type-mismatch-green.mjs`: 5/5 PASS.
- `SCRIPT_LLM=0 npx tsx --test tests/c2-type-mismatch-implementation.test.ts`:
  4/4 PASS.
- Focused admission/mutation regressions: 43/43 PASS.
- `npx tsc --noEmit`: PASS.
- `npm test`: 1252 tests, 1205 pass, 0 fail, 47 skipped.
- `npm run build`: PASS.
- PostgreSQL schema static verification: PASS.
- Disposable PostgreSQL production-migration runner: not executed because the
  local PostgreSQL readiness check failed before database creation. No
  production database was contacted or mutated.

See `FOUNDER-DECISION.md`, `VALIDATION.json`, and `GATE-TRANSCRIPT.txt` in this
directory for the bounded decision and machine-readable totals.
