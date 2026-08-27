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

Lane A normalization is prepared but empty. No raw receipt was available in
this slice, so no receipt was manufactured, normalized, registered, or scored.
`A-RECEIPT-NORMALIZATION.json` defines the fail-closed fields and rejection
rules to apply when sanitized raw receipts arrive.

No payment or provider call was made. Public payments remain disabled,
`PAYMENTS_GO_LIVE` remains unauthorized, public prices were not changed, and
the closed canary remains blocked until every Founder prerequisite has an
authoritative source.

Run `node docs/evidence/SCORE-80-EXECUTION-20260828/verify.mjs`.

## Stream B managed receipt

The raw managed-staging receipt and its checksum manifest are preserved byte
for byte under `STREAM-B-MANAGED.raw/`. Their SHA-256 values are pinned by the
verifier and normalized in `B-RECEIPT-NORMALIZATION.json`.

The normalized result is `PASS_PARTIAL_NO_SCORE`. Managed OTP success,
wrong-code rejection, replay rejection, recovery, Google-cancel redirect, and
authenticated dashboard HTTP evidence are retained as partial facts. The
receipt explicitly lacks browser runtime bootstrap, so SSR and downloaded
assets are not promoted to executed hydration or mobile-375 proof. Slot B
remains open and Auth, Mobile, Hydration, and Prompt/archive receive zero
points from this slice.
