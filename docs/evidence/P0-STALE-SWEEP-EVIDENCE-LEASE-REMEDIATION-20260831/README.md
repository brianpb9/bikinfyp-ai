# Stale sweep evidence-lease remediation

The retained managed database/audit receipt proves that the final candidate was created and last progressed in the `jobs` state machine at `2026-08-31T08:04:15.376Z`. The authoritative evidence row was activated at `10:00:08.702Z`, but the legacy generic sweep did not consult that lifecycle. At `12:48:27.525Z` it evaluated the still-`QUEUED` job against the configured 1,800-second threshold. The job-state age was 17,052.149 seconds, so the exact legacy predicate matched and the worker transaction released 12,000 credits and terminalized `REFUNDED`.

The historical audit stored the localized reason `Job di state QUEUED lebih dari 30 menit`; it did **not** store a machine reason code. This packet records the historical code as `NOT_RECORDED`, rather than inventing one. The new transaction writes stable `STALE_SWEEP_TIMEOUT` / `refund_reason_code=STALE_SWEEP_TIMEOUT` receipts.

The root fix is generic and lineage-bound, not a candidate-ID exemption. Evidence activation acquires a six-hour `ACTIVE_EVIDENCE_LEASE` on the authoritative evidence row. Existing evidence-authority transitions renew it. Every activation, provider transition, private capture, stop settlement, and stale decision follows the lock order `jobs FOR UPDATE` then evidence row. The stale decision and any release/refund stay in one serializable transaction.

An unexpired pre-provider lease protects a job. An expired pre-provider lease becomes `STOP_NO_RETRY` and is refunded once. Any provider-post/in-flight evidence is excluded from the generic refund path even after lease expiry because provider-specific recovery owns potentially-spent requests. Jobs without evidence leases retain normal abandoned cleanup.

The six required cases ran against a disposable loopback PostgreSQL database. No provider adapter was invoked and the canonical staging candidate count did not change. The managed staging worker remained suspended and its queue remained paused; no candidate, publication, production, provider, or payment mutation was performed.
