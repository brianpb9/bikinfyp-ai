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
| E4 | `app/api/products/[id]/photos/route.ts:44` | POST add-photo (retail) | **PARTIAL** | Setiap blob baru melewati `periksaLabelFoto`+`merekTerdaftar` sebelum persistence; `referensiLayak` tetap sesudah ingestion. DUA lubang lain tetap: `periksaLabelFoto` FAIL-OPEN saat OCR gagal (`label-terbaca.ts` mengembalikan `terbaca:true`); hash sidecar tidak pernah diverifikasi ulang terhadap isi berkas |
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
| A6 | `app/api/dashboard/campaign/job/[jobId]/route.ts` | approve / regenerate job | **PARTIAL** | manifest job immutable diverifikasi sebelum approve/regen charge/task reset/enqueue; admission gate umum A1..A7 tetap T43 |
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
6. **DITUTUP 24 Agu:** gerbang label E4 sekarang mengiterasi setiap blob baru
   sebelum persistence; foto kedua dan batch campuran tidak lagi melewati gate.

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
| C11 | Berkas referensi hilang saat worker mulai | W1,W2 | fail-closed, tanpa capture | `REF_MISSING` | **PASS** |
| C12 | Urutan images diubah/dirusak | E5,E9,W1,W2 | pertahankan identitas/snapshot atau digest manifest berurutan yang disetujui lintas mutasi | `REFERENCE_IDENTITY_CHANGED` (usul) | **PARTIAL** |
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

`BLOCKED` bukan klaim bahwa penyebabnya selalu eksternal. Untuk C2, C5, dan C6
di bawah, penerimaan diblokir oleh pekerjaan lokal yang belum diimplementasikan;
tidak ada dependensi eksternal yang menghalangi Builder
mengerjakannya sebagai task terpisah.

### E.1 Entrypoint: apa yang BERUBAH sejak 2026-08-20

| # | Status 20 Agu | Status 23 Agu | Bukti |
|---|---|---|---|
| E1 create manual | PARTIAL | **PARTIAL** | `saveProductImages` → `tulisSidecar` (`lib/product-images.ts:271`). Bukti terbit; gerbang label tidak dipanggil |
| E2 extract URL | UNGATED | **PARTIAL** | `downloadProductImages` → `tulisSidecar` (`lib/product-image-download.ts:48`). Dulu nol sidecar |
| E3 PATCH retail | UNGATED | **PARTIAL** | mutasi ini tidak membatalkan sub-kontrak sidecar/hash karena vonis referensi membaca sidecar, tetapi E3 tetap jalur wajib C2/C3/C5 dan belum melakukan validasi type/brand/category |
| E4 add-photo retail | PARTIAL | **PARTIAL** | sidecar terbit; append daftar atomik memakai key UUID. **Gap foto #2+ ditutup 24 Agu:** seluruh blob decodable melewati label+brand gate sebelum satu pun persistence; kegagalan akhir multipart terbukti nol efek storage/list/audit. Status tetap PARTIAL karena fail-open OCR dan verifikasi ulang hash masih terbuka |
| E5 DELETE foto retail | UNGATED | **PARTIAL** | `removeRetailProductImage` menghitung daftar otoritatif secara atomik, lalu `deleteStoredProductImages([target])` best-effort; `cleanup_failed` terlihat, audit pasca-commit non-fatal, dan test HTTP→resume W2 membuktikan manifest job tetap menang atau `REF_MISSING` gagal tertutup. Daftar baru tetap belum direvalidasi |
| E6 create org | UNGATED | **PARTIAL** | `downloadProductImages` → sidecar terbit. Dulu nol |
| E7 PATCH org | UNGATED | **PARTIAL** | observasi sidecar/hash sama dengan E3, tetapi kontrak lengkap E7 tetap aktif untuk C2/C3/C5 dan belum ditegakkan |
| E8 add-photo org | PARTIAL | **PARTIAL** | `saveUniqueProductImages` → `tulisSidecar` (`:327`); dulu TIDAK menulis sidecar sama sekali. **Lubang 20 Agu MASIH ADA**: `periksaLabelFoto` dipanggil tanpa `merekTerdaftar` (`route.ts:52`) |
| E9 DELETE foto org | UNGATED | **PARTIAL** | sesudah `pgRemoveOrgProductImage`, memanggil `deleteStoredProductImages([target])` secara best-effort (`app/api/dashboard/campaign/product/[id]/photos/route.ts:94-98`), yang menghapus file dan sidecar. Test HTTP→resume W1 membuktikan isolasi org, daftar otoritatif, dan manifest job tetap menang atau `REF_MISSING` gagal tertutup. Daftar baru belum direvalidasi agar tetap punya foto layak |
| W1 worker PG | UNGATED | **PARTIAL** | Resolver, manifest job atomik/idempoten, reuse lintas invocation, verifikasi bytes di boundary provider/output, C1/C8/C11, dan legacy fail-closed dibuktikan di PostgreSQL disposable. **Belum:** brand mismatch C3 dan snapshot field produk non-referensi |
| W2 worker inline | UNGATED | **PARTIAL** | Kontrak manifest/reuse/verifikasi/legacy yang sama dibuktikan langsung pada worker SQLite; C8/C11 tetap memakai observer provider. **Belum:** brand mismatch C3 dan snapshot field produk non-referensi |
| A1..A7 admission | UNGATED | **BLOCKED (T43)** | Transcript §4 menguji tujuh path literal: semuanya `ADA`, `gerbang_bukti=0`, `exit=1`, termasuk A4 dan A7. Penegakan admission adalah isi T43; melarang mengubahnya adalah bagian lingkup tugas ini |
| D1 penulis produk/brand | UNGATED | **PARTIAL** | Reachable production melalui E1/E2/E3/E6. Semua create yang membawa image keys didahului helper bersidecar; direct caller lain hanya verifier disposable. Namun writer menerima `images` mentah dan mutation E3 name/category/brand tidak merevalidasi product-truth. Audit: `D1D2-DIRECT-WRITER-AUDIT.md` |
| D2 penulis daftar images | UNGATED | **PARTIAL** | Reachable production hanya melalui E4/E5/E8/E9. Add menerima keys dari helper bersidecar; delete retail/org sudah membersihkan storage, tetapi revalidation E5/E9 dan gerbang E8 tetap belum lengkap. Tidak ada CLI/direct caller tersembunyi. Audit: `D1D2-DIRECT-WRITER-AUDIT.md` |

