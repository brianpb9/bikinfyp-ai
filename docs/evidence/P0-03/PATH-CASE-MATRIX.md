# P0-03 — PATH × CASE MATRIX

BASE_SHA=8ef9fdede97d1c4a72861dbf64c122c33272524e
BRANCH=work/p0-product-truth-20260820
TIMESTAMP=2026-08-20
METODE=call-site search read-only (Route Mapper subagent), BUKAN daftar handover
STATUS=inventaris SELESAI · red-before tests BELUM DITULIS

## A. Inventaris entrypoint — dari call-site nyata

Setiap baris punya `file:line`. GATED = memanggil pemeriksaan label/merek DAN
kelayakan. PARTIAL = sebagian. UNGATED = tidak sama sekali.

| # | file:line | jalur | status | memanggil |
|---|---|---|---|---|
| E1 | `app/api/products/route.ts:15` | POST create manual (retail) | **PARTIAL** | `saveProductImages` (sidecar ditulis); TANPA `periksaLabelFoto`, TANPA `referensiLayak` |
| E2 | `app/api/products/extract/route.ts:17` | POST extract URL → buat produk | **UNGATED** | tidak ada; pakai `downloadProductImages` |
| E3 | `app/api/products/[id]/route.ts:13` | PATCH nama/harga/kategori/brand | **UNGATED** | tidak ada — memutasi `name` + `raw_meta.brand`, dua input yang justru dibaca gerbang |
| E4 | `app/api/products/[id]/photos/route.ts:44` | POST add-photo (retail) | **PARTIAL** | `periksaLabelFoto`+`merekTerdaftar` (:91), `referensiLayak` (:116). TIGA lubang: gerbang label hanya jalan bila `existing.length===0` (:84); `periksaLabelFoto` FAIL-OPEN saat OCR gagal (`label-terbaca.ts:188` mengembalikan `terbaca:true`); hash sidecar tidak pernah diverifikasi ulang terhadap isi berkas |
| E5 | `app/api/products/[id]/photos/route.ts:142` | DELETE foto (retail) | **UNGATED** | tidak ada — bisa menghapus satu-satunya foto layak |
| E6 | `app/api/dashboard/campaign/product/route.ts:45` | POST produk org | **UNGATED** | tidak ada; `downloadProductImages` → sidecar tidak ditulis |
| E7 | `app/api/dashboard/campaign/product/route.ts:99` | PATCH produk org | **UNGATED** | mengubah `name`, `price`, **`category`**, visual desc, `brand_brief`, promo, claims (:113 dst) TANPA revalidasi. TIDAK menyentuh `raw_meta.brand`. Defect kedua: jalur org TIDAK PERNAH mengisi `raw_meta.brand`, padahal worker hanya mempercayai field itu (`merekTepercaya`) |
| E8 | `app/api/dashboard/campaign/product/[id]/photos/route.ts:26` | POST add-photo (org) | **PARTIAL** | `periksaLabelFoto` (:52) TANPA argumen `merekTerdaftar` → `cocokMerek` tidak pernah diperiksa; `saveUniqueProductImages` (:59) TIDAK menulis sidecar |
| E9 | `app/api/dashboard/campaign/product/[id]/photos/route.ts:84` | DELETE foto (org) | **UNGATED** | tidak ada |
| W1 | `lib/postgres/worker.ts:321-323` | worker PG pilih `images[0]` | **UNGATED** | tidak ada; `personSafeReferencePhotos` (:338) hanya soal orang |
| W2 | `lib/worker.ts:104-109` | worker inline/SQLite pilih `images[0]` | **UNGATED** | **anggap REACHABLE sampai ditutup struktural**: `enqueueJob`/`enqueueJobResume` (`lib/job-queue.ts:67`) masih bisa memilih inline tanpa memanggil `assertQueueConfiguration`. Wajib diuji C1, C3, C8 |
| A1 | `app/api/jobs/route.ts:29,62-67` | admission retail + payload | **UNGATED** | payload tanpa validasi gambar |
| A2 | `app/api/dashboard/matrix/route.ts:93,106` | admission matrix | **UNGATED** | cek gambar hanya "ada/tidak" |
| A3 | `app/api/dashboard/campaign/generate/route.ts:44-49` | generate campaign | **UNGATED** | cek `length===0` saja |
| A4 | `lib/dashboard/render-cell.ts:158-160,225` | INSERT QUEUED + enqueue | **UNGATED** | tidak ada |
| A5 | `app/api/dashboard/campaign/confirm/route.ts:45` | confirm campaign → enqueue | **UNGATED** | tidak ada |
| A6 | `app/api/dashboard/campaign/job/[jobId]/route.ts:128,164,283` | approve / regenerate job | **UNGATED** | tidak ada — bisa memilih ulang referensi |
| A7 | `app/api/scripts/generate/route.ts` | generate naskah (provider-consuming, BUKAN admission render berbayar) | **UNGATED** | tidak ada |
| D1 | `lib/postgres/product-persona-script.ts:57,112,134-136,255,264` | penulis DB produk/brand | **UNGATED** | tidak ada |
| D2 | `lib/postgres/smoke-runtime.ts:310,319,336` | set/append/remove images | **UNGATED** | tidak ada |

