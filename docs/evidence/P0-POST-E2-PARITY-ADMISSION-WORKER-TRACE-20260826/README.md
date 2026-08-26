# Post-E2 parity admission → worker trace

Managed STAGING web and worker are live at exact app SHA
`565f3fad6446152966bd8003a0aa8f6536bd279b`. The deterministic harness is
not a general provider toggle: production-mode execution requires staging,
the exact canonical worker service ID, and an explicitly matching full live
SHA. Production, web/sibling, wrong-SHA, and missing-identity counterexamples
all fail closed.

The positive trace POSTed a supported high-quality, 15-second approved script
through canonical `/api/jobs`; HTTP 201 returned QUEUED and the worker consumed
that exact returned job ID. It used a dedicated identity/product, committed
synthetic E2 asset, verified sidecar/hash, immutable admission manifest and product
snapshot, Redis consumption, deterministic H.264/AAC output, PostgreSQL
terminal READY state, R2 deliverable presence, and QC-08 boundary. No provider
task, payment, ledger, invoice, refund, settlement, or regeneration value was
created; admission hold and cost were Rp0. Every DB row, R2 object, and queue record was removed
and then authoritatively observed absent.

The deterministic worker itself parses the immutable product snapshot and
parses plus materializes/hash-verifies the immutable reference manifest before
FFmpeg can create output. Missing or structurally tampered admission values
fail closed, and byte tampering is rejected by canonical materialization.

The Rp0 capability is bound to the exact user, script, format, tier, duration,
SHA, random nonce, and five-minute expiry. Redis atomically consumes the nonce;
an immediate replay of the exact authenticated request returned HTTP 400.
Separately, the canonical provider worker rejected the ledger-less job before
provider execution during the deploy handoff; only the exact deterministic
worker gate could consume its retry.

Fixture selection is also job-bound: a ledger-less job is required. While the
trace worker process-wide gate is active, any ordinary held job is rejected
before both fixture and provider paths, left retryable for the canonical
worker, and cannot be synthesized or charged by the trace worker.

The trace admission is enqueued on
`racun-jobs-staging-managed-staging-trace`; the canonical paid queue remains
`racun-jobs-staging`. The trace Worker subscribes only to the former. Managed
before/after receipts show both queues at the same canonical zero state, so an
ordinary held job cannot be claimed or stranded by the trace process.

Final runtime restoration is complete: worker uses the canonical image CMD,
is not suspended, and is live at the exact app SHA; web maintenance is off.
Three public health samples returned HTTP 200 with the exact SHA, classifier
capability, and Duitku sandbox/live=false. The exact-SHA predeploy reported all
35 PostgreSQL migrations already applied. Production deploy IDs and SHAs match
the read-only pre-task baseline.

Primary receipts are preserved in `TRACE-RUNTIME-LOG.txt`,
`DEPLOY-RECEIPTS.json`, `HEALTH-SAMPLES.json`, and
`MIGRATION-RECEIPT.json`. `TRACE-RECEIPT.json` is the pretty-printed trace
payload; `PRODUCTION-READONLY.json` states the exact boundary of the
production non-mutation evidence. Test footers, operator actions, attempt
lineage, validation assertions, and integrity hashes are preserved in their
correspondingly named files.
