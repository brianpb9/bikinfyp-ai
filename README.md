# BikinFYP.AI — Backend + Frontend MVP

Platform yang mengubah **foto produk + link toko** menjadi **video jualan gaya UGC 15 detik berbahasa Indonesia** untuk seller TikTok Shop/Shopee. Berisi: backend (mesin skrip, pipeline media, API), frontend mobile-first, dan provider nyata BytePlus/Google/Azure (menunggu API key).

## Cara menjalankan

```bash
npm install
npm run seed        # buat user demo 08123456789 (bonus 3 kredit) + persona Hijaber
npm run dev         # http://localhost:3000
```

Tes & bukti jalan:

```bash
npm test            # unit test: validator L-01..L-16, mesin skrip, ledger, HITL, SSML, timeout
npm run smoke       # smoke end-to-end: login -> produk -> skrip -> approve -> job -> READY -> unduh MP4
MOCK_A_FAIL=1 npm run smoke   # uji failover: job tetap READY via mock-video-b
node scripts/e2e-ui.mjs       # uji klik E2E UI (Playwright, 390px) — butuh dev server menyala
npx tsx scripts/test-tts.ts   # tes TTS Google/Azure -> test_output/tts_test/ (mode parsial tanpa key)
bash scripts/verify-byteplus.sh  # verifikasi 1 job nyata BytePlus -> test_output/byteplus_verify/
npm run test:worker-container # cek Dockerfile worker; jika Docker ada, build + probe runtime
```

## Container worker (belum dideploy)

`Dockerfile.worker` adalah image terpisah untuk `npm run worker`, bukan web
server. Ia berbasis Debian Bookworm agar paket `python3-opencv` dan
`python3-pil` tersedia stabil untuk QC-09 YuNet dan renderer caption, serta
memasang `ffmpeg`/`ffprobe`. Font Poppins, model YuNet, dan musik dibundel;
proses berjalan sebagai user `racun` (UID 10001). Build lokal opsional:

```bash
docker build --target runtime -t racun-worker:local -f Dockerfile.worker .
```

Runtime worker production kelak memerlukan minimal `RACUN_DB_RUNTIME=postgres`,
`DATABASE_URL`, `RACUN_QUEUE_MODE=redis`, `REDIS_URL`, dan konfigurasi object
storage private. Image ini tidak mengubah deploy atau mode Midtrans.

## Blueprint staging Render (belum production)

Blueprint [`render.yaml`](render.yaml) mendefinisikan **hanya** resource
bernama `racun-ai-staging-*`: web Node, worker Docker, Postgres 16, dan Render
Key Value dalam region Singapore. Semua koneksi database/queue memakai private
network Render; Key Value memblokir akses publik. Web dan worker memakai
PostgreSQL, BullMQ/Redis, dan R2 private, sementara jalur SQLite tetap ada di
kode sebagai rollback lokal.

