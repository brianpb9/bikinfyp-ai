# P0 JJ GLOW replacement candidate incident

The sole authorized replacement admission attempt was launched exactly once as Render one-off
`job-daagcs9f2nfc73a8gsp0` and the control plane reported `succeeded`. No second admission was
launched.

The candidate cannot be frozen because it is absent from the authoritative staging database.
The signed lineage endpoint failed closed with `409`, and the independent read-only Postgres
receipt returned zero scripts, zero jobs, and zero provider tasks for the exact product lane.

Consequently, `REPLACEMENT_CANDIDATE_CREATED=YES`, `TOTAL_CANONICAL_CANDIDATES_CREATED=2`, and
`CURRENT_ELIGIBLE_CANDIDATE_COUNT=1` cannot be truthfully asserted. Candidate replay and provider
POST are stopped pending explicit authority.

Verify with:

```sh
node docs/evidence/P0-JJ-GLOW-REPLACEMENT-CANDIDATE-20260831/verify.mjs
```
