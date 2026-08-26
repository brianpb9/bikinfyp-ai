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

The trace command was removed immediately afterward. Canonical worker deploy
`dep-da7b4ggae00c73ba22og` is the final live deploy.
