# Evidence acquisition critical path — Lane D contract

Task: `EVIDENCE-ACQUISITION-CRITICAL-PATH-20260827`

This independently reviewable slice freezes the existing 13-row board and
turns the score-80 gate into a deterministic, non-compensable dependency
contract. `SCORE-80-POINT-MATRIX.json` defines the exact 27 raw points from
77 to 104 as one-point, no-partial, strictly cumulative tokens inside the
existing 13 rows. Weights remain 10 per row and cannot be redistributed. No
token is currently awarded, so the certified score remains 58.

The current Founder direction, carried by the canonical amended Reviewer TASK
in `AMENDED-SOURCE-TASK.json`, limits work to the score-80 critical path. It
approves the C5 fail-closed manual-review policy, approves a tightly bounded
payment canary only in principle and only after prerequisites, and approves a
separated release model while leaving role names missing. It does not
substitute for implementation or actual Founder, payment-owner, release-owner,
or independent-review receipts. No 90 acquisition work is authorized.

`PITR_REQUIRED_FOR_80=false`: the canonical rubric names backup/PITR restore as
an additional 100 requirement, not an 80 requirement. This is not a waiver of
controlled recovery proof at 80 and does not remove PITR from 100.

Lane A is marked external/in progress and Lane B depends on Lane A. A receipt
registry covers all 13 slots and is intentionally empty until immutable
sanitized artifacts are available. A slot can become `VERIFIED` only through a
PASS receipt binding its exact tier, required authority class, committed
artifact path+SHA-256, exact Git SHA, and PASS receipt IDs for every dependency.
The verifier reads artifact bytes with `git show exact_sha:artifact_path`,
requires that commit in reviewed ancestry, resolves the authority receipt
against `AUTHORITY-REGISTRY.json`, and checks the exact dependency-slot set.
For M/Q/I/U/K/O, dependency `80` expands to A/L/C5/P/G/B/R.

Token awards are machine-enforced end to end: token identity, per-token
required slot receipts, token-specific authority class, cumulative row order,
duplicate rejection, raw/normalized recomputation, and the evidence-ceiling
transition. The ceiling stays 58 unless all non-compensable 80 slots are
VERIFIED; certified 80 additionally requires all 27 tokens and raw 104.
The issuer/class and decision policy is pinned in the verifier, not read as
authority from the editable registry. The amended TASK's raw archive bytes
are committed and match the pinned archive digest. The 27-token fixture builds
full authority and receipt records, runs them through the same committed-byte,
ancestry, issuer, authority-scope, dependency, and award validators used by the
real registries, plus a separate ephemeral Ed25519 fixture key that is never
accepted for real awards. The fixture is never inserted into current state.

For real records, a TASK source is accepted only for the pinned Founder SCOPE.
SLOT and TOKEN authority is currently fail-closed. Reviewer found that the
private key corresponding to fingerprint
`6684d5c4ed97b5b60af0671ac5eeaacf0e9e6ad6f4fc283320e5a124fe256853`
was readable by Builder's OS identity and removed it. That fingerprint, key id,
bootstrap, and signature are retained only as revoked audit evidence and can
never authorize a receipt or point. `RUBRIC-CONTRACT.json` is therefore
`CHANGES_REQUESTED` and blocked until an independent signer inaccessible to
Builder rotates the key and issues a new bootstrap. Same-UID file permissions
are not treated as isolation.

`NEGATIVE-CASES.json` exercises unknown token, mismatched authority and
authority scope, unrelated TASK/PASS sources, source/registry issuer mismatch,
self-authored PASS without a trusted signature, mismatched receipts,
out-of-order and duplicate awards, false raw claims, and incomplete gates.
Score 90 inherits the 80 gate, but its
incremental allocation remains undefined pending Founder authority; M/Q/I/U/K/O
remain additional canonical 100 requirements only.
This slice performs no deploy and cannot conflict with Lane A.
Production, public launch, and real money remain OFF.

`LANE-A-READONLY-ARTIFACT.json` is an independently refreshed sanitized
artifact. It remains `PENDING_INDEPENDENT_REVIEW`, and slot A remains
unverified with an empty receipt registry until an exact-SHA Reviewer PASS is
consumed and bound in a follow-up commit.

`LANE-B-READONLY-ARTIFACT.json` records the current-SHA managed browser PASS,
controlled 503→recovery drill, restored exact control plane, and a successful
seven-day KPI query. The KPI has `n=0`, is explicitly non-representative and
point-ineligible. Paid provider E2E, PITR, operational cycle, and paired legacy
audit remain unproven.

Run `node verify.mjs`. It binds exact source rows, arithmetic, Git ancestry,
thresholds, dependency acyclicity, authority rules, safety boundaries,
checksums, and secret-pattern absence.