**Terbukti TIDAK ADA** (jangan dibuatkan test): route reorder foto
(`rg reorder app/api` → 0), DELETE produk (`export async function DELETE` di
`products/[id]/route.ts` → 0), server actions (`rg '"use server"' app/` → 0),
`app/api/dashboard/bulk/route.ts` (tidak ada berkasnya; masih disebut komentar
`lib/product-image-download.ts:3`).

## B. Temuan yang MENGOREKSI work order

Work order menyebut tiga bypass (create utama, extract, worker). Yang nyata:

1. **`referensiLayak` menjaga TEPAT SATU entrypoint** (E4). Delapan lainnya
   tidak pernah memanggilnya.
2. **Dua worker, bukan satu.** `lib/worker.ts` (inline/SQLite) juga memilih
   `images[0]` dan masih reachable.
3. **Jalur org tidak menulis sidecar sama sekali** (`saveUniqueProductImages`).
   `backfillMetaGambar` SAAT INI tidak pernah dipanggil pada jalur org: satu-
   satunya pemanggilnya ada di dalam `referensiLayak`, yang jalur org tidak
   pernah panggil.
4. **PATCH produk (E3, E7) bisa mengganti nama DAN kategori** — dua input yang
   dibaca gerbang — tanpa revalidasi. E7 TIDAK mengubah `raw_meta.brand`;
   masalah brand di jalur org adalah field itu tidak pernah diisi sejak awal.
5. **DELETE foto (E5, E9) bisa menyisakan daftar berisi promo saja.**
6. **Gerbang label E4 hanya jalan pada foto PERTAMA** (`existing.length===0`),
   jadi banner yang diunggah sebagai foto kedua tidak pernah diperiksa label.

## C. Matriks kasus × jalur

Kolom status: RED = test ditulis dan gagal karena invariant belum ada.
Semua masih `PENDING` — belum satu pun test ditulis.

**JANGAN membuat matriks Cartesian** (kasus x seluruh entrypoint). Arsitektur test berlapis:
1. unit contract untuk invariant pusat;
2. integration per KELUARGA ingestion/mutation (bukan per route);
3. test di tiap admission/provider-consuming boundary;
4. defensive worker test untuk W1 dan W2;
5. E2E lokal/mocked untuk C1 dan C8.

