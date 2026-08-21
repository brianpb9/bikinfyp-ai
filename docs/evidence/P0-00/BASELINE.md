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

Pada `933c79a`, `npm test` melaporkan **26 skip**. Ketiganya berbeda sebab, dan
sebabnya menentukan apakah ia utang atau bukan:

| Jumlah | Berkas | Gerbang | Status SEBENARNYA |
|---:|---|---|---|
| 11 | `tests/pg-konkurensi-kredit.test.ts` | `UJI_PG_URL` kosong | **DIJALANKAN 22 Agu: 11 test, 11 lulus, 0 skip** di PostgreSQL nyata, database sekali pakai |
| 12 | `tests/pg-product-truth-w1.test.ts` | `UJI_PG_URL` kosong | **DIJALANKAN 22 Agu: 12 test, 12 lulus, 0 skip** — `npm run test:postgres-product-truth-w1` |
| 3 | `tests/qcf1-tiga-keadaan.test.ts` | `UJI_QCF1_NYATA=1` | **BERBAYAR** — satu panggilan vision ~Rp12 per test. Butuh izin Founder; tidak dijalankan |

Jadi 23 dari 26 skip kini terbukti hijau di runtime yang seharusnya, dan sisa 3
adalah gerbang biaya yang memang disengaja — bukan cakupan yang hilang.

**Cara menjalankan** (keduanya butuh PostgreSQL loopback):

```
npm run test:pg                              # 11 konkurensi uang (butuh UJI_PG_URL)
npm run test:postgres-product-truth-w1       # 12 kontrak referensi W1
```

**Satu kerapuhan yang ditemukan saat inventaris ini, dan TIDAK diperbaiki di
sini karena memindahkan fixture adalah keputusan tersendiri:**
`tests/qcf1-tiga-keadaan.test.ts:19` menunjuk fixture di
`/tmp/bikinfyp-audit.r8g5CW/c-no-face-2.5.png`. Berkas itu ada sekarang, tapi
`/tmp` dibersihkan saat reboot — begitu ia hilang, ketiga test itu akan
melewati diri sendiri SELAMANYA tanpa satu pun tanda, dan cara gagalnya persis
sama dengan "dilewati karena berbayar". Fixture yang menentukan cakupan
seharusnya tinggal di dalam repo.

## Yang TIDAK dilakukan (sesuai perintah)

- Tidak push ke `main`.
- Tidak force-push.
- Tidak deploy.
- Tidak membuka intake atau payment.