### E.2 Kasus C1-C13 — alasan tiap status

**Cacah setelah follow-up C11: satu PASS, sembilan PARTIAL, tiga BLOCKED.**
C11 kini punya bukti boundary langsung pada kedua jalur wajibnya, W1 dan W2.
Empat kasus (C1, C7, C11, C12) sempat ditandai
PASS oleh ronde-ronde awal rekonsiliasi; semuanya sempat DITURUNKAN setelah
Reviewer menunjukkan pola yang sama berulang: bukti yang dirujuk membuktikan
kontrak RESOLVER, sementara baris kasusnya menuntut JALUR (E/A/W) — dua hal
yang tidak sama. Follow-up C11 kemudian menutup bukti JALUR itu secara langsung,
tanpa mengubah status W1/W2 keseluruhan yang masih punya gap kasus lain.

| # | Status | Alasan dan bukti |
|---|---|---|
| C1 | **PARTIAL** | W1/W2 memilih packshot sah beserta hash lalu mematok manifest ordered `{rel,sha256,versiBukti}` tepat sekali; A6 approve/regenerate memakai manifest itu dan tidak memilih ulang. Tetap PARTIAL karena jalur E/A lain pada baris C1 belum seluruhnya dicakup |
| C2 | **BLOCKED** | Diblokir implementasi lokal: `TYPE_MISMATCH` dan validasi terkait belum ada di kode mana pun; tidak ada penghalang eksternal |
| C3 | **PARTIAL** | E4 menolak `cocokMerek === false` untuk **setiap blob baru** sebelum persistence (`app/api/products/[id]/photos/route.ts`). Cakupan belum lengkap: E1 tidak menjalankan gerbang merek, E8 tidak meneruskan `merekTerdaftar`, W1/W2 tidak menegakkan brand mismatch, dan reason code khusus `BRAND_MISMATCH` belum ada |
| C4 | **PARTIAL** | E4 menolak `!label.terbaca` untuk **setiap blob baru** sebelum persistence; E8 masih hanya memeriksa foto pertama (`app/api/products/[id]/photos/route.ts`; `app/api/dashboard/campaign/product/[id]/photos/route.ts:47-54`). Cakupan belum lengkap: E1 tidak menjalankan gerbang label, foto tambahan E8 tidak diperiksa, dan reason code khusus `LABEL_UNREADABLE` belum ada |
| C5 | **BLOCKED** | Diblokir implementasi lokal: `CATEGORY_UNKNOWN` dan jalur manual review belum ada |
| C6 | **BLOCKED** | Diblokir konflik kontrak/implementasi lokal: `OCR_FAILED` tidak ada dan jalurnya **fail-OPEN** (`label-terbaca.ts:188` mengembalikan `terbaca:true` saat pemeriksaan gagal), berlawanan dengan fail-closed yang diharapkan baris C6 |
| C7 | **PARTIAL** | **Sudah tertutup:** classifier menghasilkan keadaan ketiga `belum_diperiksa` (bukan vonis promosi), dan resolver menerjemahkannya jadi `CLASSIFIER_FAILED` — diuji di `tests/klasifikasi-gambar.test.ts` dan `tests/product-truth-evidence.test.ts`. **Gap yang tersisa:** jalur wajib C7 adalah E1, E4, E8, dan tidak satu pun membuktikan fail-closed. `rg --include-zero -c 'resolveApprovedReference|referensiLayak'` -> E1 (`app/api/products/route.ts`) = **0**, E8 (org photos) = **0**; keduanya menyimpan/menerima foto tanpa memanggil resolver sama sekali. E4 memanggilnya, tapi MENYIMPAN foto lebih dulu dan tidak membersihkannya saat tidak ada referensi layak — jadi kontrak 'nol efek storage' juga belum terbukti. Diturunkan dari PASS atas temuan Reviewer |
| C8 | **PARTIAL** | W1 C8 ×3 dan W2 C8 ×2 membuktikan invalid evidence gagal-tertutup sebelum materialize/provider/capture/regen/output. W2 kini memasang observer `setVideoProvidersForTests` per kasus, mengasersi nol `generate`, dan reset lewat `t.after` pada success/failure; control counterexample membuktikan counter naik saat provider sengaja dipanggil. C8 tetap belum tertutup di A1..A7 (T43) |
| C9 | **PARTIAL** | Sub-kontrak identitas foto DAN metadata worker tertutup: W1/W2 memakai manifest bytes serta snapshot job versioned untuk nama, trusted brand source/value, kategori, deskripsi visual, brand brief, dan claims. HTTP E3→W2 dan E7→W1 membuktikan mutasi handler aktual tidak mengubah bahan admission di provider. Tetap PARTIAL karena reason code `SNAPSHOT_IMMUTABLE` tidak diterbitkan dan regenerate/entry lain belum seluruhnya tertutup |
| C10 | **PARTIAL** | W1/W2 menolak produk legacy tanpa sidecar dengan `EVIDENCE_INVALID`/`SIDECAR_MISSING` (`tests/pg-product-truth-w1.test.ts:302`; `tests/product-truth-worker-reference.test.ts:288`). Namun A1..A4 tidak memanggil evidence gate, sehingga karantina sebelum admission belum ada dan bergantung pada keputusan T43. Secara terpisah, angka populasi legacy belum diketahui karena audit staging memerlukan `DATABASE_URL` |
| C11 | **PASS** | Test bernama `W1 C11` dan `W2 C11` menjalankan kedua worker dengan sidecar sah tetapi payload absen sejak worker mulai. Keduanya mengunci jalur `REF_MISSING`, urutan baca sidecar→payload, nol materialize/provider/fetch/capture/regen/output/storage write, dan state akhir fail-closed. Observer provider punya counterexample positif dari suite yang sama dan reset per-test |
| C12 | **PARTIAL** | Identitas dan urutan referensi dipatok dalam manifest job versioned; create konkuren kembali dengan satu pemenang, W1/W2 tidak membaca ulang daftar saat manifest ada, dan test HTTP E5/E9→resume membuktikan boundary route/list/storage. Tetap PARTIAL karena reason code usulan `REFERENCE_IDENTITY_CHANGED` tidak diterbitkan; bukti memakai reason truthful yang sudah ada (`REF_MISSING`) |
| C13 | **PARTIAL** | Kontrol positif W1 (`tests/pg-product-truth-w1.test.ts:740`) dan W2 (`tests/product-truth-worker-reference.test.ts:638`) membuktikan worker menerima bukti sah. Itu belum membuktikan produk valid diterima melalui seluruh E1..E9 dan A1..A7 yang diwajibkan baris ini |

