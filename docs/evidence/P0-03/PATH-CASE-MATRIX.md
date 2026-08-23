# P0-03 — PATH × CASE MATRIX

BASE_SHA=8ef9fdede97d1c4a72861dbf64c122c33272524e
BRANCH=work/p0-product-truth-20260820
TIMESTAMP=2026-08-20
METODE=call-site search read-only (Route Mapper subagent), BUKAN daftar handover
STATUS (20 Agu, historis)=inventaris SELESAI · red-before tests BELUM DITULIS
STATUS (23 Agu)=**direkonsiliasi terhadap e8a00a5 — lihat bagian E di bawah.**
Kolom Status pada tabel C sudah diperbarui; bagian A dan D di bawah dibiarkan
apa adanya sebagai catatan 20 Agu, dan dikoreksi di E.1 dan E.3.

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

Per 20 Agu semua `PENDING` — belum satu pun test ditulis. **Kolom Status kini
sudah direkonsiliasi terhadap e8a00a5** (23 Agu); alasan tiap nilai ada di
bagian E.2, dan arti tiap status di E.0.

**JANGAN membuat matriks Cartesian** (kasus x seluruh entrypoint). Arsitektur test berlapis:
1. unit contract untuk invariant pusat;
2. integration per KELUARGA ingestion/mutation (bukan per route);
3. test di tiap admission/provider-consuming boundary;
4. defensive worker test untuk W1 dan W2;
5. E2E lokal/mocked untuk C1 dan C8.

| # | Kasus | Jalur wajib diuji | Keputusan diharapkan | reason code (usul) | Status |
|---|---|---|---|---|---|
| C1 | Foto#1 banner, foto#2 packshot valid | E1,E2,E4,E6,E8,A1..A5,**A6**,W1,W2 | **produk DITERIMA**; foto#1 berstatus promotional; approved reference WAJIB foto#2 + hash-nya. **A6 (approve/regenerate) wajib MEMPERTAHANKAN snapshot** — ia membangunkan worker lagi. `REF_PROMOTIONAL` adalah STATUS FOTO, bukan penolakan produk | `REF_PROMOTIONAL` (status) | **PARTIAL** |
| C2 | Toothpaste diberi kategori facewash | E1,E3,E6,E7,A1..A4 | reject sebelum spend | `TYPE_MISMATCH` | **BLOCKED** |
| C3 | Merek salah | E1,E4,E8,W1,**W2** | reject | `BRAND_MISMATCH` | **PARTIAL** |
| C4 | Label gibberish / tak terbaca | E1,E4,E8 | reject | `LABEL_UNREADABLE` | **PARTIAL** |
| C5 | Kategori unknown/ambigu/bundle | E1,E3,E6,E7 | manual review | `CATEGORY_UNKNOWN` | **BLOCKED** |
| C6 | OCR timeout/error/ambigu | E1,E4,E8 | fail-closed | `OCR_FAILED` | **BLOCKED** |
| C7 | Classifier timeout/error/ambigu | E1,E4,E8 | fail-closed | `CLASSIFIER_FAILED` | **PARTIAL** |
| C8 | Evidence hilang/korup/basi/hash beda | E1,**E2**,**E4**,E6,E8, mutation boundary **E3/E5/E7/E9** (stale evidence), **A1..A7**,W1,W2 | fail-closed sebelum hold/capture/**regen**/enqueue/provider/deliverable; tanpa sisa state invalid persisten. Untuk A6 khusus: buktikan **nol ledger `regen`** | `EVIDENCE_INVALID` | **PARTIAL** |
| C9 | Foto/nama/brand/kategori berubah SESUDAH admission | E3,E5,E7,E9 → W1,W2 | job pakai snapshot lama | `SNAPSHOT_IMMUTABLE` | **PARTIAL** |
| C10 | Produk legacy tanpa evidence | W1,W2,A1..A4 | karantina | `LEGACY_UNVALIDATED` | **PARTIAL** |
| C11 | Berkas referensi hilang saat worker mulai | W1,W2 | fail-closed, tanpa capture | `REF_MISSING` | **PARTIAL** |
| C12 | Urutan images diubah/dirusak | E5,E9,W1,W2 | pakai hash tersetujui | `REF_HASH_MISMATCH` | **PARTIAL** |
| C13 | **Produk valid** (positif) | seluruh E,A,W | DITERIMA | — | **PARTIAL** |

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


---

## E. REKONSILIASI 2026-08-23 — terhadap exact tree e8a00a5

