# Evidence acquisition critical path — Lane D contract

Task: `EVIDENCE-ACQUISITION-CRITICAL-PATH-20260827`

Compression authority is the canonical Reviewer TASK
`1787849638000-reviewer-TASK`, preserved byte-for-byte in
`COMPRESSION-SOURCE-TASK.raw.json`. Certified 58→80 is +22 canonical score,
while the fixed 13×10 rubric must move raw 77→104, a minimum +27 raw. These are
not interchangeable. The 27 scored tokens also do not replace mandatory
noncompensable gates.

This independently reviewable slice freezes the existing 13-row board and
turns the score-80 gate into a deterministic, non-compensable dependency
contract. Arithmetic requires raw 77→104 (+27), but the canonical sources do
not currently define an accepted row-by-row combination reaching 104.
`SCORE-80-POINT-MATRIX.json` therefore records zero accepted tokens and
`CHANGES_REQUESTED_NO_ACCEPTED_CANONICAL_COMBINATION`; it does not engineer a
replacement allocation. No token is awarded, so the certified score remains
58.

The current Founder direction, carried by the canonical amended Reviewer TASK
in `AMENDED-SOURCE-TASK.json`, limits work to the score-80 critical path. It
approves the C5 fail-closed manual-review policy, approves a tightly bounded
payment canary only in principle and only after prerequisites, and approves a
separated release model while leaving role names missing. It does not
substitute for implementation or actual Founder, payment-owner, release-owner,
or independent-review receipts. No 90 acquisition work is authorized.

Payment ordering is non-circular and fail-closed. Founder-approved package,
entitlement, channel, variable-COGS source/effective time, fee/tax basis,
expected settlement, margin/test-loss, cap, and approval fields plus
merchant/channel readiness must exist first. Only then may one closed canary
run and produce provider, DB truth, exactly-once, settlement, and reconciliation
receipts. `PAYMENTS_GO_LIVE` is a separate Founder decision after that canary
passes; it cannot be inferred from pre-canary economics or decided early.

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

Token awards remain fail-closed: because no accepted canonical token exists,
the registry must stay empty. Noncompensable 80 gates remain mandatory but
cannot manufacture row points. The ceiling stays 58 until both the gates and a
Founder/Reviewer-approved canonical +27 raw allocation exist.
The issuer/class and decision policy is pinned in the verifier, not read as
authority from the editable registry. The amended TASK and compression TASK
raw archive bytes are committed and match their pinned archive digests. The
27-token fixture builds full authority and receipt records and runs them
through the same committed-byte, ancestry, issuer, authority-scope, dependency,
and award validators used by the real registries. The fixture is never inserted
into current state.

For real records, a TASK source is accepted only for pinned scope. SLOT and
TOKEN authority relies on the canonical singleton independent Codex exact-SHA
Reviewer and `.agent-bus`: role separation prevents Builder from authoring a
PASS, SHA binding fixes the reviewed object, consumed messages move to the
durable append-only archive, and `STALE=false` protects the active history.
The canonical rubric requires no crypto, HSM, signing key, or custom signing
service, so none is required by this contract.

`NEGATIVE-CASES.json` exercises unknown token, mismatched authority and
authority scope, unrelated TASK/PASS sources, owner-routing mismatch,
Builder-authored PASS rejection, mismatched receipts,
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
controlled 503→recovery drill, and restored exact control plane. Its historical
seven-day KPI query has `n=0`, remains point-ineligible, and is excluded from
the 80 path. Legal/PDP, representative KPI/sample, PITR, incident/DR, and a
stable production operational cycle are 100-only and cannot contribute to any
80 token. Paid provider E2E and paired legacy audit remain unproven.

Run `node verify.mjs`. It binds exact source rows, arithmetic, Git ancestry,
thresholds, dependency acyclicity, authority rules, safety boundaries,
checksums, and secret-pattern absence.
