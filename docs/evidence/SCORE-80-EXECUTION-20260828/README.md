# SCORE-80 first execution slice

This slice records the Founder-authorized deterministic allocation from raw
77/130 to target 104/130. The thirteen targets sum to exactly 104 and their
deltas sum to exactly 27. They are targets, not awarded points: every positive
delta remains `UNAWARDED` until exact-SHA evidence is independently accepted
row by row.

The same Founder receipt resolves the previously missing authority fields:
C5 Authorized Human Review Role and Release Approver are `Founder/CEO`, the
Release Operator is the canonical Builder service/operator identity, and
Rollback Authority is `Founder/CEO`. Approver and Operator remain separate.

No payment or provider call was made. Public payments remain disabled,
`PAYMENTS_GO_LIVE` remains unauthorized, public prices were not changed, and
the closed canary remains blocked until every Founder prerequisite has an
authoritative source.

Run `node docs/evidence/SCORE-80-EXECUTION-20260828/verify.mjs`.

## Stream B managed receipt

Only the raw managed-staging receipt and its checksum manifest remain under
`STREAM-B-MANAGED.raw/`. The other 39 files named by that historical manifest
are absent, so their HTTP, asset, database, and cleanup claims are explicitly
unverified and are not accepted as partial facts.

The normalized result is `UNVERIFIED_SOURCE_ARTIFACTS_NO_SCORE`. The receipt's
OTP, redirect, dashboard, and safety fields remain self-reported claims only.
The verifier hashes every preserved entry and proves the 39-file absence. Slot
B remains open and Auth, Mobile, Hydration, and Prompt/archive receive zero
points from this slice.

## Streams A and L managed receipts

The complete sanitized A/L source directory is preserved byte-for-byte under
`STREAM-A-L-MANAGED.raw/`; the verifier checks every file against the pinned
manifest. Lane A is a `PASS_CANDIDATE_PENDING_REVIEW` for exact deployed SHA
`46499ac5e345997b394e4ac522759e40fe2eae22`: web and worker are live on that
SHA, PostgreSQL and R2 managed readback succeeded, migration 0036 is current,
and health reports public payments off. `A_RECEIPT` remains pending Reviewer.

Lane L's audit execution and receipt readiness are PASS candidates pending
Reviewer, but its legacy-population gate remains failed and locked. Of 149
products, 148 references match a primary object, all 148 lack evidence
sidecars, 56 additional primary objects are orphaned, and one product has no
photo. Pre/post database and R2 fingerprints are identical. Therefore
`L_GATE_UNLOCKED=NO` and this slice claims zero points.