### E.3 Bagian D dokumen ini sudah usang — dikoreksi

Bagian D ("Yang BELUM diverifikasi", 2026-08-20) menyatakan belum ada
boundary test C1/C8 dan reason code masih usulan. Per e8a00a5:

- boundary test C1 dan C8 **ADA** di kedua worker (lihat E.2);
- lima reason code sudah nyata (`REF_PROMOTIONAL`, `CLASSIFIER_FAILED`,
  `EVIDENCE_INVALID`, `REF_MISSING`, `REF_HASH_MISMATCH`). Dengan usulan baru
  `REFERENCE_IDENTITY_CHANGED`, delapan reason code masih usulan; status
  kasusnya tetap PARTIAL atau BLOCKED sesuai cakupan nyata;
- jalur promo tetap di luar cakupan dan tetap belum diputuskan siapa pun.

### E.4 Sisa P0/P1, dipisah menurut APA yang menahannya

**(a) Bisa dikerjakan LOKAL sekarang — kandidat task berikutnya, TIDAK
dikerjakan di slice ini:**

1. **DITUTUP 24 Agu:** gerbang label E4 memeriksa semua blob baru sebelum
   persistence; foto #2+ dan mixed multipart invalid ditolak atomik.
2. E8 memanggil `periksaLabelFoto` tanpa `merekTerdaftar` (`route.ts:52`) —
   `cocokMerek` tidak pernah diperiksa di jalur org.
