# P0 JJ GLOW replacement candidate incident

The sole authorized replacement admission attempt was launched exactly once as Render one-off
`job-daagcs9f2nfc73a8gsp0` and the control plane reported `succeeded`. No second admission was
launched.

The candidate cannot be frozen because it is absent from the authoritative staging database.
The signed lineage endpoint failed closed with `409`, and the independent read-only Postgres
receipt returned zero scripts, zero jobs, and zero provider tasks for the exact product lane.
The receipt now preserves the exact executed command and emitted payload, bound to its Render
job, staging service, live deployed SHA, product, script, and principal.

The exhaustive Render job-list capture covers the full Founder-authorized window. Its query,
raw response, and canonical window projection are digest-bound; exactly one entry has the exact
canonical-admission command hash, with the recorded start, control-plane completion, and finish
time. A separate digest-bound application-log query returned zero entries; the packet does not
misrepresent the control-plane `succeeded` state as proof that the runner body completed.

Consequently, `REPLACEMENT_CANDIDATE_CREATED=YES`, `TOTAL_CANONICAL_CANDIDATES_CREATED=2`, and
`CURRENT_ELIGIBLE_CANDIDATE_COUNT=1` cannot be truthfully asserted. Candidate replay and provider
POST are stopped pending explicit authority.

Verify with:

```sh
node docs/evidence/P0-JJ-GLOW-REPLACEMENT-CANDIDATE-20260831/verify.mjs
```