Sebelum sync Blueprint, hubungkan repository Git ke Render dan isi di Render
(bukan di git) variabel `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, dan
`R2_SECRET_ACCESS_KEY` untuk **kedua** service. Bucket yang dirujuk adalah
`bikinfyp-staging` dan harus tetap private. Tidak ada kredensial atau
nilai rahasia dalam Blueprint.

`preDeployCommand` menjalankan `scripts/migrate-postgres-runtime.mjs`; runner
ini hanya menerima `RACUN_DEPLOY_ENV=staging`, mencatat checksum migrasi, dan
gagal tertutup pada URL non-PostgreSQL. Jangan gunakan untuk production.

Sesudah URL web staging tersedia, jalankan smoke tanpa menyalakan server lokal:

```bash
cd app
BASE_URL=https://<web-staging>.onrender.com bash scripts/smoke-e2e.sh
```

Blueprint mengaktifkan `ALLOW_DEV_LOGIN=1` hanya agar smoke staging dapat
membuat data uji tanpa kredensial pelanggan. Video memakai BytePlus dan OTP
email memakai Resend; `PROVIDER_VOICE=mock` tetap eksplisit karena audio tier
bersuara dihasilkan oleh BytePlus. Itu bukan konfigurasi production;
`MIDTRANS_IS_PRODUCTION` tetap literal `false` pada web dan worker.

## Arsitektur suara FINAL (keputusan 31 Jul 2026) & 3-tier

TTS terpisah (Google/Azure/ElevenLabs/`say`) **tidak dipakai** untuk jalur produksi —
ElevenLabs kalah natural dari audio bawaan Seedance, Azure/Google diputuskan tidak diuji.
Audio diturunkan dari `quality_tier` dan **tidak pernah bisa diubah user**:

| Tier | Harga | Model BytePlus | Audio | COGS (BRD §5.3) |
|---|---:|---|---|---:|
| `silent_caption` | Rp5.000 | `seedance-1-0-pro-fast-251015` 480p | `generate_audio=false` — bisu + caption tersinkron + musik | Rp2.445 |
| `high_quality` | Rp12.000 | `dreamina-seedance-2-0-mini-260615` | `generate_audio=true` (embedded) | Rp8.802 |
| `super_hq` | Rp49.000 | `dreamina-seedance-2-0-260128` | `generate_audio=true` (embedded) | Rp37.164 |

- `VisualSpec.generateAudio` wajib konsisten dengan tier — ditegakkan `assertVisualSpec` di registry.
- Tier bersuara via byteplus: state `GENERATING_VOICE` no-op (audio ikut model); compositor mode `embedded` memakai audio klip.
- Mock **mensimulasikan** arsitektur ini supaya dev/test gratis: silent_caption → shot senyap + caption + musik (sama persis dengan jalur byteplus); tier bersuara → shot senyap + VO `say` sebagai simulasi embedded.
- `google-tts.ts` / `azure-tts.ts` dipertahankan sebagai referensi, TIDAK terdaftar di registry produksi.
- Aturan bahasa tier bersuara (hasil uji): skrip kompak 10–22 kata/15 dtk (validator L-05 per tier; silent 32–48), tanda kurung instruksi dilarang di dialog (L-17), shot planner menaruh dialog dalam tanda kutip + instruksi jeda di luar kutip + "enunciate clearly" untuk nama produk/keyword.

## Mode Senyap + Teks Tersinkron (F-05c)

- `lib/media/captions.ts`: segmen skrip dipecah jadi card 3–5 kata; durasi = kata × faktor (≤0,45 dtk, disesuaikan agar pas jendela segmen), min 0,8 dtk; harga & nama produk di-highlight kuning.
- Render: PNG per card via PIL (`lib/media/render_caption.py`) + overlay FFmpeg ber-timeline `enable='between(t,a,b)'` — pola yang sama dengan overlay lama.
- Musik: `assets/music/bg-loop.m4a` (placeholder disintesis FFmpeg via `scripts/make-music.sh`; **ganti dengan menimpa file itu** dengan track berlisensi bebas).
- Watermark AIGC tetap wajib. Kanvas dinormalisasi ke 720×1280 sebelum overlay (klip 480p di-upscale supaya caption tidak terpotong).

## Provider nyata

| Provider | Aktivasi | Catatan |
|---|---|---|
| **BytePlus ModelArk (video)** | `PROVIDER_VIDEO=byteplus` + isi `BYTEPLUS_ARK_API_KEY` | Task-based: `POST {base}/contents/generations/tasks` → polling `GET .../tasks/{id}` → unduh `content.video_url`. Foto produk = image reference (data URI base64). Model & `generate_audio` dari tier (tabel di atas). Biaya dari `usage.total_tokens` bila tarif token ada, selain tarif/detik (ditandai "estimasi"). Terverifikasi nyata: ~Rp1.304/klip 8 dtk 480p, submit→selesai ±40 dtk/klip. Docs: https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API |

Provider tanpa key → `ProviderNotConfigured` dan registry otomatis failover (urutan konfigurasi duluan; mock tidak bisa menyalip provider nyata yang dikonfigurasi).

## Batas waktu per state (revisi latensi nyata)

Render nyata bisa 4–45 menit saat antrean padat, jadi batas dibuat per-state
(`config.stateTimeoutsMin`, env `TIMEOUT_*_MIN`):

| State | Default | Alasan |
|---|---|---|
| QUEUED | 30 mnt | Antrian kita sendiri — tetap ketat (BR-06.3) |
| GENERATING_VISUAL | 90 mnt | Render model bisa 4–45 mnt × 2 shot |
| GENERATING_VOICE | 30 mnt | TTS cepat |
| COMPOSITING | 20 mnt | FFmpeg lokal |
| QC_CHECK / LABELING | 10 mnt | Probe lokal |

Acuan waktu = kolom `jobs.state_changed_at` (migrasi otomatis untuk DB lama).
UI S5 mengambil teks estimasi jujur dari `GET /api/meta` dan polling tanpa batas
waktu; job pulih dari URL atau `sessionStorage`.

## Kredit (denominasi RUPIAH)

Saldo = rupiah. Hold sebesar harga tier saat job dibuat → capture saat QC lulus →
release saat gagal (ledger append-only). Bonus user baru Rp5.000 (1 video Senyap+Teks).
Paket top-up: 5× Senyap Rp25rb · 10× Senyap Rp50rb · 10× HQ Rp120rb · 5× Super HQ Rp245rb.

## Frontend (fase 2)

Aplikasi mobile-first berbahasa Indonesia di atas API fase 1. Layar (mengikuti `docs/04_Wireframe_Spec.md`):

| Route | Layar |
|---|---|
| `/onboarding` | S0 — nilai produk + login nomor HP |
| `/` | S1 — beranda (BIKIN VIDEO, video terakhir, kartu kredit) |
| `/bikin/produk` | S2 — link + form manual (upload 1–5 foto, preview) |
| `/bikin/gaya` | S3 — format (hands-only), kreator (Hijaber), register, durasi |
| `/bikin/skrip` | S4 — gerbang HITL: 3 varian, editor per segmen, validasi realtime |
| `/bikin/proses` | S5 — polling status + checklist progres |
| `/bikin/hasil` | S6 — pemutar video, unduh, peringatan konten AI |
| `/bikin/paket` | S7 — caption/hashtag salin 1 ketuk, jam posting, checklist aman |
| `/video` | S8 — riwayat (unduh, duplikat & edit) |
| `/kredit` | S9 — saldo, 3 paket top-up (demo), riwayat ledger |

Lintas layar: header + chip kredit (tap → `/kredit`), nav bawah (Beranda/Video/Kredit), indikator 5 titik di alur, konteks alur di `sessionStorage` (`app/_components/flow.ts`), guard `middleware.ts` (belum login → `/onboarding`).

Catatan lingkungan: bila build ffmpeg tidak punya filter `drawtext` (tanpa libfreetype,
seperti build Homebrew tertentu), compositor otomatis fallback merender PNG teks via
ImageMagick (`magick`) + filter `overlay`. Hasil visual setara.

## Variabel env (`.env.local`, contoh di `.env.example`)

| Variabel | Default | Keterangan |
|---|---|---|
| `AUTH_SECRET` | dev default | Kunci HMAC token + signed URL |
| `DB_PATH` | `./data/racun.db` | File SQLite |
| `STORAGE_DIR` | `./storage` | Upload & hasil job |
| `STORAGE_MODE` | `filesystem` | `r2` untuk object storage private; production menolak filesystem |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | kosong | Wajib lengkap saat `STORAGE_MODE=r2`; Cloudflare R2 S3-compatible |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `/opt/homebrew/bin/...` | Wajib ada |
| `PROVIDER_VIDEO` / `PROVIDER_VOICE` | `mock` | Provider aktif |
| `MOCK_A_FAIL` / `MOCK_VOICE_A_FAIL` | `0` | Saklar uji failover |
| `BYTEPLUS_ARK_API_KEY`, `GOOGLE_TTS_API_KEY`, `AZURE_TTS_KEY` + `AZURE_TTS_REGION` | kosong | Provider nyata — kosong = `ProviderNotConfigured` + failover ke mock (lihat bagian "Provider nyata") |
| `LLM_API_KEY` | kosong | Opsional; mesin skrip fallback template deterministik |
| `RESEND_API_KEY` | kosong | OTP email via Resend — kosong = mode mock (`[otp-mock]` di log, hanya non-production) |
| `RESEND_FROM_EMAIL` | `onboarding@resend.dev` | Pengirim email OTP (sandbox Resend; ganti domain terverifikasi saat produksi) |
| ~~`WA_OTP_PROVIDER`, `FONNTE_API_KEY`, `WATZAP_*`~~ | — | TIDAK DIPAKAI, diganti email 31 Jul 2026 |
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` | kosong | Kosong = checkout 503 jelas |
| `MIDTRANS_IS_PRODUCTION` | `false` | **JANGAN true sebelum Brian bilang siap** (default sandbox) |
| `ALLOW_DEV_LOGIN` | `0` | Buka jalur dev di production (dev-login, topup instan, webhook stub) — tidak disarankan |