TASK=P0-ACCEPTANCE-MATRIX-RECONCILE-20260823
METODE=pembacaan call-site + pemetaan nama test, read-only. Perintah persis dan
keluarannya ada di `rekonsiliasi-20260823/bukti-perintah.txt`.
SIFAT=**docs-only**. Nol perubahan produk/test. Nol deploy, migrasi, koneksi
database, provider berbayar, penegakan admission, maupun keputusan T43.

### E.0 Arti status

| Status | Arti |
|---|---|
| **PASS** | ada bukti LANGSUNG (test bernama / call-site) bahwa invarian berlaku |
| **PARTIAL** | sebagian tertutup dan dibuktikan; sisanya disebut eksplisit |
| **BLOCKED** | penerimaan belum dapat dinyatakan karena implementasi lokal belum ada, atau karena T43 / kredensial / deploy; penyebab wajib disebut eksplisit |
| **NOT-APPLICABLE** | tidak relevan pada kontrak yang berlaku sekarang |

`BLOCKED` bukan klaim bahwa penyebabnya selalu eksternal. Untuk C2, C5, C6 dan D1-D2
di bawah, penerimaan diblokir oleh pekerjaan lokal yang belum diimplementasikan
atau belum diaudit; tidak ada dependensi eksternal yang menghalangi Builder
mengerjakannya sebagai task terpisah.

### E.1 Entrypoint: apa yang BERUBAH sejak 2026-08-20

| # | Status 20 Agu | Status 23 Agu | Bukti |
|---|---|---|---|
| E1 create manual | PARTIAL | **PARTIAL** | `saveProductImages` → `tulisSidecar` (`lib/product-images.ts:271`). Bukti terbit; gerbang label tidak dipanggil |
| E2 extract URL | UNGATED | **PARTIAL** | `downloadProductImages` → `tulisSidecar` (`lib/product-image-download.ts:48`). Dulu nol sidecar |
| E3 PATCH retail | UNGATED | **PARTIAL** | mutasi ini tidak membatalkan sub-kontrak sidecar/hash karena vonis referensi membaca sidecar, tetapi E3 tetap jalur wajib C2/C3/C5 dan belum melakukan validasi type/brand/category |
| E4 add-photo retail | PARTIAL | **PARTIAL** | sidecar terbit; **lubang 20 Agu MASIH ADA**: gerbang label hanya jalan bila `existing.length === 0` (`route.ts:84`) |
| E5 DELETE foto retail | UNGATED | **PARTIAL** | hanya memfilter daftar lalu `persistImages` (`app/api/products/[id]/photos/route.ts:153-155`); file foto dan sidecar sengaja dibiarkan orphan. Daftar baru juga belum direvalidasi agar tetap punya foto layak |
| E6 create org | UNGATED | **PARTIAL** | `downloadProductImages` → sidecar terbit. Dulu nol |
| E7 PATCH org | UNGATED | **PARTIAL** | observasi sidecar/hash sama dengan E3, tetapi kontrak lengkap E7 tetap aktif untuk C2/C3/C5 dan belum ditegakkan |
| E8 add-photo org | PARTIAL | **PARTIAL** | `saveUniqueProductImages` → `tulisSidecar` (`:327`); dulu TIDAK menulis sidecar sama sekali. **Lubang 20 Agu MASIH ADA**: `periksaLabelFoto` dipanggil tanpa `merekTerdaftar` (`route.ts:52`) |
| E9 DELETE foto org | UNGATED | **PARTIAL** | sesudah `pgRemoveOrgProductImage`, memanggil `deleteStoredProductImages([target])` secara best-effort (`app/api/dashboard/campaign/product/[id]/photos/route.ts:94-98`), yang menghapus file dan sidecar. Daftar baru belum direvalidasi agar tetap punya foto layak |
| W1 worker PG | UNGATED | **PARTIAL** | **Tertutup pada sub-kontrak resolver+snapshot:** `resolveApprovedReference` + `ambilSnapshotTersetujui` (`lib/postgres/worker.ts:340,355`), diuji di PostgreSQL nyata (12 test). **BELUM tertutup:** merek tidak ditegakkan di worker (C3); daftar foto dibaca TERKINI tiap invocation tanpa identitas persetujuan yang dipatok, jadi urutan bisa berubah (C12) dan regenerate menyetujui ulang (C9/A6). PASS menyeluruh bertentangan dengan gap yang dicatat dokumen ini sendiri |
| W2 worker inline | UNGATED | **PARTIAL** | Lingkup dan gap sama dengan W1 (`lib/worker.ts:122,139`; 11 test) |
| A1..A7 admission | UNGATED | **BLOCKED (T43)** | `rg -ln 'resolveApprovedReference|referensiLayak' app/api/jobs app/api/dashboard lib/dashboard/render-cell.ts app/api/scripts/generate/route.ts` → stdout kosong, exit 1. Scope mencakup A4 dan A7. Penegakan admission adalah isi T43; melarang mengubahnya adalah bagian lingkup tugas ini |
| D1, D2 penulis DB | UNGATED | **BLOCKED** | penerimaan diblokir audit lokal yang belum dilakukan; bukan dependensi eksternal dan bukan bagian slice ini |

