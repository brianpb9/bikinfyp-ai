# JJ GLOW candidate-loss incident

The one authorized staging candidate was created and independently observed, but its PostgreSQL rows later disappeared. The exact app job UUID is no longer present in PostgreSQL, retained R2 lineage objects, BullMQ, or retained Render logs. Recreating it would be a second candidate, not recovery.

`INCIDENT.json` separates direct observations from inference and fixes the current boundary at `FOUNDER_DECISION_REQUIRED`. No database, Redis, R2, provider, or production mutation was made while collecting this evidence.

`BACKLOG-CONTRACT.json` records the approved post-lane intent `SECONDARY_GENERATION_PROVIDER=GROK_IMAGINE` without implementing it. It also records the two human gates required before any provider POST: Founder authorization for one replacement candidate and safe staging-worker-only entry of `BYTEPLUS_ARK_API_KEY`.

Verify the bundle with:

```sh
node docs/evidence/P0-JJ-GLOW-CANDIDATE-LOSS-20260831/verify.mjs
```
