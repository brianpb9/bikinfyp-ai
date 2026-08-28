# Founder decision — C6 OCR fail-closed

The Founder approved the safe C6 bundle on 2026-08-27:

- OCR runtime, infrastructure, timeout, or ambiguous execution failure is
  `OCR_FAILED` (HTTP 503, retryable). It is not evidence that a label was
  inspected and unreadable.
- A completed inspection that determines the label is unreadable is
  `LABEL_UNREADABLE` (HTTP 400, nonretryable).
- E1/E4/E8 fail closed before persistence. E2/E6 extracted media may remain a
  quarantined draft, but may not become an approved reference without exact
  inspection provenance.
- A1–A7 and W1/W2 require versioned, hash-bound readable evidence before spend,
  queue, provider, or deliverable effects. Legacy/missing/stale evidence is
  quarantined; job snapshots preserve immutable reference identity.
- Existing role separation, stale-SHA protection, and Builder/Reviewer bus
  workflow remain unchanged.

This decision does not authorize promo snapshot work, deployment, production
mutation, provider calls, payment, credit, secrets, or replay of completed work.