### E.2 Kasus C1-C13 — alasan tiap status

**Cacah akhir sesudah lima ronde review: NOL kasus berstatus PASS.**
Sepuluh PARTIAL, tiga BLOCKED. Empat kasus (C1, C7, C11, C12) sempat ditandai
PASS oleh ronde-ronde awal rekonsiliasi ini dan DITURUNKAN semuanya setelah
Reviewer menunjukkan pola yang sama berulang: bukti yang dirujuk membuktikan
kontrak RESOLVER, sementara baris kasusnya menuntut JALUR (E/A/W) — dua hal
yang tidak sama. Angka ini dicatat apa adanya karena itulah hasil audit yang
sebenarnya: belum satu pun kasus penerimaan tertutup penuh.

| # | Status | Alasan dan bukti |
|---|---|---|
| C1 | **PARTIAL** | `REF_PROMOTIONAL` ada (`lib/product-truth.ts`). Test `W1 C1` (`tests/pg-product-truth-w1.test.ts:344`) dan `W2 C1` (`tests/product-truth-worker-reference.test.ts:219`) membuktikan worker memilih packshot foto#2 beserta sha256-nya. Namun jalur E/A lain belum dicakup dan A6 tidak mempertahankan snapshot sebelum regenerate: setiap invocation worker membaca ulang `products.images` lalu membuat snapshot baru (`lib/postgres/worker.ts:273-278,323-355`) |
| C2 | **BLOCKED** | Diblokir implementasi lokal: `TYPE_MISMATCH` dan validasi terkait belum ada di kode mana pun; tidak ada penghalang eksternal |
| C3 | **PARTIAL** | E4 menolak `cocokMerek === false` untuk foto pertama (`app/api/products/[id]/photos/route.ts:91-100`). Cakupan belum lengkap: E1 tidak menjalankan gerbang merek, E8 tidak meneruskan `merekTerdaftar`, W1/W2 tidak menegakkan brand mismatch, foto tambahan E4 tidak diperiksa, dan reason code khusus `BRAND_MISMATCH` belum ada |
| C4 | **PARTIAL** | E4 dan E8 menolak `!label.terbaca` untuk foto pertama (`app/api/products/[id]/photos/route.ts:84-100`; `app/api/dashboard/campaign/product/[id]/photos/route.ts:47-54`). Cakupan belum lengkap: E1 tidak menjalankan gerbang label, foto tambahan E4/E8 tidak diperiksa, dan reason code khusus `LABEL_UNREADABLE` belum ada |
| C5 | **BLOCKED** | Diblokir implementasi lokal: `CATEGORY_UNKNOWN` dan jalur manual review belum ada |
| C6 | **BLOCKED** | Diblokir konflik kontrak/implementasi lokal: `OCR_FAILED` tidak ada dan jalurnya **fail-OPEN** (`label-terbaca.ts:188` mengembalikan `terbaca:true` saat pemeriksaan gagal), berlawanan dengan fail-closed yang diharapkan baris C6 |
| C7 | **PARTIAL** | **Sudah tertutup:** classifier menghasilkan keadaan ketiga `belum_diperiksa` (bukan vonis promosi), dan resolver menerjemahkannya jadi `CLASSIFIER_FAILED` — diuji di `tests/klasifikasi-gambar.test.ts` dan `tests/product-truth-evidence.test.ts`. **Gap yang tersisa:** jalur wajib C7 adalah E1, E4, E8, dan tidak satu pun membuktikan fail-closed. `rg --include-zero -c 'resolveApprovedReference|referensiLayak'` -> E1 (`app/api/products/route.ts`) = **0**, E8 (org photos) = **0**; keduanya menyimpan/menerima foto tanpa memanggil resolver sama sekali. E4 memanggilnya, tapi MENYIMPAN foto lebih dulu dan tidak membersihkannya saat tidak ada referensi layak — jadi kontrak 'nol efek storage' juga belum terbukti. Diturunkan dari PASS atas temuan Reviewer |
| C8 | **PARTIAL** | Tertutup dan diuji di W1/W2: `W1 C8` × 3 (korup, hilang, hash beda) dan `W2 C8` × 2, seluruhnya menuntut nol materialize, nol provider, gagal-tertutup, nol capture/regen. **TIDAK tertutup di A1..A7** — itu isi T43 |
| C9 | **PARTIAL** | Snapshot per job ADA (`ambilSnapshotTersetujui`) dan diuji lewat empat kasus TOCTOU, termasuk "path bersama ditimpa SESUDAH diperiksa". Yang belum: reason code `SNAPSHOT_IMMUTABLE` tidak ada, dan mutasi E3/E7 tidak memicu revalidasi (kini tidak lagi memengaruhi vonis referensi) |
| C10 | **PARTIAL** | W1/W2 menolak produk legacy tanpa sidecar dengan `EVIDENCE_INVALID`/`SIDECAR_MISSING` (`tests/pg-product-truth-w1.test.ts:302`; `tests/product-truth-worker-reference.test.ts:288`). Namun A1..A4 tidak memanggil evidence gate, sehingga karantina sebelum admission belum ada dan bergantung pada keputusan T43. Secara terpisah, angka populasi legacy belum diketahui karena audit staging memerlukan `DATABASE_URL` |
| C11 | **PARTIAL** | **Sudah tertutup:** kontrak resolver — `REF_MISSING` ada, dan urutan vonisnya dikunci (sidecar diperiksa lebih dulu; `REF_MISSING` hanya muncul saat sidecar SAH ada tapi bytes hilang). **Gap yang tersisa:** baris C11 mewajibkan W1 DAN W2 fail-closed tanpa capture, dan tidak ada test BERNAMA C11 di kedua worker — pemetaan nama test hanya punya C1 dan C8 (`rg -o '(W1|W2) C[0-9]+' tests/`). Jadi nol provider / nol capture / nol regen / nol deliverable untuk kasus berkas hilang belum dibuktikan di boundary. Diturunkan dari PASS atas temuan Reviewer |
| C12 | **PARTIAL** | **Sudah tertutup:** integritas BYTES dalam satu invocation — `tests/kontrak-hash-sidecar.test.ts` mengunci hash dihitung dari bytes tersimpan, dan dari EMPAT test TOCTOU **dua** benar-benar mencapai provider (`W2 TOCTOU: bytes yang DITERIMA PROVIDER…` dan padanan W1); dua sisanya sengaja berhenti sebelum langkah berbayar. **Gap yang tersisa, dan lebih dalam dari cakupan test:** reason code yang diusulkan baris ini — `REF_HASH_MISMATCH` — SECARA KONSEP tidak bisa mendeteksi perubahan urutan. Kode mendefinisikannya sebagai ketidakcocokan hash sidecar dengan bytes berkas; MENUKAR dua foto yang sama-sama sah tidak mengubah hash salah satu pun, jadi ia tidak akan pernah terpicu. Yang dibutuhkan bukan test tambahan melainkan KONTRAK BARU: identitas persetujuan yang dipatok (rel+sha256 disimpan saat admission) atau digest manifest BERURUTAN, beserta reason code-nya sendiri. Diturunkan dari PASS, lalu diperdalam, atas temuan Reviewer |
| C13 | **PARTIAL** | Kontrol positif W1 (`tests/pg-product-truth-w1.test.ts:740`) dan W2 (`tests/product-truth-worker-reference.test.ts:638`) membuktikan worker menerima bukti sah. Itu belum membuktikan produk valid diterima melalui seluruh E1..E9 dan A1..A7 yang diwajibkan baris ini |

