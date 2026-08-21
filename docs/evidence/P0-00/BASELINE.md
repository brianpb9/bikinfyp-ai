# P0-00 — Baseline diselamatkan (20 Agu 2026)

## Identitas

| | |
|---|---|
| HEAD lokal | `fe49eca77457d9b726ec461f518ab7b0d6378ccb` |
| origin/main (live) | `00ee62efd86ae7e10453a2a1896e63b62228aa4d` |
| Selisih | 20 commit, 52 berkas, +3323 / −80 |
| Worktree | bersih (`git status --porcelain` kosong) |
| Branch backup | `backup/review-20260820-fe49eca` |

Verifikasi remote menunjuk SHA yang benar:

```
fe49eca77457d9b726ec461f518ab7b0d6378ccb  refs/heads/backup/review-20260820-fe49eca
```

`origin/main` SESUDAH push tetap `00ee62e` — tidak bergerak.

## Kenapa branch ini tidak men-deploy

Dibaca dari Render API, bukan diasumsikan:

```
bikinfyp-ai-production-web    | branch: main | autoDeploy: yes
bikinfyp-ai-production-worker | branch: main | autoDeploy: yes
```

Keduanya hanya mengikuti `main`. Branch `backup/review-*` tidak diawasi, jadi
push ini tidak memicu deploy. Tidak ada force-push; branch baru, bukan menimpa.

## Secret scan

Dua pemeriksaan atas isi 20 commit:

1. Pola literal (`api_key|secret|password|token|bearer|PRIVATE KEY` diikuti nilai
   ≥16 karakter) di seluruh diff → **nol temuan**.
2. Nama berkas berisiko (`.env`, `.pem`, `.jks`, `.keystore`, `credential`) →
   **nol berkas**.

`.env.local` terlindung `.gitignore:10` (`.env*`).

## Baseline test/build

Dari jalankan terakhir sebelum P0-00, pada pohon yang sama:

- `npx tsc --noEmit` — bersih
- `npm test` — **809 total / 795 lulus / 0 gagal / 14 skip**

**BELUM diverifikasi (saat baseline ini ditulis):** 14 skip belum
diinventarisasi satu per satu, dan reviewer sudah menandai bahwa skip tidak
boleh dihitung PASS. Baseline ini mencatat angkanya apa adanya, bukan
menyebutnya hijau. Build produksi juga belum dijalankan ulang pada SHA ini di
sesi ini.

### Inventaris skip — DITUTUP 22 Agu 2026

Dikerjakan karena seluruh item P0 tertahan keputusan Founder atau akses
eksternal, sehingga item penerimaan inilah yang berikutnya menurut urutan
prioritas. Skip yang tidak pernah dibuka adalah lubang cakupan yang TIDAK
TERLIHAT: `npm test` hijau, dan tidak ada yang tahu apa yang tidak dijalankan.

Pada `933c79a`, `npm test` melaporkan **26 skip** (angka ini sudah berubah
lagi sejak — lihat `2a4ee10`/`fbb7337`/dst; jumlah persisnya bergerak seiring
test baru ditambahkan, jadi jangan kutip 26 sebagai konstanta). Ketiganya
berbeda sebab, dan sebabnya menentukan apakah ia utang atau bukan:

| Jumlah | Berkas | Gerbang | Status SEBENARNYA |
|---:|---|---|---|
| 11 | `tests/pg-konkurensi-kredit.test.ts` | `UJI_PG_URL` kosong (jalur lama) | **REKONFIRMASI 22 Agu: 11 test, 11 lulus, 0 skip** di PostgreSQL nyata, database sekali pakai, lewat `npm run test:pg` (sekarang wrapper disposable — lihat catatan di bawah) |
| 12 | `tests/pg-product-truth-w1.test.ts` | `UJI_PG_URL` kosong (jalur lama) | **DIJALANKAN 22 Agu: 12 test, 12 lulus, 0 skip** — `npm run test:postgres-product-truth-w1` |
| 3-4 | `tests/qcf1-tiga-keadaan.test.ts` | campuran — lihat rincian di bawah | **SEBAGIAN berbayar, SEBAGIAN cuma butuh fixture** |

Jadi 23 dari skip yang tercatat saat itu terbukti hijau di runtime yang
seharusnya. Klaim awal saya "3 gerbang berbayar" untuk QCF1 TIDAK TEPAT — sudah
dikoreksi:

