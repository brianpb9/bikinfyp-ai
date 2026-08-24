# Managed classifier retry evidence notes

TASK=`P0-B2-MANAGED-CLASSIFIER-RETRY-20260824`

All retained command artifacts after task consumption are captured by
`scripts/managed-retry-capture.sh`. The ledger is append-only. Render CLI and
allowlisted API commands relied on the authenticated operator session;
credentials and their local source were never passed as command arguments or
retained. The API helpers were normalized before commit to require an injected
`RENDER_API_TOKEN`; they contain no credential locator or value. Complex
command arguments are represented as `<REDACTED_COMPLEX_ARG>` in the ledger.

Before the capture helper existed, the operator ran read-only discovery
(`find`, `rg`, `git status`, `git remote -v`, `git branch --show-current`,
selected prior evidence reads, Render help, and `render whoami`). These commands
made no external mutation and are disclosed here rather than assigned invented
timestamps or artifacts.

Before commit, the fixed operator IPv4 address was replaced by
`<REDACTED_IP>` in five retained artifacts and their ledger hashes were updated
to the sanitized-file hashes. No timestamp, result, control-plane field, or
other output was changed. The public-IP artifact uses `<REDACTED_IP>/32`; the
original IP is not retained in this tree.

Reviewer returned `CHANGES_REQUESTED` on evidence SHA `5e889922...` because
the original aggregate omitted changes to pre-existing work and because web
was reopened while worker still ran an older SHA. Remediation kept web in
maintenance, suspended the worker while accounting for four legacy
non-terminal promo rows, proved both Redis queues empty, then deployed worker
explicitly at the accepted SHA. That first remediation attempted to use a
post-rollout fingerprint window; second review later superseded it with the
fully retained replay described below. The old `ZERO_MONEY_WINDOW` claim is
retained as unproven and is not promoted.

The worker resume automatically queued an exact-SHA deploy. A second explicit
request made one second later was cancelled while queued to prevent two
concurrent canonical rollouts. After the resume deploy reached `live`, one
fresh explicit API deploy was issued and reached `live`; that terminal record
is the worker parity artifact.

Reviewer returned a second `CHANGES_REQUESTED` because the first retained
fingerprint baseline began after rollout and because production service config
had not been re-read after remediation. The final replay therefore retained
maintenance 503, suspend and resume responses, suspended service state,
complete database fingerprint, and both queue counts before resume. It then
retained exact-SHA deploy terminal state plus immediate and sustained database
and queue observations before clearing the allowlist and reopening intake.
Post-replay production web and worker service objects were compared directly
with pre-task baselines. The earlier post-rollout-only parity window remains
historical and is not the final safety basis.

The first replay queue-inspection one-off job failed before connecting because
its inline JavaScript was over-escaped. Its failed terminal status is retained.
The successful replacement job then emitted both pre-rollout queue counts while
the main worker remained suspended; no failed attempt output is used as proof.

Reviewer returned a third `CHANGES_REQUESTED` because the earlier
`replay-hold-503.txt` actually recorded HTTP 200 during maintenance
propagation. That replay is invalid as a controlled-window proof even though
its later snapshots matched. The final proof uses only `canonical-*`: it
retains the 200-to-503 propagation, a separate 503 before suspend/baseline, a
second 503 after all sustained comparisons, and the final 200 release probes.
No `replay-*` fingerprint or queue artifact is used for the canonical verdict.