3. `label-terbaca.ts:188` fail-OPEN saat pemeriksaan gagal. Keputusannya
   disengaja dan beralasan ("menyaring foto buruk, bukan menjaga uang"), tapi
   baris C6 mengharapkan fail-closed. **Salah satu dari keduanya harus
   dikoreksi** — matriks atau kodenya; itu keputusan produk, bukan pembersihan
   dokumen.
4. C2/C5 belum punya reason code maupun jalur penegakan; C3/C4 belum punya
   reason code khusus dan jalur penegakannya baru parsial seperti dirinci E.2.
5. Snapshot metadata job kini menutup pembacaan ulang nama/brand/kategori dan
   field prompt W1/W2. HTTP E3/E7→resume dibuktikan di E.12; C9 tetap PARTIAL
   sampai regenerate/entry lain dan reason code kontraknya ditutup.
6. Test HTTP penuh E5/E9→resume kini ada (E.11): handler mutation, daftar
   otoritatif, cleanup storage, isolasi owner/org, dan resume W1/W2 dibuktikan
   langsung. C12 tetap PARTIAL hanya karena reason code usulan
   `REFERENCE_IDENTITY_CHANGED` belum diterbitkan.
7. C7 belum fail-closed pada seluruh boundary E1/E4/E8: E1/E8 menerima foto
   tanpa resolver, sedangkan E4 meninggalkan bytes tersimpan saat tidak ada
   referensi layak. Belum ada test nol efek storage untuk ketiga jalur itu.
**(b) Butuh kredensial/data:**

8. Angka audit legacy P0-B3 (C10) — butuh `DATABASE_URL` staging; ember media
   juga butuh R2 yang BERPASANGAN dengan database itu.

**(c) Butuh deploy/migrasi:**

9. Kapabilitas klasifikasi runtime web (P0-B2) — probe `0028850` belum hidup di
   staging; `preDeployCommand` staging menjalankan migrasi schema.

**(d) Butuh keputusan Founder T43:**

10. Penegakan admission A1..A7 (C8 di luar worker), P0-B4 tindakan, dan P0-B5.

### E.5 Yang TIDAK dilakukan di slice ini

Pada slice rekonsiliasi asal, nol perubahan produk atau test dilakukan dan
tidak satu pun status dinaikkan. Follow-up terpisah E.6 dan E.7 menambahkan
bukti test langsung untuk gap yang kemudian disetujui sebagai task bounded.

### E.6 Follow-up W2 C8 provider observer — 2026-08-23

TASK=P0-W2-C8-PROVIDER-OBSERVER-20260823

- `tests/product-truth-worker-reference.test.ts`: satu observer seam dipasang
  per W2 C8 case; counter bertambah sebelum fake provider melempar, diasersi
  nol pada evidence invalid, dan selalu direset lewat `t.after` pada success/failure.
- Control counterexample memanggil provider seam secara sengaja dan membuktikan
  counter berubah dari 0 menjadi 1, sehingga asersi nol tidak hampa.
