# Post-E2 parity admission → worker trace

Managed STAGING web and worker are live at exact app SHA
`52653947c1afa06b921bbcdb9d0ce34b65b5194c`. The deterministic harness is
not a general provider toggle: production-mode execution requires staging,
the exact canonical worker service ID, and an explicitly matching full live
SHA. Production, web/sibling, wrong-SHA, and missing-identity counterexamples
all fail closed.

The positive trace used a dedicated identity/product, committed synthetic E2
asset, verified sidecar/hash, immutable admission manifest and product
snapshot, Redis consumption, deterministic H.264/AAC output, PostgreSQL
terminal READY state, R2 deliverable presence, and QC-08 boundary. No provider
task, payment, ledger, invoice, refund, settlement, or regeneration value was
created; cost was Rp0. Every DB row, R2 object, and queue record was removed
and then authoritatively observed absent.

Final runtime restoration is complete: worker uses the canonical image CMD,
is not suspended, and is live at the exact app SHA; web maintenance is off.
Three public health samples returned HTTP 200 with the exact SHA, classifier
capability, and Duitku sandbox/live=false. The exact-SHA predeploy reported all
35 PostgreSQL migrations already applied. Production deploy IDs and SHAs match
the read-only pre-task baseline.
