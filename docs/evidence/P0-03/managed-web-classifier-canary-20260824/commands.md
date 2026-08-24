# Reconstructed command and exit ledger

This is a later reconstruction from the operator-session tool transcript, not
a contemporaneous raw shell transcript. `<TOKEN>` replaces the bearer token.
Times are bounded by observed API/deploy timestamps when shell start/end was
not separately recorded. It cannot prove absence of unrecorded commands.

| UTC start/end | Sanitized literal invocation | Exit | Retained evidence |
|---|---|---:|---|
| 11:15/11:15 | `render deploys list srv-d9n28ue417fc73ch2b60 --output json` | 0 | `control-plane-baseline.json` |
| 11:15/11:15 | `render deploys list srv-d9nhccfqj5pc73et9hrg --output json` | 0 | `control-plane-baseline.json` |
| 11:15/11:15 | `render deploys list srv-d9ni3ndaeets73c07kq0 --output json` | 0 | `control-plane-baseline.json` |
| 11:16/11:16 | `render postgres get dpg-d9n21fnlk1mc73djm8q0-a --output json` | 0 | `control-plane-baseline.json` |
| 11:17/11:17 | `git push origin d2edab0972ea407148138c72f38e67e159748c64:refs/heads/staging/exact-d2edab0-20260824` | 0 | staging-only ref named in attempt capture |
| 11:17/11:17 | `render services update srv-d9n28tijnfac73a87lt0 --maintenance-mode --confirm --output json` | 0 | later endpoint transcription only |
| before 11:18:37/before 11:18:37 | `curl -sS -o <TEMP> -w '%{http_code}' https://racun-ai-staging-web.onrender.com/api/health` | 0 / HTTP 503 | `control-plane-attempt.json` transcript transcription |
| 11:18:37/11:18:37 | `curl -X PATCH https://api.render.com/v1/services/srv-d9n28tijnfac73a87lt0 -H 'Authorization: Bearer <TOKEN>' --data '<candidate-payload>'` | 0 | full allowlisted payload/result fields in `control-plane-attempt.json` |
| 11:18:41/11:20:48 | `render deploys create srv-d9n28tijnfac73a87lt0 --commit d2edab0972ea407148138c72f38e67e159748c64 --wait --confirm --output json` | 1 | deploy terminal record + `failed-build-log.txt` |
| 11:20:48/11:20:49 | `render logs --resources srv-d9n28tijnfac73a87lt0 --start 2026-08-24T11:18:30Z --end 2026-08-24T11:21:10Z --limit 200 --output text` | 0 | `failed-build-log.txt` |
| 11:21:09/11:21:09 | `curl -X PATCH https://api.render.com/v1/services/srv-d9n28tijnfac73a87lt0 -H 'Authorization: Bearer <TOKEN>' --data '<rollback-config-payload>'` | 0 | final config in `control-plane-final.json`; response not retained raw |
| 11:21:09/11:26:30 | `render deploys create srv-d9n28tijnfac73a87lt0 --commit 4a1d258155b128fee0fcd5a6143198f36a558163 --wait --confirm --output json` | 0 | live deploy in `control-plane-final.json` |
| 11:26:49/11:26:49 | `curl -X PATCH https://api.render.com/v1/services/srv-d9n28tijnfac73a87lt0 -H 'Authorization: Bearer <TOKEN>' --data '{"serviceDetails":{"maintenanceMode":{"enabled":false,"uri":""}}}'` | 0 | final `updatedAt` and maintenance=false in `control-plane-final.json` |
| 11:26:53/11:26:54 | `curl -fsS https://racun-ai-staging-web.onrender.com/api/health` | 0 / HTTP 200 | `health-final.json` |
| 11:31/11:32 | official Render GETs for all four services and deploy lists | 0 | `control-plane-final.json` |

The candidate payload set only staging web branch, auto-deploy, Docker runtime,
`Dockerfile.web`, context, empty Docker command, `/api/health`, pre-deploy
migration, and maintenance true. The rollback payload restored only staging web
branch, auto-deploy, Node runtime, original build/start/pre-deploy commands,
empty health path, and maintenance true. Full values are represented in the
allowlisted JSON artifacts; credentials and environment values are excluded.