### E.3 Bagian D dokumen ini sudah usang — dikoreksi

Bagian D ("Yang BELUM diverifikasi", 2026-08-20) menyatakan belum ada
boundary test C1/C8 dan reason code masih usulan. Per e8a00a5:

- boundary test C1 dan C8 **ADA** di kedua worker (lihat E.2);
- lima reason code sudah nyata (`REF_PROMOTIONAL`, `CLASSIFIER_FAILED`,
  `EVIDENCE_INVALID`, `REF_MISSING`, `REF_HASH_MISMATCH`); tujuh sisanya masih
  usulan; status kasusnya tetap PARTIAL atau BLOCKED sesuai cakupan nyata;
- jalur promo tetap di luar cakupan dan tetap belum diputuskan siapa pun.

### E.4 Sisa P0/P1, dipisah menurut APA yang menahannya

**(a) Bisa dikerjakan LOKAL sekarang — kandidat task berikutnya, TIDAK
dikerjakan di slice ini:**

1. Gerbang label E4 hanya menyentuh foto pertama (`route.ts:84`) — banner yang
   diunggah sebagai foto kedua tidak pernah diperiksa label.
2. E8 memanggil `periksaLabelFoto` tanpa `merekTerdaftar` (`route.ts:52`) —
   `cocokMerek` tidak pernah diperiksa di jalur org.
