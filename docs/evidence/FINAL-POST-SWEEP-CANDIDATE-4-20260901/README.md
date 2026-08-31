# Candidate #4 pre-creation contract

This packet reviews code before the single authorized staging write. It does not claim that candidate #4 exists yet. The exact admission tuple is restricted to the existing JJ GLOW product, Founder principal, staging web service, frozen product-state digest, and fixed candidate-4 script ID. Lifecycle authority must pair task `FINAL-POST-SWEEP-CANDIDATE-4-20260901` with ordinal/max `4/4`; mixing legacy task/ordinal pairs fails closed.

The runner requires an explicit candidate-4 confirmation, locks the product and historical candidate, proves candidate #3 is the sole prior candidate and is `REFUNDED` with zero provider effects, proves no candidate-4 script/job/lifecycle history exists, and admits exactly one new job through the canonical HTTP approval and job routes. Any committed ambiguity is preserved; rerun cannot create candidate #5.

The metadata freeze/activation path accepts candidate #4 only when its exact job, correlation ID, and lifecycle state digest are supplied. Activation inserts the authoritative `PREPOST_READY` row and six-hour `ACTIVE_EVIDENCE_LEASE` under `SERIALIZABLE` locking without provider calls. Provider execution remains blocked until exact-SHA Reviewer PASS, durable/independent readbacks, and one normal stale-sweep survival proof.
