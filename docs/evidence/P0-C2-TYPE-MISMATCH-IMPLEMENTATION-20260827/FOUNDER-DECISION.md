# Founder decision — C2 authoritative product type

The Founder approved the recommended safe release bundle for C2 on
2026-08-27.

- Canonical product type is a versioned opaque token distinct from the existing
  merchandising `category`; this slice does not define a taxonomy list.
- The second provenance input is an explicit human confirmation with actor,
  timestamp, version, and `USER_SELF_ASSERTION` provenance. It is not staff,
  catalogue, classifier, or legal verification.
- Comparison normalization is limited to Unicode NFKC, trim, and case folding.
- Missing, ambiguous, existing legacy, or otherwise unconfirmed records may
  persist only as `QUARANTINED` drafts. They fail closed before admission,
  provider work, spend, hold, or enqueue.
- A mismatch rejects with canonical code `TYPE_MISMATCH` before E1/E3/E6/E7
  persistence and A1–A4 effects. A matching confirmation admits its protected
  callback exactly once.
- The decision boundary and provenance must be durable in schema/migrations and
  visible through API, audit, and user confirmation UI.

Explicitly excluded from this implementation slice: OCR fail-closed policy,
promo snapshot policy, broader legacy remediation, owner/legal/price decisions,
production deployment, provider calls, payment, credit, and production data
mutation. Those remain separately bounded work.
