# Founder decision — C9 promo snapshot at admission

The Founder approved the safe C9 bundle on 2026-08-27 through canonical task
`P0-C9-PROMO-SNAPSHOT-AT-ADMISSION-20260827`:

- Promo truth is a snapshot at job admission and is never live-read from the
  product row after admission.
- The immutable job product snapshot captures the exact nullable promo
  price-before, ends-at/deadline, and stock/scarcity inputs consumed by the
  runtime.
- A1, A4, PostgreSQL retail admission, and A6 must persist or verify the new
  snapshot before hold, queue, approval, regeneration, or provider effects.
- W1/W2, planner, compositor, QC, output, retry, resume, and regeneration reuse
  the same snapshot bytes. Later promo gain, change, or removal cannot alter a
  job's copy, frame, claim, deadline, or scarcity inputs.
- Explicit null fields preserve the admitted no-promo behavior.
- Jobs missing the new snapshot version are legacy and fail closed without
  replay, fallback, or live-row reconstruction. Classification/remediation is
  reserved for the separately approved legacy-quarantine slice.

This decision does not authorize legacy remediation, promo arithmetic or price
policy redesign, deployment, production mutation, provider calls, payment,
credit, secrets, or replay of completed work.
