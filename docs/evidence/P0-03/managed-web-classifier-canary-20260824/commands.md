# Command and exit ledger

All Render API responses below were piped through explicit `jq` allowlists.
Bearer tokens and environment values were never emitted or stored.

| UTC phase | Command class | Exit/result |
|---|---|---|
| 11:15 | official Render GET service metadata; deploy lists; staging health | 0; prestate captured |
| 11:17 | `git push` exact candidate SHA to staging-only ref | 0 |
| 11:17 | enable staging web maintenance; GET health | 0; HTTP 503 observed |
| 11:18 | official Render PATCH staging web to Docker candidate | 0; response observed `maintenance.enabled=true` |
| 11:18 | create exact-SHA staging web deploy and wait | 1; `build_failed` |
| 11:20 | query bounded build logs | 0; sanitized excerpt retained |
| 11:21 | official Render PATCH exact Node/main prestate with hold retained | 0 |
| 11:21 | deploy exact rollback SHA and wait | 0; `live` |
| 11:26 | official Render PATCH maintenance false | 0 |
| 11:26 | staging health and final control-plane/deploy reads | 0; HTTP 200, exact rollback SHA |

No classifier/admission endpoint command and no paid-provider command appears in
this complete task command ledger. Because the Docker build failed before a
runtime existed and maintenance stayed enabled until the rollback was live,
the planned canary phase was never entered. This supports the bounded claim
that this operator/task invoked neither a canary nor a paid provider; it is not
a claim about unrelated actors outside the task window.
