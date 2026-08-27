# Evidence acquisition critical path — Lane D contract

Task: `EVIDENCE-ACQUISITION-CRITICAL-PATH-20260827`

This independently reviewable slice freezes the existing 13-row board and
turns the 80/100 gates into a deterministic dependency contract. It awards no
new point: an evidence receipt may close a named slot at its exact tier, but a
row score can change only through an explicit authority receipt naming the
row, old/new score, reason, and supporting evidence receipts.

The authorized source defines 80 and 100 gates but does not allocate the
80-to-100 interval at 90. The contract therefore makes 90
`UNDEFINED_AUTHORITY_CHOICE_REQUIRED`; it cannot be certified by interpolation.

Lane A is marked external/in progress and Lane B depends on Lane A. A receipt
registry covers all 13 slots and is intentionally empty until immutable
sanitized artifacts are available. A slot can become `VERIFIED` only through a
PASS receipt binding its exact tier, required authority class, committed
artifact path+SHA-256, exact Git SHA, and PASS receipt IDs for every dependency.
This slice performs no deploy and cannot conflict with Lane A.
Production, public launch, and real money remain OFF.

Run `node verify.mjs`. It binds exact source rows, arithmetic, Git ancestry,
thresholds, dependency acyclicity, authority rules, safety boundaries,
checksums, and secret-pattern absence.