## Auth (OTP WhatsApp) & Pembayaran (Midtrans)

- `POST /api/auth/request-otp {email}` — kode 6 digit via **email** (Resend `POST api.resend.com/emails`; jalur OTP WhatsApp diganti penuh 31 Jul 2026). Hanya HASH (sha256+salt) yang disimpan di `otp_codes`, expiry 5 menit, rate limit 3 kirim/email/15 menit (429). `RESEND_API_KEY` kosong → mode mock (kode ke log server `[otp-mock]`, dev saja). Untuk sandbox/testing Resend: `RESEND_FROM_EMAIL=onboarding@resend.dev` (pengirim domain resmi Resend untuk akun baru; ganti ke domain terverifikasi saat produksi).
- `POST /api/auth/verify-otp {email, code}` — maks 5 attempts per kode (lalu locked, minta baru); sukses → cookie token (sama seperti dev-login). dev-login lama hanya aktif di non-production / `ALLOW_DEV_LOGIN=1` (403 di production).
- `POST /api/credits/checkout {package_id}` → `{order_id, snap_token, redirect_url}` (Midtrans Snap, sandbox default). Row `payments` pending dibuat dulu.
- `POST /api/webhooks/midtrans` — **verifikasi signature WAJIB**: `sha512(order_id+status_code+gross_amount+SERVER_KEY)`; salah → 401 tanpa side effect. `settlement`/`capture(+accept)` → kredit via `creditTopup` (idempoten via `gateway_ref=order_id`); `deny`/`cancel`/`expire` → status failed tanpa kredit.
- `GET /api/orders/:orderId` — status order untuk tombol "Sudah bayar? Cek status".
- `/api/webhooks/payment` (stub tanpa verifikasi) & `/api/credits/topup` (instan) — digembok di belakang flag yang sama dengan dev-login; WAJIB mati di production.