3. `label-terbaca.ts:188` fail-OPEN saat pemeriksaan gagal. Keputusannya
   disengaja dan beralasan ("menyaring foto buruk, bukan menjaga uang"), tapi
   baris C6 mengharapkan fail-closed. **Salah satu dari keduanya harus
   dikoreksi** — matriks atau kodenya; itu keputusan produk, bukan pembersihan
   dokumen.
4. C2/C5 belum punya reason code maupun jalur penegakan; C3/C4 belum punya
   reason code khusus dan jalur penegakannya baru parsial seperti dirinci E.2.
5. D1/D2 (penulis DB langsung) belum diaudit ulang sejak 20 Agu.
6. **A6 tidak mempertahankan snapshot yang sudah disetujui** — cacat produk
   nyata, ditemukan lewat temuan Reviewer atas rekonsiliasi ini. Worker PG
   membaca `p.images` segar tiap invocation lalu menyetujui ULANG, jadi
   approve/regenerate memakai keadaan foto SAAT ITU, bukan yang disetujui saat
   admission. Ini yang membuat C1 dan C9 tidak bisa PASS. Kandidat task
   berikutnya; TIDAK diimplementasikan di slice rekonsiliasi ini.
7. E5 DELETE retail hanya menghapus path dari daftar produk; file foto dan
   sidecar tetap orphan di storage (`app/api/products/[id]/photos/route.ts:139-155`).
8. **Tidak ada identitas persetujuan yang dipatok lintas mutasi.** Referensi
   utama dipilih dari URUTAN daftar (`lib/product-truth.ts:341` —
   `utama: tersetujui[0] ?? null`), jadi E5/E9 yang memutasi daftar bisa
   mengubah foto utama tanpa satu pun gerbang, dan worker membaca daftar
   TERKINI tiap invocation. Ini yang membuat C12 tidak bisa PASS, dan
   berkerabat dengan butir 6 (A6): keduanya soal keadaan yang disetujui tidak
   dipatok. Dan `REF_HASH_MISMATCH` tidak bisa menangkapnya: menukar dua foto
   sah tidak mengubah hash mana pun. Jadi yang dibutuhkan KONTRAK BARU
   (identitas dipatok atau digest manifest berurutan) beserta reason code-nya,
   bukan sekadar test E5/E9 -> W1/W2.
9. C7 belum fail-closed pada seluruh boundary E1/E4/E8: E1/E8 menerima foto
   tanpa resolver, sedangkan E4 meninggalkan bytes tersimpan saat tidak ada
   referensi layak. Belum ada test nol efek storage untuk ketiga jalur itu.

**(b) Butuh kredensial/data:**

10. Angka audit legacy P0-B3 (C10) — butuh `DATABASE_URL` staging; ember media
   juga butuh R2 yang BERPASANGAN dengan database itu.

**(c) Butuh deploy/migrasi:**

11. Kapabilitas klasifikasi runtime web (P0-B2) — probe `0028850` belum hidup di
   staging; `preDeployCommand` staging menjalankan migrasi schema.

**(d) Butuh keputusan Founder T43:**

12. Penegakan admission A1..A7 (C8 di luar worker), P0-B4 tindakan, dan P0-B5.

### E.5 Yang TIDAK dilakukan di slice ini

Nol perubahan produk atau test. Tidak satu pun status dinaikkan untuk membuat
matriks hijau: tiga baris tetap BLOCKED oleh gap lokal dan sembilan baris PARTIAL
karena cakupannya belum lengkap. Kesembilan gap di E.4(a) dicatat sebagai kandidat task, bukan
diimplementasikan.