- `tsx --test tests/product-truth-worker-reference.test.ts` → **12/12 PASS**.
- Suite product-truth non-PG terdampak (`product-truth-evidence`, ingestion,
  worker-wiring) → **99/99 PASS**.
- Gap lokal observer W2 C8 ditutup. Status C8 tetap **PARTIAL** karena A1..A7
  masih belum menegakkan evidence gate dan tetap bergantung pada T43.

### E.7 Follow-up C11 worker boundary proof — 2026-08-23

TASK=P0-C11-WORKER-BOUNDARY-PROOF-20260823

- `tests/product-truth-worker-reference.test.ts`: W2 dijalankan dengan sidecar
  sah dan payload absen sejak worker mulai; jalur `REF_MISSING`, urutan baca,
  nol materialize/provider/fetch/capture/regen/output/storage write, dan state
  fail-closed diasersi langsung.
- `tests/pg-product-truth-w1.test.ts`: bukti yang sama dijalankan pada W1 dengan
  PostgreSQL disposable. Provider dan storage seam direset lewat `t.after`.
- Observer provider tidak hampa: control W2 dan jalur positif W1 di suite yang
  sama membuktikan observer mencatat panggilan nyata.
- `tsx --test tests/product-truth-worker-reference.test.ts` → **13/13 PASS**.
- `npm run test:postgres-product-truth-w1` dengan PostgreSQL lokal disposable
  → **13/13 PASS**; database uji di-drop oleh trap gate.
- Gap lokal C11 ditutup. C11 menjadi **PASS** karena jalur wajibnya hanya W1/W2;
  status W1 dan W2 keseluruhan tetap **PARTIAL** akibat gap C3/C9/C12.

### E.8 Follow-up E5 retail delete storage cleanup — 2026-08-23

TASK=P0-E5-RETAIL-DELETE-STORAGE-CLEANUP-20260823

- Setelah daftar foto baru berhasil dipersist secara atomik, E5 memanggil
  `deleteStoredProductImages([target])`, yang menghapus foto dan sidecar sebagai
  satu unit. Semantik kegagalan sama dengan E9: cleanup best-effort,
  `cleanup_failed` terlihat di respons, dan entry DB tidak dikembalikan.
- `tests/retail-photo-delete.test.ts` membuktikan target+sidecar dibersihkan,
  foto lain tidak disentuh, persist terjadi sebelum cleanup, dan kegagalan
  cleanup tetap ter-log/terlihat tanpa merusak daftar DB; penghapusan foto
  terakhir tetap menghasilkan daftar kosong seperti kontrak sebelumnya. Bukti
  tambahan mengunci race delete/delete dan add/delete, key upload UUID, serta
  audit pasca-commit yang gagal tanpa false 500.
- Focus test → **6/6 PASS**; gabungan focus + product-truth ingestion + storage
  → **16/16 PASS**; `tsc --noEmit` → **PASS**.
- Gap orphan-cleanup E5 ditutup. E5 tetap **PARTIAL** karena revalidation daftar
  hasil; identitas referensi lintas mutasi kini dipatok oleh manifest job A6.

### E.9 Follow-up A6 immutable approved-reference manifest — 2026-08-23

TASK=P0-A6-REFERENCE-SNAPSHOT-IMMUTABLE-20260823

- SQLite dan PostgreSQL menyimpan manifest job versioned dan ordered berisi
  `rel`, `sha256`, `versiBukti`, dan `snapshotRel`. Setiap `snapshotRel`
  menunjuk ke salinan bytes immutable milik job di `jobs/<jobId>/approved-references/`,
  bukan lagi objek mutable milik `products.images`. Instalasi memakai
  transaksi/CAS sehingga retry dan create konkuren selalu membaca satu
  pemenang durable; kandidat CAS yang kalah dibersihkan.
- W1/W2 tidak memilih ulang dari `products.images` bila manifest sudah ada.
  Seluruh entry di-materialize dan diverifikasi sebelum boundary provider,
  regenerate, output, dan capture; missing/hash-changed gagal tertutup. Test
  menghapus objek sumber produk sesudah snapshot dibuat dan membuktikan retry
  tetap memakai bytes job-owned yang sama, menutup race cleanup produk sebelum
  ledger/reset/enqueue A6.
- A6 memverifikasi manifest sebelum approve mutation, klaim/ledger regenerate,
  reset task, atau enqueue. Legacy job tanpa manifest hanya boleh dipatok bila
  belum ada provider task/output/job-shot/cost; provenance tak terbukti ditolak.
