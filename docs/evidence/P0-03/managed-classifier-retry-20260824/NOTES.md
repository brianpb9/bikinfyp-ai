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