## API ringkas (SRS §6.1)

- `POST /api/auth/request-otp {email}` · `POST /api/auth/verify-otp {email, code}` → cookie token · `GET /api/auth/me`
- `POST /api/auth/dev-login {phone}` (DEV ONLY — 403 di production)
- `POST /api/products` (multipart `photos` atau JSON `images_base64`) · `POST /api/products/extract {url}` (stub + anti-SSRF)
- `POST /api/scripts/generate {product_id, register, emotion, format}` → 3 varian
- `POST /api/scripts/:id/approve {segments?, edited?}` — gerbang HITL
- `POST /api/jobs {script_id, persona_id?, format, duration_s}` → 422 `SCRIPT_NOT_APPROVED` bila belum approve
- `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/output` (signed URL 1 jam)
- `GET /api/credits` · `POST /api/credits/checkout {package_id}` → Snap · `POST /api/webhooks/midtrans` (signature wajib) · `GET /api/orders/:orderId`
- DEV ONLY: `POST /api/credits/topup` · `POST /api/webhooks/payment` (403 di production)

Semua error berformat `{code, message_id, message_en, retryable}` — `message_id` Bahasa Indonesia dan actionable.

## Aturan keras yang ditegakkan di kode

1. **Audio diturunkan dari tier, bukan user** — `VisualSpec.generateAudio` wajib `=== (qualityTier !== 'silent_caption')`; ditegakkan `assertVisualSpec` di registry. Tier bersuara = audio embedded model (keputusan final 31 Jul); TTS terpisah tidak dipakai.
2. **Abstraksi provider** — `VideoProvider`/`VoiceProvider`, 2 provider mock aktif + 4 stub nyata; failover otomatis (uji: set `MOCK_A_FAIL=1`).
3. **Produk asli = image reference** — prompt ke model video wajib menyertakan `no text, no logo, no writing` (divalidasi runtime); semua teks via overlay FFmpeg.
4. **Label "Dibuat dengan AI"** — dibakar ke frame di compositor; tidak ada flag/endpoint untuk mematikannya; diverifikasi QC-08.
5. **HITL** — `POST /api/jobs` menolak 422 bila `approved_by_user_at IS NULL`.
6. **Kata terlarang** — dicek 2x: validator saat generate (strict) + saat submit render & QC-07 (L-10/L-11 keras selalu).
7. **Kredit** — hold → capture (QC lulus) → release (gagal). `credit_ledger` append-only; saldo = agregat.

## Keputusan arsitektur MVP & penggantinya saat produksi

| MVP | Produksi |
|---|---|
| SQLite (`better-sqlite3`) | PostgreSQL |
| Antrian in-process (`lib/worker.ts`, FIFO konkurensi 1) | BullMQ/Redis + worker pool |
| Disk lokal `storage/` + signed URL HMAC | R2 private S3-compatible + proxy URL HMAC |
| Provider mock (FFmpeg zoompan + `say`/sinus) | BytePlus ModelArk / DashScope (video), Google/Azure TTS (voice) |
| Dev login tanpa OTP | OTP SMS sungguhan / OAuth Google |
| Dev topup & webhook stub | Payment gateway QRIS berlisensi |
| Metadata AIGC sederhana | Manifest C2PA penuh (c2patool) |
| QC-02/03/04/05/07/08 nyata; QC-01/06 stub | Model CV/audio untuk lip-sync dan OCR penuh; QC-02 memakai guard siluet tangan OpenCV yang konservatif, bukan landmark model |

## Struktur

```
app/api/            route handlers (runtime nodejs)
lib/config.ts       env & konstanta
lib/db.ts schema.sql  SQLite + skema SRS §5
lib/script-engine/  templates H1..H16, validator L-01..L-16, caption
lib/providers/      types, registry failover, mock/, stubs/
lib/media/          shot-planner, compositor (FFmpeg), qc
lib/jobs.ts worker.ts  state machine + antrian
lib/credits.ts      ledger append-only hold/capture/release
scripts/seed.ts     data demo
scripts/smoke-e2e.sh  bukti jalan end-to-end
tests/              unit test (node --test via tsx)
```