- Kegagalan infrastruktur storage (auth/network/I/O) diteruskan apa adanya dan
  tidak lagi disamarkan sebagai `REF_MISSING`; hanya hasil `null` bermakna objek
  snapshot memang hilang.
- `tests/job-reference-manifest.test.ts` → **6/6 PASS**; W2 worker → **15/15
  PASS**; affected product-truth gabungan → **122/122 PASS**; W1 PostgreSQL
  disposable → **16/16 PASS**; `tsc --noEmit` → **PASS**.
- A6/C1/C9 reference-identity gap ditutup. Status kasus keseluruhan tetap
  konservatif sesuai gap non-referensi dan jalur lain yang tercatat di E.2.

### E.10 Follow-up C9 immutable job product metadata — 2026-08-23

TASK=P0-C9-JOB-PRODUCT-METADATA-SNAPSHOT-20260823

- SQLite dan PostgreSQL menyimpan `job_product_snapshot` versioned berisi nama
  produk, kategori, trusted brand `{source,value}`, `productVisualDesc`,
  `brandBrief`, dan claims. Parser menolak bentuk/sumber merek yang tidak sah.
- Instalasi snapshot memakai CAS/row lock dan aturan provenance A6: pristine
  job boleh mematok tepat sekali; job dengan provider task/output/job-shot/
  biaya tanpa snapshot gagal tertutup. Create konkuren membaca satu pemenang.
- W1/W2 mengganti seluruh field product-truth lokal dari snapshot sebelum
  planner/provider. Regresi mutasi membuktikan prompt provider tetap membawa
  nama/deskripsi/brand brief awal dan tidak membawa nilai produk terbaru.
  A6 memvalidasi snapshot sebelum approve, regen ledger, reset, atau enqueue.
- Helper/parser → **5/5 PASS**; W2 → **16/16 PASS**; affected product-truth/job
  suites → **128/128 PASS**; PostgreSQL disposable W1 → **17/17 PASS**;
  `tsc --noEmit` dan `git diff --check` → **PASS**.
- C9 tetap **PARTIAL** secara konservatif: pada titik tugas ini mutasi HTTP
  E3/E7→resume belum diuji end-to-end dan reason code `SNAPSHOT_IMMUTABLE`
  belum diterbitkan. Follow-up E.12 kemudian menutup gap HTTP resume tersebut.

#### Koreksi review: snapshot dipasang saat admission

- Tiga pembuat job produksi diaudit: retail SQLite (`app/api/jobs/route.ts`),
  retail PostgreSQL (`smokeCreateJob`), dan dashboard brand PostgreSQL
  (`renderSatuSel`). Ketiganya kini membangun snapshot kanonik dari row produk
  di dalam transaksi admission dan menulisnya pada `INSERT jobs` yang sama;
  jalur PostgreSQL menahan `FOR SHARE` sampai commit. Guard struktural gagal
  bila muncul pembuat job produksi baru atau `INSERT jobs` tanpa snapshot.
- Regresi W1 dan W2 tidak lagi pre-seed `job_product_snapshot`: job dibuat
  lewat admission nyata, produk dimutasi sebelum worker dimulai (termasuk
  claims menjadi JSON rusak), dan boundary provider tetap menerima metadata
  admission. Fallback worker tetap hanya untuk legacy pristine.
- Helper/parser/A6/admission guard → **7/7 PASS**; W2 → **16/16 PASS**;
  affected admission/product-truth suite → **135/135 PASS**; W1 PostgreSQL
  disposable → **17/17 PASS**; admission concurrency PostgreSQL → **PASS**;
  jobs parity PostgreSQL → **PASS**; production migration runner → **PASS**;
  `tsc --noEmit` dan `git diff --check` → **PASS**.
- Status C9 tetap **PARTIAL**: bukti ini menutup race admission→worker untuk W1
  dan W2, tetapi tidak mengarang reason code `SNAPSHOT_IMMUTABLE`. Follow-up
  E.12 menutup HTTP E3/E7→resume; regenerate/entry lain tetap terbuka.

### E.11 Follow-up C12 HTTP photo mutation → resume — 2026-08-24

TASK=P0-C12-HTTP-MUTATION-RESUME-PROOF-20260823

- E5 retail diuji lewat handler `DELETE` aktual lalu entrypoint W2
  `processJob`; E9 organisasi diuji lewat handler `DELETE` aktual lalu
  entrypoint W1 `processPostgresJob` pada PostgreSQL disposable. Tidak ada
  mutasi DB manual yang menggantikan operasi HTTP yang sedang diuji.
