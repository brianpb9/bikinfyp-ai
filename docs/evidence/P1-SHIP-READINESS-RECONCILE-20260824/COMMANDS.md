# Mechanical command receipt

All commands are read-only or local validation. No command contacted Render,
Duitku, or another provider.

1. Parse board rows with a deliberately narrow single-tier regex; observe the
   false result `rows=12,sum=70`. Repeat accepting `V/C`; require
   `rows=13,sum=77`, normalized `59.23`, reported `min(round(59.23),58)=58`.
2. Parse every `.agent-bus/archive/*.json`; for each accepted current-delta
   task require exactly one PASS and one DONE at its exact SHA.
3. For C8/E1/C3/Duitku/parity SHAs, run
   `git merge-base --is-ancestor SHA 0fa86ca...`; all five return exit 0.
4. Parse the four managed parity receipts and require exact app SHA, one web
   and worker deploy, 3/3 exact health samples, three matching DB/queue
   snapshots, and exact canary response shapes.
5. Parse the external negative controls: final Duitku status receipt is
   `HOLD`/HTTP 404; post-task production receipt has `autoDeploy=yes` on both
   services; worker source rejects only explicit `cocokMerek === false` and
   accepted tests keep null OCR as a positive control.
6. Validate every scoped JSON with `jq empty`, every Markdown relative link
   target, source-board/current-ledger score tokens, forbidden stale-current
   phrases, SHA ancestry, exact secret-value absence, manifest checksums, and
   `git diff --check`.

Full regression is `NOT_RUN`: this slice changes docs/evidence only and does
not alter runtime code, configuration, schema, or dependencies.
