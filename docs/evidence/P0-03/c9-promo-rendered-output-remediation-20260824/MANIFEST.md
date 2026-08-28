# C9 rendered-output remediation manifest

Task: `P1-C9-PROMO-OUTPUT-COUNTEREXAMPLE-20260824`

Code under test: `e1e80c052ee7d77339239af09f83eb2b37649289`

Reviewer finding: `1787563838000`

Files:

- `affected-tests.log`: SQLite W2 rendered gain/removal plus promo tests, 19/19.
- `postgres-w1.log`: disposable PostgreSQL W1 suite, 29/29.
- `npm-test.log`: final aggregate, 1,091 PASS / 0 fail / 44 skip.
- `tsc.log`: empty successful TypeScript output.
- `build.log`: successful production build.
- `script-catalog.log`: catalog audit with `passed: true`.
- `postgres-residue.txt` and `.stderr.txt`: empty successful residue check.
- `proof.txt`: scope, diagnostics, and the superseded first-run failure.
- `sha256.txt`: local checksums for this bundle, excluding itself.

The earlier input-only bundle is preserved unchanged. This follow-up corrects
its output-proof limitation; it does not rewrite history or choose C9 policy.