- Kedua jalur membuktikan isolasi owner/org, response dan row `products.images`
  pasca-mutasi yang sama/otoritatif, serta cleanup foto+sidecar. Handler nyata
  menghapus approved source pertama dari daftar dan storage. Sidecar source
  kedua dibentuk valid dan terikat hash bytes-nya menurut policy kini; asersi
  eksplisit ke `resolveApprovedReference` atas daftar pasca-DELETE membuktikan
  resolver canonical memilih source kedua. Resume tetap mengirim bytes
  source pertama dan mempertahankan urutan dua entry dari
  `approved_reference_manifest` job; ini counterexample langsung terhadap
  implementasi yang diam-diam me-resolve daftar produk terbaru.
- Fault storage terkontrol pada cleanup HTTP menghilangkan object privat yang
  dirujuk manifest. Resume W1/W2 lalu gagal tertutup dengan `REF_MISSING`
  sebelum provider, capture, regen, atau output; test tidak mengarang reason
  code `REFERENCE_IDENTITY_CHANGED` yang memang belum ada.
- E5/W2 focused + structural guard → **3/3 PASS**; W1 PostgreSQL disposable,
  termasuk E9 + structural guard → **20/20 PASS**; affected route/product-truth
  suite → **124/124 PASS**; `tsc --noEmit` dan `git diff --check` → **PASS**.
- C12 tetap **PARTIAL** hanya karena reason code usulan
  `REFERENCE_IDENTITY_CHANGED` belum diimplementasikan. Gap HTTP E5/E9→resume
  yang sebelumnya dicatat sudah tertutup oleh bukti route-boundary ini.

### E.12 Follow-up C9 HTTP product mutation → resume — 2026-08-24

TASK=P0-C9-HTTP-PRODUCT-MUTATION-RESUME-20260824

- E3 retail diuji lewat `PATCH /api/products/[id]` aktual setelah admission
  HTTP `/api/jobs`, lalu entrypoint W2 `processJob`. E7 organisasi diuji lewat
  `PATCH /api/dashboard/campaign/product` aktual setelah admission dashboard
  `renderSatuSel`, lalu entrypoint W1 `processPostgresJob` pada PostgreSQL
  disposable. Mutasi yang diuji tidak digantikan oleh SQL manual.
- Kedua jalur membuktikan isolasi owner/org dan response+row produk terbaru.
  Gabungannya mencakup nama, kategori, trusted brand E3, deskripsi visual,
  brand brief dan claims E7, serta promo yang didukung masing-masing handler.
  E7 memang tidak menyediakan mutasi brand; E3 memang tidak menyediakan
  mutasi brand brief/claims, sehingga bukti tidak mengarang kemampuan route.
- Counterexample membangun snapshot dari row terbaru dan membuktikannya berbeda
  dari `job_product_snapshot` admission. Provider tetap menerima nama,
  deskripsi visual, dan brand brief admission; snapshot durable tetap membawa
  source/value trusted brand dan claims admission, tidak ditimpa worker.
- Guard struktural mengikat bukti ke export `PATCH` aktual dan entrypoint worker
  produksi. Setelah koreksi review, gate mandiri E3/W2 + helper/guard →
  **12/12 PASS, 0 skip**; W1 PostgreSQL disposable → **20/20 PASS, 0 skip**.
- Bukti E3 non-opsional tidak bergantung `.venv`, PATH, Python, atau OpenCV:
  seam person-safe deterministik hanya-test meneruskan path yang sama, lalu
  observer provider membuktikan counterexample admission→PATCH→worker. Fixture
  E7 menetapkan `RACUN_WORKER_DISABLED=1` dan queue inline sebelum import
  admission; row job diasersi tetap `QUEUED` tanpa provider sampai pemanggilan
  eksplisit `processPostgresJob`. Full suite → **1033 total, 999 PASS, 34
  skip, 0 fail**; `tsc --noEmit` dan `git diff --check` → **PASS**.
- C9 tetap **PARTIAL**: bukti ini tidak menerbitkan reason code fiktif
  `SNAPSHOT_IMMUTABLE`, dan tidak mengklaim jalur regenerate/entry lain yang
  belum diuji. Gap HTTP E3/E7→resume yang sebelumnya dicatat sudah tertutup.
