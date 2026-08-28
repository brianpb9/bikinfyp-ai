# C6 OCR fail-closed before spend — 2026-08-27

Task: `P0-C6-OCR-FAIL-CLOSED-BEFORE-SPEND-20260827`

## Result

C6 is implemented as a versioned tri-state contract. Runtime OCR failure is
canonical `OCR_FAILED` (503/retryable), distinct from inspected but unreadable
`LABEL_UNREADABLE` (400/nonretryable).

E1/E4/E8 normalize every new image first, inspect the exact WebP bytes before
storage or database/audit effects, and persist that verdict in the sidecar.
An opaque in-memory batch prevents attaching upload-byte evidence to different
stored/provider-bound bytes. E2/E6 extraction without inspection
is retained only as quarantined draft evidence. Product truth approves only a
hash-valid image carrying `READABLE` version 1.

A1–A7 validate that evidence under the existing product lease before protected
effects. Reference manifest version 2 copies OCR provenance into the immutable
job snapshot. W1/W2 load the manifest before provider work; trusted-brand OCR
at the worker boundary also preserves the canonical failure distinction.

Legacy/missing/stale/forged/failed OCR evidence fails closed. No `.agent-bus`
history was reset, no completed work replayed, and no deployment, production
database, provider, payment, credit, queue, or secret operation was performed.

## Verification

- C6 focused suite: 7/7 PASS, including inspected SHA = stored SHA = sidecar SHA
  = immutable manifest SHA while the original upload SHA differs.
- Affected remediation regression: 32 tests, 31 pass, 0 fail, 1 environment skip.
- `npx tsc --noEmit`: PASS.
- `npm test`: 1266 tests, 1218 pass, 0 fail, 48 skipped.
- `npm run build`: PASS.
- Disposable loopback PostgreSQL production-migration runner: PASS.

See `FOUNDER-DECISION.md`, `VALIDATION.json`, and `GATE-TRANSCRIPT.txt`.
