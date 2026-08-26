# Attempt lineage

All failed rounds ended before a provider/payment call. The only round that
created trace data emitted its own authoritative cleanup receipt.

1. `job-da7asqh5efls73cnbbe0`: platform one-off created while parent service
   was suspended; failed before application logs.
2. `job-da7auc8u01pc738qm4ig`: platform one-off startup failed before
   application logs. The design moved to the canonical managed worker identity.
3. `dep-da7ava0ae00c73b9hkag`: Docker command was parsed as an executable
   literal; exit 128 before Node.
4. `dep-da7b0895efls73cnmbrg`: quoted shell payload was retained as a command
   name; Node did not run.
5. `dep-da7b13u7bikc73a4casg`: Node ran, failed on missing committed fixture in
   `Dockerfile.worker`, and emitted `cleanup.database/r2/queue=true`, all final
   counts zero.
6. `dep-da7b3o942hec73atb48g`: lineage-bound remediation on app SHA
   `52653947c1afa06b921bbcdb9d0ce34b65b5194c`; emitted authoritative PASS.

7. Reviewer correctly rejected that receipt because its handcrafted job row
   bypassed canonical admission and the bundle lacked primary receipts.
8. `dep-da7bbm8u01pc738ronpg`: canonical `/api/jobs` remediation on app SHA
   `03acd0f706f225039e2f5f16810c6f55e7402b60`; HTTP 201 admission and exact
   returned-job worker consumption emitted the authoritative replacement PASS.

The trace command was removed immediately afterward. Canonical worker deploy
`dep-da7bcim417fc73f8v0c0` was the final live deploy for the first remediation.

9. Reviewer clarification required the immutable checks to execute inside the
   deterministic worker before output, not only in the observing harness.
10. `dep-da7bi9ad0e5s73e1pv10` failed before DB/queue/provider because the
    first command override omitted `EXPECTED_APP_SHA`; it created no trace data.
11. `dep-da7bjb1srm7s73823e60` ran the final exact-SHA worker remediation
    `58aeb4f19874290916a1497707632ff87e7e7d0d`; canonical admission returned
    HTTP 201 and the worker parsed snapshot plus materialized/hash-verified the
    manifest before output. The receipt and cleanup both passed.

The trace command was removed immediately afterward. Canonical worker deploy
`dep-da7bk4navr4c73biljtg` was the final live deploy for that remediation.

12. Reviewer identified replayability and incomplete cleanup observation.
    SHA `0a2a866952e1a7729c98e9f7029c567c306467c0` added a request-bound,
    five-minute, Redis-NX capability, provider-worker zero-ledger guard, and
    per-table cleanup counts. Its trace passed and proved the guard during
    worker handoff.
13. SHA `7a54128dbaa03f808355791edffeb25d91e69f17` added a direct runtime replay
    counterexample. `dep-da7bv37avr4c73bjoih0` returned HTTP 400 for the exact
    repeated capability, then emitted PASS with all 13 task-owned table counts
    zero plus R2/queue absence.

The trace command was removed immediately afterward. Canonical worker deploy
`dep-da7c00id0e5s73e37ikg` is the final live deploy.