| # | Kasus | Jalur wajib diuji | Keputusan diharapkan | reason code (usul) | Status |
|---|---|---|---|---|---|
| C1 | Foto#1 banner, foto#2 packshot valid | E1,E2,E4,E6,E8,A1..A5,**A6**,W1,W2 | **produk DITERIMA**; foto#1 berstatus promotional; approved reference WAJIB foto#2 + hash-nya. **A6 (approve/regenerate) wajib MEMPERTAHANKAN snapshot** — ia membangunkan worker lagi. `REF_PROMOTIONAL` adalah STATUS FOTO, bukan penolakan produk | `REF_PROMOTIONAL` (status) | PENDING |
| C2 | Toothpaste diberi kategori facewash | E1,E3,E6,E7,A1..A4 | reject sebelum spend | `TYPE_MISMATCH` | PENDING |
| C3 | Merek salah | E1,E4,E8,W1,**W2** | reject | `BRAND_MISMATCH` | PENDING |
| C4 | Label gibberish / tak terbaca | E1,E4,E8 | reject | `LABEL_UNREADABLE` | PENDING |
| C5 | Kategori unknown/ambigu/bundle | E1,E3,E6,E7 | manual review | `CATEGORY_UNKNOWN` | PENDING |
| C6 | OCR timeout/error/ambigu | E1,E4,E8 | fail-closed | `OCR_FAILED` | PENDING |
| C7 | Classifier timeout/error/ambigu | E1,E4,E8 | fail-closed | `CLASSIFIER_FAILED` | PENDING |
| C8 | Evidence hilang/korup/basi/hash beda | E1,**E2**,**E4**,E6,E8, mutation boundary **E3/E5/E7/E9** (stale evidence), **A1..A7**,W1,W2 | fail-closed sebelum hold/capture/**regen**/enqueue/provider/deliverable; tanpa sisa state invalid persisten. Untuk A6 khusus: buktikan **nol ledger `regen`** | `EVIDENCE_INVALID` | PENDING |
| C9 | Foto/nama/brand/kategori berubah SESUDAH admission | E3,E5,E7,E9 → W1,W2 | job pakai snapshot lama | `SNAPSHOT_IMMUTABLE` | PENDING |
| C10 | Produk legacy tanpa evidence | W1,W2,A1..A4 | karantina | `LEGACY_UNVALIDATED` | PENDING |
| C11 | Berkas referensi hilang saat worker mulai | W1,W2 | fail-closed, tanpa capture | `REF_MISSING` | PENDING |
| C12 | Urutan images diubah/dirusak | E5,E9,W1,W2 | pakai hash tersetujui | `REF_HASH_MISMATCH` | PENDING |
| C13 | **Produk valid** (positif) | seluruh E,A,W | DITERIMA | — | PENDING |

Tiap penolakan wajib membuktikan: reason code stabil, pesan bisa ditindaklanjuti,
**nol** credit hold/capture, **nol** enqueue, **nol** panggilan provider,
**nol** deliverable, **nol** efek storage.

## C-bis. KONTRAK HASH (ditetapkan, sudah diimplementasikan)

SHA-256 dihitung dari **bytes yang benar-benar disimpan di storage**, bukan
unggahan asli sebelum normalisasi WebP.

Cacat yang ditutup: `lib/product-images.ts` meng-hash `blobs[i].data` sementara
yang ditulis adalah `normalized ?? blobs[i].data`. Selama normalisasi berhasil
— kasus normal — sidecar membawa hash yang tidak pernah cocok dengan berkasnya,
sehingga verifikasi hash C8 akan menolak SETIAP foto yang sah.

Test regresi `tests/kontrak-hash-sidecar.test.ts`, dibuktikan merah tanpa
perbaikan (`git stash` → 0 lulus / 1 gagal) dan hijau dengannya. Diperkuat
terhadap kelulusan HAMPA: ia menuntut keluaran benar-benar `.webp` DAN bytes
tersimpan berbeda dari unggahan — tanpa keduanya, normalisasi yang diam-diam
gagal akan membuat hash lama ikut cocok. Storage sementara dibersihkan `after`.

Stabilitas suite: dijalankan DUA kali berturut-turut pada SHA ini, keduanya
810 / 796 lulus / 0 gagal / 14 skip, keduanya exit 0.

## D. Yang BELUM diverifikasi

- Belum ada red-before test boundary C1/C8. (Test kontrak hash sidecar SUDAH
  ada dan hijau, tapi ia bukan boundary test C1/C8.)
- Reason code di atas adalah USULAN, belum ada di kode.
- Jalur promo (`lib/promo/worker.ts`, `app/api/promo/jobs/route.ts`) sengaja
  di luar cakupan: pipeline terpisah tanpa tabel produk. Perlu keputusan apakah
  ikut Product Truth — belum diputuskan siapa pun.
