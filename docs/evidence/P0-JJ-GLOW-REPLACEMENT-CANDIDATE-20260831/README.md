# P0 JJ GLOW replacement candidate incident

Two control-plane commands referenced the replacement runner. The first, direct-path command in
`job-daagck1srm7s73esrum0`, failed in Node's entrypoint loader with `MODULE_NOT_FOUND`, an empty
require stack, and no project marker: the candidate file was absent and no candidate code ran.
The only command capable of executing candidate code was the later embedded transport in
`job-daagcs9f2nfc73a8gsp0`; its control plane reported `succeeded`. Thus the packet counts two
runner launches, one proven pre-execution bootstrap failure, and one candidate creation attempt.
No candidate-code replay was launched.

The candidate cannot be frozen because it is absent from the authoritative staging database.
The signed lineage endpoint failed closed with `409`, and the independent read-only Postgres
receipt returned zero scripts, zero jobs, and zero provider tasks for the exact product lane.
The receipt now preserves the exact executed command and emitted payload, bound to its Render
job, staging service, live deployed SHA, product, script, and principal.

The exhaustive Render job-list capture covers the full Founder-authorized window. Its query,
secret-safe exact 20-row response bytes, and canonical window projection are committed and
digest-bound. The verifier derives the count, time bounds, window rows, and command hashes from
those source bytes; exactly one entry has the exact
canonical-admission command hash, with the recorded start, control-plane completion, and finish
time. A separate digest-bound application-log query returned zero entries; the packet does not
misrepresent the control-plane `succeeded` state as proof that the runner body completed.

The Postgres receipt likewise includes the exact secret-free Render log response. The verifier
derives its emitted payload from that raw message and binds the log resource to the raw job record,
the exact executed start command, and the raw live-deploy record.

Consequently, `REPLACEMENT_CANDIDATE_CREATED=YES`, `TOTAL_CANONICAL_CANDIDATES_CREATED=2`, and
`CURRENT_ELIGIBLE_CANDIDATE_COUNT=1` cannot be truthfully asserted. Candidate replay and provider
POST are stopped pending explicit authority.

Verify with:

```sh
node docs/evidence/P0-JJ-GLOW-REPLACEMENT-CANDIDATE-20260831/verify.mjs
```
