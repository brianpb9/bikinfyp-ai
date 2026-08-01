# Migration Summary — BikinFYP.AI

Status dokumen: staging-only. Tidak satu pun langkah di sini adalah otorisasi production.

## Arsitektur saat ini

```text
Web Render (Singapore) ── PostgreSQL Render
          │                       │
          ├── Render Key Value ───┴── BullMQ job queue
          │                              │
          └── private R2 proxy ◄── Worker Render (FFmpeg/QC/BytePlus)
```

- Runtime utama staging adalah PostgreSQL (`RACUN_DB_RUNTIME=postgres`). SQLite tetap di kode sebagai rollback lokal dan belum dihapus.
- Web hanya menaruh pekerjaan render di BullMQ. Worker proses terpisah mengonsumsi job, menjalankan provider, compositing, QC, upload object, dan capture/refund kredit.
- Media disimpan privat di Cloudflare R2. URL yang diberikan aplikasi adalah proxy bertanda-HMAC; bucket tidak dipublikasikan.
- Worker container membawa FFmpeg/ffprobe, Python, Pillow, OpenCV YuNet, font Poppins, model YuNet, dan aset musik.

## Tahap yang telah dibuktikan

| Tahap | Status | Bukti utama |
|---|---|---|
| PostgreSQL schema/parity/data rehearsal | PASS lokal | 10 tabel, saldo ledger per-user, FK, rollback import |
| Runtime HTTP PostgreSQL | PASS lokal + staging | auth, produk, skrip, jobs, kredit, webhook branches |
| Redis/BullMQ worker | PASS lokal + staging | dedup, retry, refund, consumer terpisah |
| R2 private storage/proxy | PASS staging | object private, download 200/range 206/signature invalid 403 |
| BytePlus worker/QC | PASS staging | job `READY`, QC-03/04/05/07/08/09 lulus |
| Render staging | PASS untuk render path | web, worker, Postgres, Key Value di Singapore |
| Midtrans sandbox | PENDING settlement | checkout/callback/signature guard diuji; settlement akhir menunggu simulator/payment completion |

## Perintah operasi aman

Lokal (PostgreSQL manual pada port 54329):

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
pg_ctl -D /opt/homebrew/var/postgresql@16 -l /tmp/pg16.log -o "-p 54329" start
```

Lokal Redis test (port 6380):

```bash
redis-server --port 6380 --save '' --appendonly no --daemonize yes
redis-cli -p 6380 shutdown nosave
```

Worker lokal Redis hanya dijalankan dengan konfigurasi eksplisit:

```bash
RACUN_QUEUE_MODE=redis RACUN_DB_RUNTIME=postgres npm run worker
```

Di Render, restart melalui dashboard/API pada service staging web atau worker. Sesudah restart worker, pastikan log memuat nama queue dan lakukan smoke job; jangan restart saat render aktif bila dapat dihindari.

## Nama environment variables

Database/queue: `DATABASE_URL`, `RACUN_DB_RUNTIME`, `RACUN_QUEUE_MODE`, `REDIS_URL`, `REDIS_QUEUE_NAME`, `WORKER_CONCURRENCY`, `RACUN_DEPLOY_ENV`.

Storage: `STORAGE_MODE`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`.

Auth/OTP: `AUTH_SECRET`, `ALLOW_DEV_LOGIN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.

Provider: `PROVIDER_VIDEO`, `PROVIDER_VOICE`, `BYTEPLUS_ARK_API_KEY`, `BYTEPLUS_ARK_BASE_URL`, `BYTEPLUS_ARK_MODEL`, `BYTEPLUS_ARK_RESOLUTION`.

Payment: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`, `APP_BASE_URL`.

Media/tooling: `STORAGE_DIR`, `FFMPEG_PATH`, `FFPROBE_PATH`, `NODE_OPTIONS`.

## Remaining checks

1. Complete one genuine Midtrans **sandbox** settlement, confirm valid webhook and ledger credit; keep `MIDTRANS_IS_PRODUCTION=false`.
2. Re-run staging smoke after any provider, Render, or callback configuration change.
3. Before any production promotion, use `PRODUCTION_CUTOVER_PROPOSAL.md`; staging success is not production authorization.