**Koreksi #1 — riwayat PG, bukan "pertama kali dijalankan".** Kalimat
sebelumnya di dokumen ini tersirat seolah 22 Agu adalah PERTAMA KALI kesebelas
test PG dijalankan. Salah: riwayat commit mencatat jalan PostgreSQL sebelumnya
(termasuk `1adfcb0`) yang sudah membuktikan kesebelas test itu — 10 di
antaranya menjaga invarian keuangan/konkurensi, dan satu (funnel event) adalah
persistensi analitik, bukan invarian uang. 22 Agu adalah REKONFIRMASI pada
database disposable dengan wrapper yang lebih aman (lihat Koreksi #3), bukan
eksekusi perdana.

**Koreksi #2 — QCF1 punya EMPAT gerbang, bukan tiga, dan tidak semuanya
berbayar.** `tests/qcf1-tiga-keadaan.test.ts` punya empat test yang digerbangi:
tiga memang `skip: !(adaArtefak && adaKunci)` atau `!adaArtefak || !adaKunci`
(butuh `GEMINI_API_KEY` DAN `UJI_QCF1_NYATA=1` — berbayar), tapi SATU
(`"OCR pada frame palsu NYATA menolak mereknya — tanpa jaringan"`, baris 74)
hanya `skip: !adaArtefak` — TIDAK butuh kunci berbayar sama sekali, hanya
fixture. Hari ini (fixture ADA) ia benar-benar berjalan, jadi npm test
melaporkan 3 skip QCF1. Kalau fixture-nya hilang (lihat kerapuhan di bawah —
BELUM diperbaiki), jadi EMPAT skip, dan satu di antaranya BUKAN gerbang biaya
yang disengaja — ia cakupan yang hilang menyamar sebagai gerbang biaya.
Jangan sebut "3 gerbang berbayar" tanpa embel-embel ini.

**Koreksi #3 — biaya ~Rp12 adalah ESTIMASI INTERNAL, bukan billing
terverifikasi, dan bisa sampai 9 request per test.** Kode QC-frame
mengizinkan HINGGA TIGA percobaan provider per test (retry), jadi satu test
yang gagal dua kali sebelum berhasil bisa memicu sampai 3 panggilan vision —
dan dengan tiga test berbayar, itu hingga 9 panggilan total, bukan 3. Angka
Rp12/panggilan tidak pernah diverifikasi lewat invoice/dashboard billing
sungguhan di dokumen ini — ia estimasi yang diwariskan dari komentar kode,
diberi label seadanya. Jangan mengutip "~Rp12/test" atau "nol gap cakupan"
tanpa bukti harga dan runtime terverifikasi.

**Cara menjalankan** (keduanya butuh PostgreSQL loopback):

```
npm run test:pg                              # 11 konkurensi uang — SEKARANG wrapper disposable, lihat di bawah
npm run test:postgres-product-truth-w1       # 12 kontrak referensi W1
```

**Koreksi #4 — `test:pg`/`gate:uang` TIDAK LAGI menerima `UJI_PG_URL`
sembarangan.** Sebelum ini, kedua perintah menerima URL PostgreSQL APA PUN
lewat `UJI_PG_URL` lalu langsung memasukkan data uji (users/products/jobs/
ledger/events) ke dalamnya — TANPA penjaga loopback dan TANPA siklus
create/migrate/drop. Kalau `UJI_PG_URL` kebetulan menunjuk database
bersama/remote, gate ini bisa mencemarinya diam-diam. Sekarang `npm run
test:pg` memanggil `scripts/test-postgres-konkurensi-kredit.sh`, yang mengikuti
konvensi `test-postgres-product-truth-w1.sh`: database sekali pakai per jalan,
dibuat lalu di-DROP di trap EXIT, dan `postgres-local.sh` menolak host
non-loopback. CI tetap kompatibel: skrip menghormati `DATABASE_URL` yang sudah
diisi (job `konkurensi-uang` di `.github/workflows/ci.yml` menyediakannya) dan
membuat database disposable-nya DI ATAS server yang sama, bukan mengganti
servernya. Bentuk lama (URL apa pun, tanpa penjaga) masih ada di
`npm run test:pg:url-arbitrer-TIDAK-AMAN` untuk keperluan debug lokal —
namanya sengaja mengancam, jangan dipakai di CI atau gate rilis.

**Satu kerapuhan yang ditemukan saat inventaris ini, dan MASIH TIDAK
diperbaiki di sini karena memindahkan fixture adalah keputusan tersendiri:**
`tests/qcf1-tiga-keadaan.test.ts:19` menunjuk fixture di
`/tmp/bikinfyp-audit.r8g5CW/c-no-face-2.5.png`. Berkas itu ada sekarang, tapi
`/tmp` dibersihkan saat reboot — begitu ia hilang, KEEMPAT test itu (bukan
cuma yang berbayar — lihat Koreksi #2) akan melewati diri sendiri SELAMANYA
tanpa satu pun tanda, dan cara gagalnya persis sama dengan "dilewati karena
berbayar". Fixture yang menentukan cakupan seharusnya tinggal di dalam repo,
dan absennya seharusnya GAGAL KERAS, bukan skip senyap.

## Yang TIDAK dilakukan (sesuai perintah)

- Tidak push ke `main`.
- Tidak force-push.
- Tidak deploy.
- Tidak membuka intake atau payment.
