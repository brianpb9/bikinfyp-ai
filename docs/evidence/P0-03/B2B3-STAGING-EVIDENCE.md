# P0-B2/B3 — bukti staging: apa yang BISA diukur, dan apa yang ternyata tidak

TASK=P0-B2B3-STAGING-EVIDENCE-20260822
TANGGAL=2026-08-22
SIFAT=**HANYA BACA** — nol deploy, nol restart, nol migrasi, nol tulis, nol
render berbayar. Seluruh perintah di bawah adalah pembacaan.

## Ringkasan satu kalimat

**Staging tidak bisa menjawab pertanyaan T43, karena staging tertinggal ~398
commit (18 hari) di belakang pekerjaan product-truth — seluruh instrumentasi
yang dibangun untuk menjawabnya belum pernah ada di sana.**

## 1. Identitas service dan deploy AKTIF (tanpa membuat deploy)

| Service | id | runtime | SHA hidup | Selesai |
|---|---|---|---|---|
| `racun-ai-staging-web` | `srv-d9n28tijnfac73a87lt0` | **node** | `5fe53f2` | 2026-08-09T02:40:15Z |
| `racun-ai-staging-worker` | `srv-d9n28ue417fc73ch2b60` | docker | `78d8468` | 2026-08-11T11:57:32Z |

Perintah: `render services --output json --confirm`,
`render deploys list <service-id> --output json --confirm` (keduanya baca).

Kedua SHA bertanggal **2026-08-04**. Jarak ke HEAD:

```
5fe53f2..HEAD  = 398 commit
78d8468..HEAD  = 402 commit
```

Dan yang menentukan:

```
0028850 (probe kapabilitas) leluhur build web hidup?  TIDAK
38466a3 (gerbang P0)        leluhur build web hidup?  TIDAK
```

## 2. `/api/health` staging — DIBACA, dan hasilnya bukan jawaban

```
2026-08-22T12:42:26Z
curl -sS -m 45 https://racun-ai-staging-web.onrender.com/api/health
-> HTTP 200
   {"ok":true,"intake":"open"}
```

Blok `klasifikasi` **tidak ada**. Itu bukan berarti runtime web tidak mampu —
itu berarti **probe-nya belum di-deploy**. `/api/health` di HEAD mengembalikan
`klasifikasi` (`app/api/health/route.ts:68,80`), ditambahkan di `0028850`, dan
`0028850` bukan leluhur build yang hidup.

Bentuk respons staging bahkan lebih kecil daripada versi pra-`0028850`, yang
sudah memuat `payments_provider`/`payments_env`/SHA build — konsisten dengan
build 4 Agustus.

**KAPABILITAS KLASIFIKASI RUNTIME WEB = BELUM TERUKUR.** Menjawabnya butuh
deploy, dan deploy DILARANG di lingkup tugas ini.

## 3. Datastore staging — teridentifikasi, audit TIDAK dijalankan

| Resource | id | database | status |
|---|---|---|---|
| `racun-ai-staging-postgres` | `dpg-d9n21fnlk1mc73djm8q0-a` | `racun_staging` | available |

Audit P0-B3 **tidak dijalankan**, dan alasannya bukan kehati-hatian saja —
alatnya memang tidak bisa dijalankan dari sini:

1. **Butuh DATABASE_URL staging.** Di blueprint ia di-inject Render
   (`fromDatabase`), tidak ada di mesin ini. Diperiksa: `DATABASE_URL`,
   `UJI_PG_URL` kosong.
2. **Butuh kredensial R2 juga.** Ini yang mudah terlewat: audit memakai
   `resolveApprovedReference`, dan resolver membaca sidecar DAN bytes dari
   object storage (`lib/product-truth.ts:256,295`). Tanpa R2, setiap foto akan
   dilaporkan `SIDECAR_MISSING`/`REF_MISSING` — angka yang **tampak** seperti
   kerusakan legacy padahal hanya kerusakan akses. Menjalankannya setengah
   berkredensial LEBIH BURUK daripada tidak menjalankannya.
3. **Angkanya pun akan menyesatkan.** Produk di `racun_staging` dibuat oleh kode
   4 Agustus — sebelum satu pun jalur ingestion menerbitkan sidecar. Cacah
   "kerusakan" di sana mengukur ketiadaan fitur, bukan kerusakan legacy
   produksi.

Tidak ada angka empat ember yang dilaporkan. Mengarangnya dilarang, dan
menurunkannya dari akses setengah jadi sama saja dengan mengarang.

## 4. Kanari P0-B4 — tidak ada log, dan tidak mungkin ada

Kanari (`lib/kanari-bukti.ts`) masuk di gelombang ini, jauh sesudah `5fe53f2`.
Worker staging (`78d8468`) juga mendahuluinya. Tidak ada baris `[kanari-bukti]`
yang bisa dibaca dari deploy mana pun saat ini.

## 5. Bukti sifat hanya-baca

- Perintah yang dijalankan hanya: `curl` GET, `render services/deploys/postgres
  list` (subperintah baca).
- Nol `render deploy`, nol `render restart`, nol `psql`, nol koneksi database.
- `/api/meta` dicoba dan mengembalikan **401 UNAUTHORIZED** — dicatat apa adanya
  sebagai batas akses, bukan dilewati diam-diam.
- Repo tidak disentuh selain dokumen ini.

## 6. Yang ini ubah untuk T43

Sebelum ini, "deploy staging lalu baca /api/health" terdengar seperti satu
langkah kecil. Ternyata bukan: staging bukan sekadar belum di-deploy ulang, ia
**398 commit tertinggal**. Men-deploy-nya berarti memindahkan 18 hari perubahan
sekaligus ke lingkungan yang belum pernah menjalankannya — termasuk
`preDeployCommand: node scripts/migrate-postgres-runtime.mjs`, yaitu **migrasi
schema**, yang dilarang keras di lingkup tugas ini dan bukan tindakan yang boleh
diputuskan Builder.

Jadi prasyarat T43 tetap belum terpenuhi, dan penghalangnya sekarang punya nama
dan angka, bukan lagi "butuh akses".
