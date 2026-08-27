# P0-03 — PATH × CASE MATRIX

BASE_SHA=8ef9fdede97d1c4a72861dbf64c122c33272524e
BRANCH=work/p0-product-truth-20260820
TIMESTAMP=2026-08-20
METODE=call-site search read-only (Route Mapper subagent), BUKAN daftar handover
STATUS (20 Agu, historis)=inventaris SELESAI · red-before tests BELUM DITULIS
STATUS (27 Agu current)=**lihat E.29–E.40 untuk closure E1/C2/C3/C6/C8/new admission.**
Bagian A dan D adalah inventaris historis 20 Agu; kolom C menyatakan aggregate
case dan harus dibaca bersama closure current di E.29–E.34, bukan sendiri.

## A. Inventaris entrypoint — dari call-site nyata

Setiap baris punya `file:line`. GATED = memanggil pemeriksaan label/merek DAN
kelayakan. PARTIAL = sebagian. UNGATED = tidak sama sekali.

| # | file:line | jalur | status | memanggil |
|---|---|---|---|---|
| E1 | `app/api/products/route.ts:20` | POST create manual (retail) | **PARTIAL** | Setiap blob decodable melewati tri-state OCR + trusted `merekTerdaftar` sebelum storage. `OCR_FAILED` (503/retryable) dan actual `LABEL_UNREADABLE` (400/nonretryable) berbeda dan keduanya menolak sebelum persistence/audit; evidence OCR v1 ikut sidecar. Gap kasus non-C6 tetap terbuka |
| E2 | `app/api/products/extract/route.ts:17` | POST extract URL → buat produk | **UNGATED** | tidak ada; pakai `downloadProductImages` |
| E3 | `app/api/products/[id]/route.ts:13` | PATCH nama/harga/kategori/brand | **UNGATED** | tidak ada — memutasi `name` + `raw_meta.brand`, dua input yang justru dibaca gerbang |
| E4 | `app/api/products/[id]/photos/route.ts:44` | POST add-photo (retail) | **PARTIAL** | Setiap blob baru melewati tri-state OCR + brand gate sebelum persistence; `OCR_FAILED`/`LABEL_UNREADABLE` fail-closed, dan exact OCR provenance masuk sidecar. Resolver tetap me-rollback exact object baru saat reject/error sebelum append/audit; gap non-C6 tetap terbuka |
| E5 | `app/api/products/[id]/photos/route.ts:142` | DELETE foto (retail) | **UNGATED** | tidak ada — bisa menghapus satu-satunya foto layak |
| E6 | `app/api/dashboard/campaign/product/route.ts:45` | POST produk org | **UNGATED** | tidak ada; `downloadProductImages` → sidecar tidak ditulis |
| E7 | `app/api/dashboard/campaign/product/route.ts:99` | PATCH produk org | **UNGATED** | mengubah `name`, `price`, **`category`**, visual desc, `brand_brief`, promo, claims (:113 dst) TANPA revalidasi. TIDAK menyentuh `raw_meta.brand`. Defect kedua: jalur org TIDAK PERNAH mengisi `raw_meta.brand`, padahal worker hanya mempercayai field itu (`merekTepercaya`) |
| E8 | `app/api/dashboard/campaign/product/[id]/photos/route.ts:26` | POST add-photo (org) | **PARTIAL** | Setiap upload baru melewati tri-state OCR + brand gate sebelum storage/list/audit, termasuk saat produk sudah punya foto; `OCR_FAILED`/`LABEL_UNREADABLE` fail-closed dan provenance exact ditulis. Append PostgreSQL memakai CAS exact ordered snapshot existing; gap non-C6 tetap terbuka |
| E9 | `app/api/dashboard/campaign/product/[id]/photos/route.ts:84` | DELETE foto (org) | **UNGATED** | tidak ada |
| W1 | `lib/postgres/worker.ts:321-323` | worker PG | **PARTIAL** | manifest v2 mewajibkan hash-bound OCR `READABLE` v1; missing/stale/forged/failed provenance dan runtime OCR/label failure menolak pre-provider. Gap aggregate non-C6 tetap partial |
| W2 | `lib/worker.ts:104-109` | worker inline/SQLite | **PARTIAL** | manifest v2 mewajibkan hash-bound OCR `READABLE` v1; missing/stale/forged/failed provenance dan runtime OCR/label failure menolak pre-provider. Gap aggregate non-C6 tetap partial |
| A1 | `app/api/jobs/route.ts:29,62-67` | admission retail + payload | **PARTIAL** | E.31 bounded evidence lease accepted pre-provider/setup; case non-C8 tetap partial |
| A2 | `app/api/dashboard/matrix/route.ts:93,106` | admission matrix | **PARTIAL** | E.31 bounded evidence lease accepted pre-provider/setup; duplicate replay dipertahankan; case non-C8 tetap partial |
| A3 | `app/api/dashboard/campaign/generate/route.ts:44-49` | generate campaign | **PARTIAL** | E.31 bounded evidence lease accepted pre-provider/setup; case non-C8 tetap partial |
| A4 | `lib/dashboard/render-cell.ts:158-160,225` | INSERT QUEUED + enqueue | **PARTIAL** | durable manifest boundary dan E.31 C8 counterexamples accepted; case non-C8 tetap partial |
| A5 | `app/api/dashboard/campaign/confirm/route.ts:45` | confirm campaign → enqueue | **PARTIAL** | E.31 bounded evidence lease accepted pre-provider/setup; case non-C8 tetap partial |
| A6 | `app/api/dashboard/campaign/job/[jobId]/route.ts` | approve / regenerate job | **PARTIAL** | manifest immutable dan E.31 evidence lease accepted sebelum charge/reset/enqueue; case non-C8 tetap partial |
| A7 | `app/api/scripts/generate/route.ts` | generate naskah (provider-consuming, BUKAN admission render berbayar) | **PARTIAL** | E.31 bounded evidence lease accepted pre-provider/setup; case non-C8 tetap partial |
| D1 | `lib/postgres/product-persona-script.ts:57,112,134-136,255,264` | penulis DB produk/brand | **UNGATED** | tidak ada |
| D2 | `lib/postgres/smoke-runtime.ts:310,319,336` | set/append/remove images | **UNGATED** | tidak ada |

**Terbukti TIDAK ADA** (jangan dibuatkan test): route reorder foto
(`rg reorder app/api` → 0), DELETE produk (`export async function DELETE` di
`products/[id]/route.ts` → 0), server actions (`rg '"use server"' app/` → 0),
`app/api/dashboard/bulk/route.ts` (tidak ada berkasnya; masih disebut komentar
`lib/product-image-download.ts:3`).

## B. Temuan yang MENGOREKSI work order

Work order menyebut tiga bypass (create utama, extract, worker). Yang nyata:

1. **DIUBAH 24 Agu:** `referensiLayak` semula hanya menjaga E4; kini E8 juga
   memanggilnya setelah ingestion. Entrypoint lain yang dicatat tetap belum
   seluruhnya dijaga.
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

| # | Kasus | Jalur wajib diuji | Keputusan diharapkan | reason code / status implementasi | Status |
|---|---|---|---|---|---|
| C1 | Foto#1 banner, foto#2 packshot valid | E1,E2,E4,E6,E8,A1..A5,**A6**,W1,W2 | **produk DITERIMA**; foto#1 berstatus promotional; approved reference WAJIB foto#2 + hash-nya. **A6 (approve/regenerate) wajib MEMPERTAHANKAN snapshot** — ia membangunkan worker lagi. `REF_PROMOTIONAL` adalah STATUS FOTO, bukan penolakan produk | `REF_PROMOTIONAL` (status) | **PARTIAL** |
| C2 | Toothpaste diberi kategori facewash | E1,E3,E6,E7,A1..A4 | reject sebelum spend | `TYPE_MISMATCH` (**usul**) | **BLOCKED** |
| C3 | Merek salah | E1,E4,E8,W1,**W2** | reject | `BRAND_MISMATCH` (**canonical dan explicit-false enforcement accepted di seluruh jalur ini; null/unreadable policy terpisah**) | **PARTIAL aggregate** |
| C4 | Label gibberish / tak terbaca | E1,E4,E8 | reject | `LABEL_UNREADABLE` (**canonical E4/E8; enforcement lain partial**) | **PARTIAL** |
| C5 | Kategori unknown/ambigu/bundle | E1,E3,E6,E7 | manual review | `CATEGORY_UNKNOWN` (**usul**) | **BLOCKED** |
| C6 | OCR timeout/error/ambigu | E1,E4,E8,A1..A7,W1,W2 | fail-closed sebelum persistence/spend/provider | `OCR_FAILED` (**canonical**, HTTP 503, retryable) | **PASS** |
| C7 | Classifier timeout/error/ambigu | E1,E4,E8 | fail-closed | `CLASSIFIER_FAILED` (**canonical; coverage partial**) | **PARTIAL** |
| C8 | Evidence hilang/korup/basi/hash beda | E1,**E2**,**E4**,E6,E8, mutation boundary **E3/E5/E7/E9** (stale evidence), **A1..A7**,W1,W2 | fail-closed sebelum hold/capture/**regen**/enqueue/provider/deliverable; tanpa sisa state invalid persisten. Untuk A6 khusus: buktikan **nol ledger `regen`** | `EVIDENCE_INVALID` (**canonical; A1–A7/new admission accepted E.31**) | **PARTIAL aggregate; admission slice PASS** |
| C9 | Foto/nama/brand/kategori berubah SESUDAH admission | E3,E5,E7,E9 → W1,W2 | job pakai snapshot lama | `SNAPSHOT_IMMUTABLE` (**usul**) | **PARTIAL** |
| C10 | Produk legacy tanpa evidence | W1,W2,A1..A4 | karantina | `LEGACY_UNVALIDATED` (**usul**) | **PARTIAL** |
| C11 | Berkas referensi hilang saat worker mulai | W1,W2 | fail-closed, tanpa capture | `REF_MISSING` (**canonical**) | **PASS** |
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
- **CATATAN HISTORIS 20 Agu (sudah disupersede E.3/E.16):** reason code di
  atas saat itu masih usulan. Pada tree kini `BRAND_MISMATCH` dan
  `LABEL_UNREADABLE` sudah canonical di gate E4/E8; cakupan agregatnya tetap
  parsial seperti dirinci E.16.
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
| **BLOCKED** | penerimaan belum dapat dinyatakan karena implementasi lokal belum ada, atau karena authority/kredensial/deploy; penyebab wajib disebut eksplisit |
| **NOT-APPLICABLE** | tidak relevan pada kontrak yang berlaku sekarang |

`BLOCKED` bukan klaim bahwa penyebabnya selalu eksternal. C2 sudah ditutup oleh
accepted Product Policy dan implementasi E.39; C6 ditutup oleh keputusan
Founder dan implementasi E.40. C5 tetap memerlukan keputusan/implementasi lokal.

### E.1 Entrypoint: apa yang BERUBAH sejak 2026-08-20

| # | Status 20 Agu | Status 23 Agu | Bukti |
|---|---|---|---|
| E1 create manual | PARTIAL | **PARTIAL** | `saveProductImages` → `tulisSidecar`, lalu canonical resolver sebelum kedua seam persistence. **C2 ditutup E.39:** explicit product type + human self-confirmation divalidasi sebelum storage/row/audit; mismatch `TYPE_MISMATCH` bernilai nol efek. **Gap E1 label/brand/reference ditutup 24 Agu:** setiap blob memakai `periksaLabelFoto` + `merekTerdaftar`; reject/resolver/DB failure membersihkan exact object baru sebelum row/audit. Tetap PARTIAL karena OCR fail-open dan gap matriks lain |
| E2 extract URL | UNGATED | **PARTIAL** | `downloadProductImages` → `tulisSidecar` (`lib/product-image-download.ts:48`). Dulu nol sidecar |
| E3 PATCH retail | UNGATED | **PARTIAL** | mutasi ini tidak membatalkan sub-kontrak sidecar/hash karena vonis referensi membaca sidecar. **C2 ditutup E.39:** hanya confirmation baru atau durable state `CONFIRMED` yang dapat melintasi mutation callback; mismatch gagal sebelum row/audit/brand write. C3/C5 tetap terbuka |
| E4 add-photo retail | PARTIAL | **PARTIAL** | sidecar terbit; append daftar atomik memakai key UUID. **Gap foto #2+ ditutup 24 Agu:** seluruh blob decodable melewati label+brand gate sebelum satu pun persistence. **Gap rollback C7 ditutup 24 Agu:** no-reference atau resolver error membersihkan exact foto baru+sidecar sebelum append/audit; bila cleanup sendiri gagal, respons 500 dan log menyatakan risiko residual—bukan klaim nol-storage palsu. Status tetap PARTIAL karena fail-open OCR dan verifikasi ulang hash masih terbuka |
| E5 DELETE foto retail | UNGATED | **PARTIAL** | `removeRetailProductImage` menghitung daftar otoritatif secara atomik, lalu `deleteStoredProductImages([target])` best-effort; `cleanup_failed` terlihat, audit pasca-commit non-fatal, dan test HTTP→resume W2 membuktikan manifest job tetap menang atau `REF_MISSING` gagal tertutup. Daftar baru tetap belum direvalidasi |
| E6 create org | UNGATED | **PARTIAL** | `downloadProductImages` → sidecar terbit. **C2 ditutup E.39:** explicit type + confirmation mendahului extraction/download/persistence/audit. Gap lain tetap terbuka |
| E7 PATCH org | UNGATED | **PARTIAL** | observasi sidecar/hash sama dengan E3. **C2 ditutup E.39** dengan durable `CONFIRMED` state atau confirmation baru sebelum mutation/audit. C3/C5 tetap terbuka |
| E8 add-photo org | PARTIAL | **PARTIAL** | `saveUniqueProductImages` → `tulisSidecar` (`:327`). **Gap label/brand ditutup 24 Agu:** setiap upload baru memakai `periksaLabelFoto` + `merekTerdaftar(owned.product)` sebelum persistence, bukan hanya foto pertama. **Gap rollback C7 ditutup 24 Agu:** resolver menilai existing+added dan append mengikat exact ordered existing snapshot lewat optimistic CAS. Tetap PARTIAL karena OCR fail-open dan gap lain pada matriks |
| E9 DELETE foto org | UNGATED | **PARTIAL** | sesudah `pgRemoveOrgProductImage`, memanggil `deleteStoredProductImages([target])` secara best-effort (`app/api/dashboard/campaign/product/[id]/photos/route.ts:94-98`), yang menghapus file dan sidecar. Test HTTP→resume W1 membuktikan isolasi org, daftar otoritatif, dan manifest job tetap menang atau `REF_MISSING` gagal tertutup. Daftar baru belum direvalidasi agar tetap punya foto layak |
| W1 worker PG | UNGATED | **PARTIAL** | Resolver, manifest job atomik/idempoten, reuse lintas invocation, verifikasi bytes di boundary provider/output, C1/C8/C11, explicit C3 brand mismatch, dan legacy fail-closed dibuktikan di PostgreSQL disposable. Snapshot field produk non-referensi dan aggregate cases lain tetap partial |
| W2 worker inline | UNGATED | **PARTIAL** | Kontrak manifest/reuse/verifikasi/legacy dan explicit C3 brand mismatch yang sama dibuktikan langsung pada worker SQLite; C8/C11 tetap memakai observer provider. Snapshot field produk non-referensi dan aggregate cases lain tetap partial |
| A1..A7 admission | UNGATED | **PASS untuk C8/new admission + C6** | Tujuh path mengambil bounded product-evidence lease sebelum provider/setup effect. E.40 mewajibkan exact hash-bound OCR `READABLE` v1; missing/stale/failed provenance dikarantina dengan `OCR_FAILED` sebelum spend/provider. Duplicate replay tetap dipertahankan |
| D1 penulis produk/brand | UNGATED | **PARTIAL** | Reachable production melalui E1/E2/E3/E6. Semua create yang membawa image keys didahului helper bersidecar; direct caller lain hanya verifier disposable. Namun writer menerima `images` mentah dan mutation E3 name/category/brand tidak merevalidasi product-truth. Audit: `D1D2-DIRECT-WRITER-AUDIT.md` |
| D2 penulis daftar images | UNGATED | **PARTIAL** | Reachable production hanya melalui E4/E5/E8/E9. Add menerima keys dari helper bersidecar; delete retail/org sudah membersihkan storage, tetapi revalidation E5/E9 dan gerbang E8 tetap belum lengkap. Tidak ada CLI/direct caller tersembunyi. Audit: `D1D2-DIRECT-WRITER-AUDIT.md` |

### E.2 Kasus C1-C13 — alasan tiap status

**Cacah setelah implementasi C6 E.40: tiga PASS, sembilan PARTIAL, satu BLOCKED.**
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
| C2 | **PASS** | Accepted Product Policy E.39 memisahkan opaque canonical product type dari merchandising category, menyimpan actor/timestamp/version `USER_SELF_ASSERTION`, dan mengarantina missing/legacy state. E1/E3/E6/E7 serta A1–A4 memakai central identity-bound seam; mismatch menghasilkan `TYPE_MISMATCH` sebelum persistence/admission/spend/provider effect, missing/unconfirmed fail-closed, dan normalized match mengeksekusi callback tepat sekali. Ordinary E3/E7 save tidak menulis ulang provenance dan berbagi lock dengan A2/A3; A1 merevalidasi row yang di-lock/admit. GREEN 5/5, implementation 7/7, focused regression 45/45, full suite 0 fail |
| C3 | **PARTIAL** | E1, E4, E8, W1, dan W2 menolak explicit `cocokMerek === false` dengan canonical `BRAND_MISMATCH` sebelum persistence/provider effect; W1/W2 closure accepted di E.30. Aggregate tetap PARTIAL untuk jalur lain dan null/unreadable OCR policy; bukan karena explicit worker mismatch belum diimplementasikan |
| C4 | **PARTIAL** | E1, E4, dan E8 menolak `!label.terbaca` untuk setiap blob baru sebelum persistence dengan canonical `LABEL_UNREADABLE` (HTTP 400, `retryable:false`, alasan Indonesia dari OCR atau fallback actionable). Cakupan belum lengkap: kebijakan OCR execution error tetap fail-open |
| C5 | **BLOCKED** | Diblokir implementasi lokal: `CATEGORY_UNKNOWN` dan jalur manual review belum ada |
| C6 | **PASS** | Founder memilih fail-closed tri-state. E1/E4/E8 menormalisasi dulu lalu memeriksa exact WebP bytes, membedakan runtime/timeout/ambiguity `OCR_FAILED` (503/retryable) dari hasil inspeksi nyata `LABEL_UNREADABLE` (400/nonretryable) sebelum persistence. Opaque batch mengikat SHA inspected=stored=sidecar=manifest; E2/E6 hasil extraction tanpa inspeksi menjadi draft `OCR_FAILED`. A1–A7 mewajibkan exact hash-bound `READABLE` v1 sebelum spend/setup, dan manifest v2 membuat W1/W2 menolak legacy/missing/stale/forged/failed provenance sebelum provider. Full suite 1266/1218/0/48 |
| C7 | **PARTIAL** | Classifier menghasilkan keadaan ketiga `belum_diperiksa` dan resolver menerjemahkannya jadi `CLASSIFIER_FAILED`. E1, E4, dan E8 kini fail-closed sebelum persistence/audit serta me-rollback exact object baru pada no-reference maupun resolver error; cleanup sukses membuktikan nol object baru, sedangkan cleanup fault dilaporkan 500+log dengan risiko residual yang jujur. Cakupan kasus lain pada matriks belum lengkap; karena itu C7 tetap PARTIAL |
| C8 | **PASS untuk new admission** | E1 actual POST, W1/W2, dan accepted E.31 A1–A7 menolak evidence hilang/korup/hash mismatch sebelum persistence/provider/setup effect, dengan rollback/observer/counterexample langsung. Legacy treatment tetap dicatat terpisah pada C10/C12 |
| C9 | **PARTIAL** | Sub-kontrak identitas foto DAN metadata core worker tertutup: W1/W2 memakai admission manifest bytes serta snapshot job versioned untuk nama, trusted brand source/value, kategori, deskripsi visual, brand brief, claims, dan sell price. Actual E3→W2 serta E7→W1 membuktikan prompt tetap admission-bound tetapi rendered promo before/deadline dibaca live; frame W2 gain/removal dan W1 change diterima di E.23. Stock juga live tetapi inert di formatter. Tetap PARTIAL sampai Founder memilih `PROMO_POLICY=SNAPSHOT` atau `LIVE_INTENTIONAL`; `SNAPSHOT_IMMUTABLE` tetap proposal-only |
| C10 | **PARTIAL** | W1/W2 menolak produk legacy tanpa sidecar dengan `EVIDENCE_INVALID`/`SIDECAR_MISSING` (`tests/pg-product-truth-w1.test.ts:302`; `tests/product-truth-worker-reference.test.ts:288`), dan E.31 menutup fail-closed A1–A7 untuk new admission. Treatment data legacy tetap belum ditentukan; angka media legacy juga belum diketahui karena R2 staging berpasangan belum tersedia |
| C11 | **PASS** | Test bernama `W1 C11` dan `W2 C11` menjalankan kedua worker dengan sidecar sah tetapi payload absen sejak worker mulai. Keduanya mengunci jalur `REF_MISSING`, urutan baca sidecar→payload, nol materialize/provider/fetch/capture/regen/output/storage write, dan state akhir fail-closed. Observer provider punya counterexample positif dari suite yang sama dan reset per-test |
| C12 | **PARTIAL** | Gap local admission-time identity untuk job baru sudah tertutup: tiga production admission memasang ordered job-owned manifest sebelum job/hold/queue visible; known non-winner cleanup dan successful-retry surplus pruning mempertahankan winner/ambiguity. W1/W2 tidak membaca ulang daftar, dan E5/E9→resume memakai bytes admission. Agregat tetap PARTIAL karena legacy fallback/treatment dan reason code usulan `REFERENCE_IDENTITY_CHANGED` belum canonical; tidak diperlukan task implementasi admission-manifest baru |
| C13 | **PARTIAL** | Kontrol positif W1 (`tests/pg-product-truth-w1.test.ts:740`) dan W2 (`tests/product-truth-worker-reference.test.ts:638`) membuktikan worker menerima bukti sah. Itu belum membuktikan produk valid diterima melalui seluruh E1..E9 dan A1..A7 yang diwajibkan baris ini |

### E.3 Bagian D dokumen ini sudah usang — dikoreksi

Bagian D ("Yang BELUM diverifikasi", 2026-08-20) menyatakan belum ada
boundary test C1/C8 dan reason code masih usulan. Per e8a00a5:

- boundary test C1 dan C8 **ADA** di kedua worker (lihat E.2);
- lima reason code sudah nyata (`REF_PROMOTIONAL`, `CLASSIFIER_FAILED`,
  `EVIDENCE_INVALID`, `REF_MISSING`, `REF_HASH_MISMATCH`). Dengan usulan baru
  `REFERENCE_IDENTITY_CHANGED`, delapan reason code masih usulan; status
  kasusnya tetap PARTIAL atau BLOCKED sesuai cakupan nyata;
- **Pembaruan current tree (E.16):** `BRAND_MISMATCH` dan `LABEL_UNREADABLE`
  juga sudah nyata pada E4/E8. Pernyataan hitungan di butir sebelumnya adalah
  rekonsiliasi historis exact tree `e8a00a5`, bukan status current tree;
- jalur promo tetap di luar cakupan dan tetap belum diputuskan siapa pun.

### E.4 Sisa P0/P1, dipisah menurut APA yang menahannya

**(a) Bisa dikerjakan LOKAL sekarang — kandidat task berikutnya, TIDAK
dikerjakan di slice ini:**

1. **DITUTUP 24 Agu:** gerbang label E4 memeriksa semua blob baru sebelum
   persistence; foto #2+ dan mixed multipart invalid ditolak atomik.
2. **DITUTUP 24 Agu:** E8 menjalankan `periksaLabelFoto` dengan
   `merekTerdaftar(owned.product)` untuk setiap upload baru, termasuk foto
   tambahan, dan menolak unreadable/brand-false sebelum persistence.
3. `label-terbaca.ts:188` fail-OPEN saat pemeriksaan gagal. Keputusannya
   disengaja dan beralasan ("menyaring foto buruk, bukan menjaga uang"), tapi
   baris C6 mengharapkan fail-closed. **Salah satu dari keduanya harus
   dikoreksi** — matriks atau kodenya; itu keputusan produk, bukan pembersihan
   dokumen.
4. **C2 sudah DITUTUP E.39** dengan `TYPE_MISMATCH` dan durable confirmation;
   C5 masih belum punya reason code maupun jalur penegakan. **Explicit C3 sudah
   DITUTUP di E1/E4/E8 dan W1/W2:** semuanya memakai canonical
   `BRAND_MISMATCH`. Agregat C3/C4 tetap PARTIAL untuk jalur lain dan karena OCR
   error/null tetap fail-open, seperti dirinci E.30/E.31.
5. Snapshot metadata job menutup pembacaan ulang core prompt W1/W2. Rendered
   frame proof E.23 menunjukkan promo before/deadline tetap live dan stock live
   tetapi inert; perubahan berikutnya menunggu pilihan Founder
   `PROMO_POLICY=SNAPSHOT` atau `LIVE_INTENTIONAL`.
6. **DITUTUP 24 Agu untuk new-job admission identity:** tiga admission memasang
   manifest sebelum visibility; E5/E9→resume, cleanup known-loser, serta
   successful-retry pruning dibuktikan. C12 agregat tetap PARTIAL hanya untuk
   legacy/treatment dan reason-code authority, bukan karena implementasi
   admission manifest masih diperlukan.
7. C7 belum fail-closed pada seluruh boundary. **Sub-gap E1, E4, dan E8 sudah
   ditutup 24 Agu:** no-reference/resolver error me-rollback exact object baru
   sebelum row/append/audit; cleanup fault tetap non-success dan observable,
   dengan risiko residual dicatat jujur.
**(b) Butuh kredensial/data:**

8. Angka audit legacy P0-B3 (C10) — akses agregat database staging sudah
   terbukti 24 Agu, tetapi ember media tetap butuh R2 yang BERPASANGAN; audit
   legacy tidak dijalankan.

**(c) Butuh deploy/migrasi:**

9. Kapabilitas klasifikasi runtime web (P0-B2) — **VERIFIED_MANAGED: capable**
   pada exact `73280ffa342945dc08cee2fc664956975c8d5735`, deploy
   `dep-da63g43tqb8s739gkasg`. Managed Docker build, 35/35 migration, exact
   build identity, sandbox/non-live payment state, ffmpeg/ffprobe/tesseract,
   OCR language, dan production-pipeline classifier smoke semuanya PASS.
   Maintenance sampler merekam hold 503 sepanjang rollout dan stabil 200
   setelah release; aggregate task-window tetap nol dan allowlist DB dipulihkan.
   Safe admission-only canary `NOT_RUN` karena tidak ada endpoint non-paid yang
   aman; tidak ada job/provider yang dibuat. Bukti ada di
   `managed-classifier-retry-20260824/`. Ini tidak mengizinkan production atau
   real money.

**(d) T43 sudah diotorisasi; bounded admission selesai, sisa scope harus
dibatasi ulang:**

10. Penegakan admission A1..A7/P0-B5 sudah accepted di E.31. Hanya P0-B4
    action di luar explicit C3 yang mungkin masih punya slice policy-free;
    authority persis dan batas HOLD ada di
    `managed-staging-exact-sha-20260824/FOUNDER-DECISION-UGC-AUTHORITY-UNBLOCK.md`;
    Reviewer harus membatasi slice itu atau menyatakan tidak ada scope teknis
    tersisa tanpa keputusan OCR/legacy/promo.

### E.5 Yang TIDAK dilakukan di slice ini

Pada slice rekonsiliasi asal, nol perubahan produk atau test dilakukan dan
tidak satu pun status dinaikkan. Follow-up terpisah E.6 dan E.7 menambahkan
bukti test langsung untuk gap yang kemudian disetujui sebagai task bounded.

### E.6 Follow-up W2 C8 provider observer — 2026-08-23 (HISTORICAL slice; superseded by E.31)

TASK=P0-W2-C8-PROVIDER-OBSERVER-20260823

- `tests/product-truth-worker-reference.test.ts`: satu observer seam dipasang
  per W2 C8 case; counter bertambah sebelum fake provider melempar, diasersi
  nol pada evidence invalid, dan selalu direset lewat `t.after` pada success/failure.
- Control counterexample memanggil provider seam secara sengaja dan membuktikan
  counter berubah dari 0 menjadi 1, sehingga asersi nol tidak hampa.
- `tsx --test tests/product-truth-worker-reference.test.ts` → **12/12 PASS**.
- Suite product-truth non-PG terdampak (`product-truth-evidence`, ingestion,
  worker-wiring) → **99/99 PASS**.
- Pada slice historis ini gap observer W2 C8 ditutup, tetapi A1–A7 saat itu
  belum menegakkan evidence gate. Status itu disupersede E.31: bounded A1–A7
  new-admission enforcement kini accepted exact SHA.

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

### E.13 Follow-up C7 E4 rejected-reference rollback — 2026-08-24 (HISTORICAL slice; E1 superseded by E.29)

TASK=P0-E4-REJECTED-REFERENCE-ROLLBACK-20260824

- Sesudah `saveUniqueProductImages`, seluruh keputusan `referensiLayak` hingga
  no-reference berada dalam satu failure boundary sebelum
  `appendRetailProductImages` dan audit. Reject normal dan resolver error
  membersihkan hanya `added` beserta sidecar; foto existing dan object tak
  terkait tidak disentuh.
- Cleanup sukses melempar ulang error asli: no-reference tetap BAD_REQUEST
  yang actionable. Cleanup fault tidak mengarang atomic success: list/audit
  tetap nol-mutasi, respons 500, dan log menyatakan bahwa object residual
  mungkin tersisa serta memerlukan rekonsiliasi operator.
- Exported POST test memakai storage/classifier deterministik dan mencakup
  reject promosi, resolver throw, delete fault terkontrol, serta control foto
  layak. Guard AST menolak cleanup terhadap `existing`, cleanup tanpa await,
  cleanup fault yang disamarkan, append di dalam failure boundary, dan
  rollback di luar catch resolver.
- Focused route+guard → **11/11 PASS**; affected ingestion/evidence/route →
  **132/132 PASS**; full suite → **1115 total, 1076 PASS, 39 skip, 0 fail**;
  `tsc --noEmit` dan `git diff --check` → **PASS**. Audit script catalog tidak
  dijalankan karena slice tidak mengubah katalog, template, atau naskah.
- E4 dan C7 tetap **PARTIAL**: E1 belum menjalankan resolver, kebijakan OCR
  E4 tetap fail-open, dan gap lain pada matriks tidak diubah oleh slice ini.

### E.14 Follow-up C7 E8 reference eligibility rollback — 2026-08-24 (HISTORICAL slice; E1 superseded by E.29)

TASK=P0-E8-REFERENCE-ELIGIBILITY-ROLLBACK-20260824

- Sesudah `saveUniqueProductImages`, E8 memanggil
  `referensiLayak([...owned.images, ...added])` sebelum PostgreSQL append/audit.
  Daftar tanpa satu pun acuan layak ditolak dengan BAD_REQUEST yang actionable;
  resolver/read error dilempar ulang setelah cleanup.
- Helper rollback bersama E4/E8 menghapus hanya `added` beserta sidecar.
  Cleanup fault tidak menerbitkan append/audit dan menghasilkan 500 yang
  mengakui bahwa object residual mungkin tersisa.
- Remediasi Reviewer mengikat snapshot eligibility ke publication:
  `pgAppendOrgProductImages` menerima exact ordered `owned.images` dan UPDATE
  hanya menang bila normalized current `images::jsonb` masih sama. CAS miss
  tidak di-retry memakai snapshot basi; upload baru di-rollback dan route
  mengembalikan BAD_REQUEST concurrent-update tanpa audit.
- Exported E8 test deterministik mencakup reject promosi tanpa existing,
  existing tak layak, resolver error, cleanup fault, serta control foto layak.
  Guard AST bersama menolak urutan existing+added terbalik, boundary rollback
  salah, append di dalam failure boundary, rollback di luar catch, dan resolver
  yang dihilangkan; suite E4 menjaga parity helper yang sama.
- Focused CAS/route/guard → **18 total, 17 PASS, 1 skip, 0 fail**; affected
  route/resolver/evidence → **207 total, 182 PASS, 25 skip, 0 fail**; satu
  bounded full suite → **1118 total, 1078 PASS, 40 skip, 0 fail**;
  `tsc --noEmit` dan `git diff --check` → **PASS**. Gate PostgreSQL disposable
  dilewati secara eksplisit karena `UJI_PG_URL` kosong; route race dan SQL
  structural/counterexample tetap dijalankan. Audit script catalog tidak
  dijalankan karena slice tidak mengubah katalog, template, atau naskah.
- E8 dan C7 tetap **PARTIAL**: OCR fail-open, E1 tanpa resolver, dan gap lain
  pada matriks tidak diubah oleh slice ini.

### E.15 Follow-up E8 every-upload label/brand gate — 2026-08-24

TASK=P0-E8-ALL-UPLOADS-LABEL-BRAND-GATE-20260824

- E8 mengiterasi setiap blob baru dan menjalankan `periksaLabelFoto` dengan
  registered brand otoritatif sebelum `saveUniqueProductImages`, list CAS,
  atau audit. Jumlah foto existing tidak lagi menjadi bypass.
- Exported POST tests membuktikan foto tambahan unreadable dan brand mismatch
  ditolak tanpa storage/list/audit; foto tambahan valid tetap mencapai
  resolver/CAS; perilaku foto pertama dan cleanup temporary tetap dicakup.
- Guard AST menolak first-photo conditional, gate tanpa registered brand,
  hasil unreadable/brand yang dibuang, early exit, dan persistence sebelum
  seluruh gate selesai.
- Verifikasi akhir: focused `13 total / 12 pass / 1 skip / 0 fail`;
  affected `71 total / 46 pass / 25 skip / 0 fail`; tepat satu full suite
  `1118 total / 1078 pass / 40 skip / 0 fail`; `npx tsc --noEmit` PASS;
  `git diff --check` PASS. Skip PostgreSQL tetap eksplisit karena
  `UJI_PG_URL` kosong; katalog tidak dijalankan karena tidak terdampak.
- Pada SHA slice E.15, E8/C3/C4 tetap **PARTIAL** karena E1, worker brand
  enforcement, reason code khusus, dan OCR fail-open berada di luar slice itu.
  Status current tree setelah reason-code follow-up dicatat di E.16.

### E.16 Follow-up C3/C4 canonical API reason codes — 2026-08-24 (HISTORICAL slice; E1/W1/W2 superseded by E.29/E.30)

TASK=P0-C3C4-CANONICAL-API-REASON-CODES-20260824

- Factory `ApiError` canonical `BRAND_MISMATCH` dan `LABEL_UNREADABLE`
  mempertahankan status HTTP 400, `retryable:false`, English meaning yang sudah
  berlaku, serta `label.alasan` Indonesia bila terisi. Alasan kosong/whitespace
  mendapat fallback Indonesia yang actionable; tidak ada perubahan pada
  semantics acceptance classifier/OCR.
- Empat branch gate yang sudah enforced—E4 unreadable/brand dan E8
  unreadable/brand—tidak lagi memakai generic `BAD_REQUEST`. Tidak ada perubahan
  E1, worker, classifier, OCR fail-open, T43, atau staging.
- Exported route-boundary tests mencakup foto pertama dan tambahan untuk kedua
  reason code, exact code/status/message/retryable, nol storage/list/audit pada
  reject, dan control valid. Guard AST mengikat condition ke factory canonical
  dan menolak implementasi generic maupun reason code yang tertukar.
- Focused route+guard → **15 total, 14 PASS, 1 skip, 0 fail**; affected
  route/intake/ownership/resume → **83 total, 58 PASS, 25 skip, 0 fail**;
  tepat satu full suite → **1118 total, 1078 PASS, 40 skip, 0 fail**;
  `npx tsc --noEmit` dan `git diff --check` → **PASS**. Skip PostgreSQL tetap
  eksplisit karena `UJI_PG_URL` kosong; katalog tidak dijalankan karena slice
  tidak mengubah katalog, template, atau naskah.
- C3/C4 tetap **PARTIAL** secara agregat: E1 belum menjalankan gate, W1/W2 belum
  menegakkan brand mismatch, dan kebijakan OCR error tetap fail-open. Slice ini
  hanya menutup reason-code sub-gap pada gate E4/E8 yang sudah ada.

### E.17 Current PostgreSQL evidence reconciliation — 2026-08-24

TASK=SHIP-READINESS-CANONICAL-POSTGRES-RECONCILE-20260824

- Angka full suite 40 skip pada E.14–E.16 adalah hasil historis exact slice,
  bukan latest current evidence. Current accepted evidence adalah
  `9e1d13d5544d8a996998283d9cc8496848848a6b` atas code
  `de1a6ef53bdfb4de14d01e8c13cc223a54cddd61`: **1.119 total / 1.115 PASS /
  0 fail / 4 skip / 0 cancelled / 0 todo**.
- Empat skip hanya berasal dari `qcf1-tiga-keadaan`: artefak historis PALSU
  tidak tersedia, dan tiga test juga perlu opt-in eksplisit Gemini berbayar.
  Tidak ada izin panggilan berbayar atau pembuatan artefak pengganti.
- PostgreSQL lokal tersedia. Aggregate memakai database unik pada
  loopback, menjalankan migrasi dan kedua env DB pada URL disposable yang sama,
  lalu `DROP ... WITH (FORCE)` dengan residue nol. W1 **25/25**, money **11/11**,
  dan D2 **4/4** berasal dari evidence accepted
  `09cddfbb5940f2d6d72a3624c0ea2ff6d2f7a410` atas code
  `b6bc116b1640fd561c982349262e5e070fa07f64`; TypeScript, build, dan audit
  katalog juga PASS.
- Perbaikan retry tidak mengubah matrix acceptance: isolation tetap
  `SERIALIZABLE`, seluruh transaksi diulang hanya untuk `40001`/`40P01`, dan
  backoff/retry tetap bounded. C3/C4 dan gap E/A/W lain tetap pada status
  sebelumnya.
- Bukti lokal ini menutup gap reliabilitas evidence/test, bukan R2A ceiling,
  deployed exact SHA, staging/E2E, payments, legal, incident/DR, atau satu
  production cycle. Skor shipping canonical tetap **58/100** dan production
  `autoDeploy=yes` tetap P1 unresolved.

### E.18 C9/C12 structural inventory — 2026-08-24

TASK=`P1-C9-C12-STRUCTURAL-INVENTORY-20260824`

- Exact-baseline inventory at `752684eefc60a3ccb13f59e5b3daf98a83adf652`
  mechanically found three production job admissions. All three atomically
  install `job_product_snapshot`; none installs
  `approved_reference_manifest`.
- C9 is admission-bound only for the core fields represented by
  `job_product_snapshot`: name, category, price, trusted brand, visual
  description, brand brief, and claims. Promo price-before, deadline, and stock
  are excluded; W1/W2 read them from the current product row and use them in
  `resolvePromo`/compositor overlays. E3/E7 can therefore change rendered promo
  claims after admission. Existing mutation tests stop at provider-prompt
  observers and do not cover this output boundary. `SNAPSHOT_IMMUTABLE` remains
  proposal-only.
- This is an append-only correction to the broader historical wording in the
  main C9 row and E.10/E.12: “metadata snapshot” there means only the represented
  core subset, not promo overlay inputs.
- Correction/addition to the earlier C12 summary: after the first manifest
  install, E5/E9, retry/resume, A6, W1, and W2 preserve and reverify immutable
  job-owned bytes. Before that install, a queued job can observe a mutated
  `products.images` list and install the post-mutation identity. This is not a
  violation of the settled after-install rule; adopting the stronger
  admission-time identity contract requires an approved implementation task.
- Current reference errors include `NO_APPROVED_REFERENCE`, `REF_MISSING`,
  `REF_HASH_MISMATCH`, `REF_MANIFEST_INVALID`, and
  `REF_MANIFEST_LEGACY_UNSAFE`; `REFERENCE_IDENTITY_CHANGED` is proposal-only.
- Retail E3/E5 select SQLite or PostgreSQL at runtime, so they can resume into
  W2 or W1. Existing direct route evidence covers E3/E5→W2 and E7/E9→W1;
  E3/E5→W1 is explicitly uncovered.
- Bounded follow-up recommendation: install the reference manifest atomically at
  all three production admission boundaries and add W1/W2 admission → queued
  E5/E9 mutation → first-worker tests, plus direct retail PostgreSQL E3/E5→W1
  cases. Preserve the full current reason-code set unless a separate approved
  work order authorizes a change.
- Separate C9 evidence/policy boundary: add W1/W2 rendered-output tests for E3/E7
  promo mutation, then obtain approval to snapshot promo fields or declare them
  intentionally live. This inventory chooses neither behavior.
- Exact-baseline verification: structural/route **31/31**, W2 **19/19**, W1
  disposable PostgreSQL **25/25**, and TypeScript all PASS. Full inventory and
  raw proof: `C9-C12-STRUCTURAL-INVENTORY-20260824.md` and
  `c9-c12-structural-20260824/`.
- C9 and C12 remain **PARTIAL**; shipping readiness remains **58/100**.

### E.19 C12 admission-time approved reference snapshot — 2026-08-24

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

- On code `6c3b1d431a8564c13e51b218af5403dbfb8bb3e0`, exactly three production
  application job INSERT creators were found. Retail SQLite, retail PostgreSQL,
  and organization PostgreSQL now atomically install both
  `approved_reference_manifest` and `job_product_snapshot` at admission.
- Storage-first preparation resolves approval, re-reads and hashes exact bytes,
  and writes ordered deterministic job-owned keys. SQLite rechecks exact raw
  image identity with bounded same-id retry; PostgreSQL holds the product row
  through preparation and INSERT. Queue/hold visibility cannot precede the
  committed manifest boundary.
- Admission/W2 proves actual E5 deletion still uses original bytes without
  first-worker install. Disposable W1 proves retail E3, retail E5 deletion, and
  organization E9 deletion preserve admission bytes/order without install.
  Helper and retry tests cover partial storage failure, source-hash mutation,
  empty/rejected input, idempotence, ambiguous-CAS no-delete, exact one hold,
  duplicate semantics, and terminal readmission.
- Exact evidence: targeted **52/52**, W1 disposable **28/28**, full suite
  **1,129 total / 1,086 PASS / 0 fail / 43 classified skip**, PostgreSQL retry
  **20 jobs / 20 holds**, TypeScript/build/catalog PASS, and disposable residue
  zero. Raw evidence and hashes are under
  `c12-admission-reference-20260824/`; full report is
  `C12-ADMISSION-REFERENCE-SNAPSHOT-20260824.md`.
- This closes the approved local C12 admission-time identity gap for new jobs;
  legacy worker fallback remains for legacy rows. It does not change promo
  policy, add a reason code, prove deployment, or close unrelated C9 gaps.
  Canonical shipping readiness remains **58/100**.

### E.20 C12 rejected-admission storage cleanup — 2026-08-24

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

- Reviewer finding `1787561141000` against `58ef444e` identified durable
  object leakage from known non-winning storage-first admissions. Remediation
  code `e52e0ef15113ebb6d6fe2817bdc50c7d62d9df7d` adds balance preflight before
  PUT while retaining the authoritative transactional check.
- Attempted deterministic keys are cleaned only after fresh authoritative DB
  absence proof for partial failure, SQLite duplicate loser/retry exhaustion,
  and PostgreSQL known rollback. COMMIT/network or CAS ambiguity retains keys.
  Cleanup delete failure is logged and preserves the original safe outcome.
- SQLite regressions prove insufficient **0 PUT / 0 job / 0 hold**, two
  concurrent requests **1 job / 1 hold / winner keys only**, and repeated
  image-change exhaustion/partial PUT leave zero prepared keys. PostgreSQL
  proves insufficient **0 PUT / 0 job / 0 hold**, a known rollback cleans its
  key, and 8 same-script calls yield one winner with retained prefixes equal to
  database jobs.
- Exact follow-up checks: targeted **56/56**, W1 **28/28**, money **11/11**,
  full **1,133 total / 1,090 PASS / 0 fail / 43 classified skip**, plus
  TypeScript/build/catalog PASS and disposable residue zero. Raw hashes are in
  `c12-admission-reference-cleanup-20260824/`.
- The local C12 admission slice remains closed without changing reason codes,
  promo policy, deployment state, or canonical shipping readiness **58/100**.

### E.21 C12 successful-retry surplus-key pruning — 2026-08-24

TASK=`P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824`

- Reviewer finding `1787562132000` against `04bc074a` identified obsolete
  job-prefixed objects after successful SQLite re-prepare and possible
  PostgreSQL transient retries. Remediation code
  `57d1a34883f68088d7f5cd8d5f4ffa736acfc54e` prunes only tracked targets that
  a fresh authoritative committed manifest proves are not winners.
- Pruning occurs only after confirmed successful commit. Commit ambiguity,
  authoritative-read/manifest-parse failure, and delete failure preserve keys
  and the safe outcome while logging the operational condition.
- SQLite now proves an image-list mutation re-prepare retains exactly the
  committed manifest keys. PostgreSQL injects a post-PUT `40001`, changes the
  approved images before the retry, reuses one job id, and proves its retained
  prefix equals the committed manifest exactly.
- Exact checks: targeted **56/56**, W1 disposable **28/28**, full **1,133 total
  / 1,090 PASS / 0 fail / 43 classified skip**, PostgreSQL retry/prune PASS,
  TypeScript/build/catalog PASS, and disposable residue zero. Raw hashes are
  in `c12-admission-reference-retry-prune-20260824/`.
- Historical bundle checksums are repaired with immutable reviewed snapshots.
  No reason code, promo policy, deployment claim, or canonical shipping
  readiness **58/100** changed.

### E.22 C9 live-promo compositor counterexamples — 2026-08-24

TASK=`P1-C9-PROMO-OUTPUT-COUNTEREXAMPLE-20260824`

- Exact code `618ba6355e7a8afd336031db8dadaf6a0dd8b41f` adds only a
  behavior-neutral test observer inside the production `compositeVideo()`
  entrypoint. Tests stop there before FFmpeg, but reach it through actual
  admission, HTTP mutation, worker, and organization scene-review/resume paths.
- Retail SQLite E3→W2 proves a job admitted without promo can gain the live
  compositor text `Rp99.000 > Rp85.000 / -14% · s.d. 3 Feb`, and a job admitted
  with promo can lose it and render `Cuma Rp85.000` after E3 clears the fields.
  In both cases, the provider prompt keeps admission name/description and the
  sell price remains the admission-bound Rp85.000 despite live E3 price Rp72.000.
- Organization PostgreSQL proves renderSatuSel→E7→first W1→AWAITING_APPROVAL→
  actual A6 approve→resume W1 reaches compositor with changed live promo text
  `Rp98.000 > Rp85.000 / -13% · s.d. 3 Feb`, while the provider prompt retains
  admission name, visual description, and brand brief.
- Correction to E.18: `promo_stock_left` is read live and reaches
  `resolvePromo`, but `formatPromoOverlayText()` does not use `stockLeft`.
  These counterexamples explicitly prove stock 7/9 is absent from compositor
  price text. Current rendered scarcity is therefore inert; no claim that E3/E7
  changes scarcity output is supported.
- This evidence proves current mixed behavior; it does not choose policy. C9
  remains **PARTIAL** pending Founder choice between snapshotting promo at
  admission (Reviewer recommendation) and declaring promo intentionally live.
  No reason code or production semantic changed, no deployment is claimed, and
  canonical shipping readiness remains **58/100**.
- Exact checks: affected **19/19**, W1 disposable **29/29**, full **1,135 total
  / 1,091 PASS / 0 fail / 44 classified skip**, TypeScript/build/catalog PASS,
  no network provider calls, and disposable PostgreSQL residue zero. Immutable
  raw evidence is under `c9-promo-output-counterexample-20260824/`.

### E.23 C9 rendered-frame follow-up — 2026-08-24

TASK=`P1-C9-PROMO-OUTPUT-COUNTEREXAMPLE-20260824`

- Reviewer finding `1787563838000` correctly identified that E.22 observed
  compositor input only and stopped before FFmpeg. Remediation code
  `e1e80c052ee7d77339239af09f83eb2b37649289` lets the production compositor
  finish, then uses a test-only QC seam to inspect an actual frame at the
  midpoint derived from `demoRange`.
- W2 gain renders a substantive 172,131-byte crop with SHA
  `9d38a479fa934bd74461017fae3fc6957f5db594f7da8339928ee16d17233351`;
  OCR retains the two prices, discount 14, and 3 Feb deadline. W2 removal
  renders a different 77,529-byte crop with SHA
  `28991a686325ac29234e0d1d937e84ec94a4387ecaf0f9dd5f5b191fc789321c`;
  OCR retains only the admission sell price and no promo separator, percent,
  or deadline.
- W1 E7 change renders a 260,975-byte crop with SHA
  `13466b394de276bfebaaf3700184fb566c9eeec63a2212b3225faaecbe7d912a`;
  OCR independently retains before price 98,000, admission sell price 85,000,
  discount 13, and 3 Feb. Exact `CompositeInput` assertions remain alongside
  pixel proof because lossy video OCR confuses some glyphs (`8/S`, punctuation).
- Stock remains explicitly inert; no scarcity claim is inferred. Provider
  fixtures, voice, FFmpeg, OCR, and PostgreSQL are local/deterministic and no
  provider network call occurs.
- Initial aggregate run exposed one deterministic static-guard mismatch
  (**1,090 PASS / 1 fail / 44 skip**): the guard recognized `runQc` and
  `sqliteQcRunner`, but not the new production-equivalent `postgresQcRunner`
  test seam. The guard was expanded without weakening its required
  `visualSubjectPolicy` assertion; the final exact-code run is **1,135 total /
  1,091 PASS / 0 fail / 44 classified skip**.
- Affected tests are **19/19**, disposable W1 **29/29**, and
  TypeScript/build/catalog PASS with zero disposable database residue. C9
  remains **PARTIAL**, no policy was chosen, and readiness remains **58/100**.
  Raw evidence is under `c9-promo-rendered-output-remediation-20260824/`.

### E.24 Canonical C9/C12 readiness reconciliation — 2026-08-24

TASK=`SHIP-READINESS-CANONICAL-C9C12-RECONCILE-20260824`

- Accepted C12 state is code
  `57d1a34883f68088d7f5cd8d5f4ffa736acfc54e` plus evidence
  `2073ba84fe179c9fde82bdd7b27027c4cec88ca3`. The local new-job
  admission-time manifest gap is closed with known-loser cleanup and
  successful-retry surplus pruning; ambiguity preserves keys. Aggregate C12
  remains PARTIAL for legacy/treatment and proposal-only reason-code scope.
- Accepted C9 state is code
  `e1e80c052ee7d77339239af09f83eb2b37649289` plus evidence
  `0b2985cb6bab0bd101ad90a8230c28ba8e948aab`. W2 gain/removal and W1 change
  actual rendered frames prove mixed current behavior: core prompt/sell price
  admission-bound, promo before/deadline live. Stock is live but inert in
  compositor formatting.
- At the time of this docs-only reconciliation, no approved local
  implementation task remained queued. This statement predates and is
  superseded for T43 scope by the 24 August Founder decision recorded in E.25.
  C9 still requires Founder `PROMO_POLICY=SNAPSHOT` (Reviewer
  recommendation) or `LIVE_INTENTIONAL`; C12 remainder requires legacy or
  reason-code authority, bukan T43 technical authority baru. Other gaps remain policy, deploy, credentials, paid,
  legal, incident/DR, or release-owner boundaries.
- No policy, reason code, production behavior, deployment, or score changed.
  Canonical shipping readiness remains **58/100**.

### E.25 Managed staging exact-SHA — 2026-08-24 (HISTORICAL; superseded by E.28/E.33)

TASK=`P0-MANAGED-STAGING-EXACT-SHA-20260824`

- Web and worker staging are `live` on exact accepted SHA
  `4a1d258155b128fee0fcd5a6143198f36a558163`; deploy IDs and sanitized
  provenance are in `managed-staging-exact-sha-20260824/`.
- Admission was held with staging-only maintenance throughout the mismatch
  window. Job total stayed 74 and active/queued stayed zero. Maintenance was
  restored false; both services retain `autoDeploy=no`.
- Migrations advanced from 6 to all 35, through `0035_job_product_snapshot`.
  The terminal-ledger unique index, capture-delta check, and `regen` ledger type
  were queried as actual DB artifacts.
- Managed P0-B2 answer: web classification is **not capable** because tesseract
  is unavailable. The application reports this honestly as
  `belum_diperiksa`; no capability or Product Truth end-to-end PASS is claimed.
- Authenticated zero-money boundary smoke created no job and no
  hold/capture/regen row; worker queue startup was observed and provider
  activity was zero. A successful paid/render canary was deliberately not run.
- Production deploys were unchanged. Production/payment/legal/incident credit
  remains zero, C9/C12 aggregate statuses remain PARTIAL, and canonical
  shipping readiness remains **58/100** pending independent review.
- Founder authority is versioned in
  `managed-staging-exact-sha-20260824/FOUNDER-DECISION-UGC-AUTHORITY-UNBLOCK.md`:
  T43 permits bounded technical enforcement/admission, but does not itself
  implement A1–A7, choose legacy treatment, or relax any production HOLD.

### E.26 Staging web classifier-capable image candidate — 2026-08-24 (HISTORICAL candidate)

TASK=`P0-B2-WEB-CLASSIFIER-CAPABLE-20260824`

- Added staging-only `Dockerfile.web` with ffmpeg/ffprobe, tesseract English,
  committed probe asset, Next runtime, staging migrations, non-root UID 10001,
  and owned writable cache/storage paths.
- Staging Blueprint binds web to `Dockerfile.web`, keeps worker on
  `Dockerfile.worker`, and validates through Render CLI. Production Blueprint
  is byte-identical to accepted baseline.
- Contract suite is counterexample-sensitive for all required binaries/assets,
  migration/runtime files, non-root/writable paths, staging wiring, worker
  isolation, production drift, and Docker-context exclusions: 26/26 PASS.
  Targeted classifier+container total 40/40 PASS; build and TypeScript PASS.
- No local container engine was available, so image execution is explicitly
  unproven. No remote mutation occurred. P0-B2 stays **managed incapable** and
  readiness stays **58/100** pending exact-SHA review followed by the managed
  build/probe plan in `web-classifier-capable-20260824/managed-follow-up.md`.

### E.27 Secret-safe web build/runtime boundary — 2026-08-24 (HISTORICAL predeploy)

TASK=`P0-B2-SECRET-SAFE-WEB-BUILD-20260824`

- Removed eager production `AUTH_SECRET` validation from config import and
  moved fail-closed startup validation to lazy root Next Node instrumentation.
- Auth/JWT/OTP/signing consumers read and validate the current runtime secret;
  rotation is not frozen at build/import, and later missing/short values fail.
- The dedicated production worker also asserts the shared runtime-secret
  policy before memo wiring, queue validation, or BullMQ worker creation;
  missing/default/short startup counterexamples fail before external work.
- Secretless full Next build PASS without dummy/real build secrets. Full tests
  are 1,187 total / 1,143 PASS / 0 fail / 44 classified skip; targeted boundary
  tests are 69/69 PASS and staging Blueprint validation passes.
- Docker remains unavailable locally, so image execution is not claimed. No
  managed mutation occurred. P0-B2 remains managed incapable until reviewed
  exact-SHA managed rebuild, sustained health, and zero-money canary with
  contemporaneous raw evidence.

### E.28 Managed classifier runtime and web/worker parity — 2026-08-24 (accepted ancestor; deploy state superseded by E.33)

TASK=`P0-B2-MANAGED-CLASSIFIER-RETRY-20260824`

- Staging web and worker are `live` on exact accepted SHA
  `73280ffa342945dc08cee2fc664956975c8d5735`. Web retains `Dockerfile.web`;
  worker retains `Dockerfile.worker`; both use the staging-only exact branch
  and `autoDeploy=no`.
- Managed web health proves ffmpeg, ffprobe, tesseract, English OCR data, and
  the production classifier smoke all positive. Migrations are 35/35 and
  payments remain sandbox/non-live.
- Reviewer rejected the first narrow zero-money aggregate. It remains
  **UNPROVEN** and is not used. Remediation held web intake, suspended worker,
  accounted for four legacy non-terminal promo rows, and proved both BullMQ
  queues empty before worker rollout.
- The final canonical replay first retains an actual external HTTP 503, then
  fingerprints every row of jobs, promo jobs, provider tasks, all
  credit-ledger types, and payments including mutable status/payload fields
  before resume while worker is suspended, immediately after exact deploy,
  and after a sustained wait. Both queues are also counted at all three
  boundaries, followed by a second retained 503. Normalized snapshots match
  exactly; counts, costs, ledger delta, payment amount, and queue counts did
  not change.
- The temporary database `/32` was cleared, maintenance was released only
  after exact-SHA parity, and sustained public health remained exact-SHA and
  classifier-capable. Production services and origin `main` were untouched.
- P0-B2 is **VERIFIED_MANAGED: capable** for staging runtime only. This does
  not authorize production, paid-provider work, or real money, and it does not
  change canonical shipping readiness **58/100**.

### E.29 E1 label/brand and canonical reference gate — 2026-08-24

TASK=`P0-T43-E1-REFERENCE-GATE-20260824`

- The actual exported retail create `POST` checks every decoded upload through
  the same label/registered-brand gate used by E4/E8 before any storage or DB
  publication. Canonical `LABEL_UNREADABLE` and `BRAND_MISMATCH` responses are
  preserved.
- After sidecar-bearing ingestion, `resolveApprovedReference(images)` is the
  sole eligibility judge. No approved reference, classifier-unavailable
  evidence, missing/corrupt evidence, hash mismatch, and resolver errors all
  fail before either SQLite or PostgreSQL product persistence.
- Any resolver rejection/error or DB persistence failure invokes E1 exact-set
  rollback for the new image bytes and sidecars only after authoritative
  exact-ID reconciliation proves the row absent. A commit whose acknowledgement
  failed is recovered as success only when owner, retail scope, ordered images,
  and every immutable create input match exactly; SQLite completion audit is
  idempotent. Reconciliation failure/mismatch retains storage and returns a
  visible 500 rather than creating dangling DB references. Successful confirmed-
  absent cleanup leaves no new storage, row, or success audit. Cleanup failure
  is an observable 500 and explicitly logs possible residual storage;
  unrelated objects survive.
- PostgreSQL create failures carry typed transaction-phase evidence. Exact
  cleanup authority requires `commitAttempted=false` AND
  `rollbackSucceeded=true`; once COMMIT was attempted, an immediate absent read
  is treated as potentially stale visibility and can never authorize deletion.
  If rollback itself is unproven, storage is retained as well. SQLite remains
  scoped to its synchronous authoritative row reconciliation.
- `tests/e1-reference-gate.test.ts` exercises the exported POST through both DB
  seams with positive packshot, banner-first+packshot, multiple-valid, and all
  listed negative/fault cases, including SQLite/PG pre-commit failure,
  commit-then-throw exact recovery, reconciliation mismatch, and reconciliation
  failure, plus absent-first/delayed-COMMIT and rollback-failure controls. Its
  mutation guard rejects label/brand bypass, resolver bypass, early SQLite/PG
  persistence, reconciliation bypass, and non-exact rollback.
- This slice does not change OCR execution policy, type/category policy,
  legacy treatment, payment/provider behavior, deployment, or production
  state. Aggregate matrix statuses remain bounded as listed above and
  canonical shipping readiness remains **58/100**.

### E.30 C3 worker brand gate — 2026-08-24

TASK=`P0-T43-C3-WORKER-BRAND-GATE-20260824`

- W1 PostgreSQL and W2 SQLite now inspect every immutable job-owned approved
  reference that is eligible to reach the selected provider tier. The trusted
  comparison brand comes only from `job_product_snapshot.trustedBrand`; a
  later mutation of `products.raw_meta.brand` cannot change the verdict.
- Only an explicit `cocokMerek === false` rejects, using canonical
  `BRAND_MISMATCH` (`retryable:false`) before person-safe processing, planning,
  any video/image/audio provider, capture, deliverable, or success state.
  OCR unreadable/runtime-failure (`cocokMerek:null`) and authoritative null
  trusted brand retain the existing fail-open policy.
- Direct W2 execution proves a mismatched second reference is rejected, both
  references are checked against the admission brand after live-product
  mutation, retry reaches the stable failure/refund contract, and provider,
  capture, and deliverable counts stay zero. Matching, unreadable/null OCR,
  and null-brand controls reach a provider double. Suite: 21/21 PASS.
- The same counterexamples execute W1 against a disposable local PostgreSQL
  database, including canonical error data, stable failure/refund, zero paid
  effects, mutation protection, and positive controls. The full W1 contract
  suite is 31/31 PASS; its database was dropped by the gate on exit.
- This is direct C3 proof for W1/W2 only. It does not change C6 OCR policy,
  C9/C12, deployment/payment/provider state, aggregate non-worker gaps, or
  canonical shipping readiness **58/100**.

### E.31 A1–A7 admission enforcement — 2026-08-24

TASK=`P0-T43-C8-ADMISSION-ENFORCEMENT-20260824`

- Exact accepted SHA: `d49c9730f5701fbd12b602cf49d20ae4880c6acf`.
- A1/A4/A6 retain their durable admission-manifest boundaries. A2/A3/A5/A7
  now acquire bounded product-evidence leases before any provider/setup effect.
  PostgreSQL locks use dedicated bounded pools, not the application pool;
  saturation fails before provider work, and unlock failure evicts the
  potentially lock-bearing session.
- Duplicate A2 replay is resolved before current-product evidence enforcement,
  preserving idempotency for already admitted immutable jobs.
- Route-level counterexamples cover corrupt evidence, concurrent E5/E9 delete,
  work beyond the former idle-transaction timeout, `PG_POOL_MAX=1`, saturated
  lock capacity, and unlock failure. The accepted boundary reports canonical
  evidence failure with zero provider/setup effect.
- This closes C8 A1–A7 and P0-B5 for **new admission**. It does not decide
  legacy treatment, OCR fail-open/fail-closed, promo policy, or C9/C12 aggregate
  status. Shipping readiness remains **58/100**.

### E.32 Duitku HMAC sandbox verification — 2026-08-24

TASK=`P1-DUITKU-SANDBOX-VERIFICATION-20260824`

- Exact accepted app SHA: `89cfdf0ebf3290aa3b42376a9da194988f6d6db3`.
- Current POP create/callback uses HMAC-SHA256 and timing-safe comparison. Local
  callback counterexamples cover invalid signature, amount mismatch, duplicate,
  failed/late, unknown order, wrong merchant, and sandbox tester allowlisting.
- The authorized external sandbox create returned a strict sandbox redirect,
  but the exact-order HMAC status query returned sanitized HTTP 404 without the
  required schema. Its persisted result is `HOLD`, not PASS. No invoice was
  paid or opened; no charge/refund/settlement/production mutation occurred.
- This closes the code/local sandbox-contract slice only. Authoritative POP
  known-order reconciliation, merchant approval, production activation, real
  settlement, price/COGS approval, and `PAYMENTS_GO_LIVE` remain open.

### E.33 Managed staging Duitku parity — 2026-08-24

TASK=`P1-MANAGED-STAGING-DUITKU-PARITY-20260824`

- Accepted evidence SHA: `0fa86ca60882fed1ff6881bfb028e53e2a1124a9`;
  deployed app SHA: `89cfdf0ebf3290aa3b42376a9da194988f6d6db3`.
- Staging web deploy `dep-da66sk3ncjis73asgu80` and worker deploy
  `dep-da66slm417fc739h2mf0` are live, exactly one intended deploy each,
  `autoDeploy=no`, worker resumed, and maintenance off.
- Three public health samples return 200 with exact build SHA, classifier
  capable, Duitku sandbox, and payments live false. Web managed credential
  slots were local-equal in memory; worker credential slots remain absent.
- Non-money managed canaries: unauthenticated checkout 401, invalid callback
  signature 401, and a validly signed unknown-order callback 200/ignored.
  Baseline, postdeploy, and post-canary DB/queue receipts match exactly.
- Production deploy IDs/SHA remain unchanged against independently committed
  pre-task evidence and a preserved post-task read. Same-task raw pre-read was
  not persisted and is explicitly not claimed as evidence.
- This supersedes E.25/E.26/E.27 negative classifier/deploy state as current
  managed truth. Those sections remain historical. It does not prove paid or
  known-order settlement and does not change readiness **58/100**.

### E.34 Canonical readiness reconciliation at `0fa86ca` — 2026-08-24

TASK=`P1-SHIP-READINESS-RECONCILE-20260824`

- Board rubric is unchanged: 13 raw rows sum to 77/130; normalized 59 is still
  capped by the existing R2A evidence ceiling at **58/100**. No new weight or
  policy was introduced.
- Current closed bounded slices: managed classifier capability, C8 A1–A7/new
  admission, E1 create/reference rollback, explicit C3 W1/W2 mismatch, Duitku
  HMAC code/local matrix, and managed Duitku staging parity.
- Current open P0/P1 includes paired legacy DB+R2 audit, P0-B4 action beyond
  the accepted explicit C3 slice, C2/C4/C5/C6 policy/coverage gaps, C9/C12
  aggregate/legacy treatment, positive exact-tree E2E, POP known-order status
  reconciliation, production release-control drift, legal, monitoring/DR,
  owner, price/COGS, and production/go-live authority.
- Next autonomous work may be only a Reviewer-bounded P0-B4 technical slice
  that does not choose OCR, legacy, promo, reason-code, owner, price, or
  production policy. Otherwise the technical queue is complete and waits for
  the exact decision/external artifact.

### E.35 Managed E1–E9 evidence and readiness recompute — 2026-08-26

TASK=`P1-READINESS-TRANCHE-RECOMPUTE-20260826`

- E1 positive managed ingestion is accepted at evidence `30c9d2d...`; E6/E8
  organization ingestion is accepted at `e0a553d...`; E4 retail append at
  `2adfa32...`; E3/E5 retail mutation at `26df1e1...`; and E7/E9 organization
  mutation at `fb18b2c...`. These prove exact bounded API/PostgreSQL/R2/sidecar
  identity and zero-residue cleanup on deployed app `246fa659...`.
- Positive E2 controlled-source ingestion and SSRF transport hardening are
  accepted at `633ce9c...` on staging web `f306b5b...`. The source is exact
  staging-service/path bound; DNS/address pinning, manual redirects, one
  absolute deadline, size/stream bounds, and production isolation are covered.
  That task deliberately left staging worker on its prior SHA, so it is not a
  post-E2 exact web+worker parity receipt.
- This supersedes the old positive-E2 blocker in the E.34 snapshot. It does
  not rewrite E.1 historical statuses or claim that every aggregate case is
  closed.
- None of the new managed product traces admitted a job, held credit, enqueued,
  invoked W1/W2, called a provider, or produced an output. Therefore A1–A7
  remain PASS only for the accepted C8/new-admission code slice; W1/W2 remain
  PARTIAL; C9/C12, legacy, OCR, and C2/C5 remain open as previously bounded.
- Current aggregate C1–C13 count remains **1 PASS / 9 PARTIAL / 3 BLOCKED**.
  Managed path evidence improved, but no case is silently promoted.
- `ONBOARDING-VIDEO-PROOF-20260826` has an authoritative PASS at `efe5524...`,
  but that SHA is not an ancestor of current baseline `460ea44...`; it is
  evidence for its branch, not current canonical product-tree behavior.
- Owner-aware bus routing accepted at `460ea44...` closes orchestration
  cross-consumption risk only. It adds no Product Truth or shipping score.
- Board rows remain 13 and sum to 77/130. The valid-product admission→worker→
  output condition, legacy paired audit, and other named gates remain open, so
  canonical shipping readiness remains **58/100**. Full current reasoning and
  machine checks: `../SHIP-READINESS-CANONICAL-20260826.md` and
  `../P1-READINESS-TRANCHE-RECOMPUTE-20260826/`.

### E.36 Post-E2 exact parity, admission→worker trace, and ceiling recompute — 2026-08-26

TASK=`P1-POST-E2-CEILING-RECOMPUTE-20260826`

- Accepted evidence SHA `39140dd2485ec5c679477008cb61780a3edb6a43`
  binds Reviewer PASS and Builder DONE for
  `P0-POST-E2-PARITY-ADMISSION-WORKER-TRACE-20260826` with exact route owner
  `builder-parity-e2e-20260826` and `STALE=false` consumption.
- Staging web and canonical worker were restored live at the same post-E2 app
  SHA `565f3fad6446152966bd8003a0aa8f6536bd279b`, `autoDeploy=no`, maintenance
  off, and the canonical worker command restored. This closes the E.35
  post-E2 web/worker parity condition at managed staging tier.
- A valid synthetic product traversed canonical `/api/jobs` admission (HTTP
  201), the dedicated BullMQ trace queue, the actual PostgreSQL worker
  boundary, immutable manifest/snapshot verification, and an R2 deliverable in
  terminal `READY`. Exact request replay returned 400. Provider calls,
  payment/invoice/refund/settlement calls, ledger value, and real money were
  zero; task-owned DB/R2/queue residue was authoritatively zero after cleanup.
- This closes the E.35 valid-product admission→worker→output condition only at
  its accepted zero-value deterministic managed tier. It does not promote the
  trace into representative paid-provider or production E2E evidence.
- W1/W2 remain **PARTIAL in aggregate**: one PostgreSQL deterministic worker
  trace and explicit C3 boundaries are now accepted, while W2, representative
  provider, production, C9/C12 aggregate, legacy, and OCR-policy coverage are
  still incomplete. Current aggregate C1–C13 count remains **1 PASS / 9
  PARTIAL / 3 BLOCKED**; no historical row is rewritten.
- The unchanged 13 board rows still sum to 77/130 (normalized 59). Remaining
  R2A conditions support retaining ceiling 58, so canonical shipping readiness
  remains **58/100** with no invented weight, policy, or point.
- Machine evidence and exact arithmetic are in
  `../P1-POST-E2-CEILING-RECOMPUTE-20260826/`.

### E.37 C2 authoritative type-signal RED contract — 2026-08-26

TASK=`P0-C2-TYPE-MISMATCH-RED-CONTRACT-20260826`

- Inventory of E1/E3/E6/E7, A1–A4, schema, UI defaults, keyword guesser,
  extraction, image classification, OCR, and persisted evidence found no
  independent authoritative physical-product type signal. The persisted
  `products.category` is user/default/heuristic input, so it cannot validate
  itself.
- A dedicated non-default RED suite proves all four mutation/persistence paths
  carry unchecked category and all four admission/provider-consuming paths
  carry the stored value to script generation, snapshot, job, hold, or enqueue
  boundaries. Four discovery/control tests pass; exactly one assertion fails
  with `C2_MISSING_INVARIANT`, not a compile/tool/setup failure.
- Reviewer false-green remediation parses actual AST calls per handler and
  requires each known effect to be owned by the seam's callback, with both
  opaque declared/trusted inputs. A prior ignored call, declaration, or comment
  cannot make the aggregate RED green; a future central module is directly
  probed with match/mismatch/missing inputs, zero mismatch effects, and exactly
  one valid-control effect.
- Second remediation enumerates storage, PostgreSQL/SQLite product/persona/
  script/job/audit writes, provider generation, credit, managed-trace queue,
  and ordinary enqueue sinks. Seam inputs are exact object-literal AST property
  names (not substrings/comments), and the rejection must be awaited/returned.
  Mismatch must throw so an ignored returned decision cannot become HTTP
  success; handler mutation probes require non-success with zero effects while
  the valid control advances exactly once.
- Third/fourth remediation replaces identifier substring guesses and the
  unauthorised E3 trusted fixture with a typed/dataflow source-identity builder.
  Same-expression and different-binding/same-source aliases fail at runtime;
  similarly named independent sources remain valid. Actual PATCH behavior is
  deliberately not prescribed until Product Policy authorises a production-
  consumable trusted-signal ingress; `category` alone cannot become truth.
- Fifth remediation binds calls to named imports from the central module and
  kills local-shadow/receiver mutants. Trusted truth is an opaque ingress-
  issued runtime capability, not caller-chosen `sourceId`; structural
  same-data/different-ID forgery fails while an issued similarly named source
  passes. Missing policy is probed with a callback and must advance zero
  effects. E6 extraction audit, A1 cleanup/FYP-audit/fail, and A4 cleanup sinks
  are included, with an unguarded-new-sink mutation control.
- Sixth remediation scans all central-module imports, so a split issuer import
  cannot bypass the handler ban. Capability identity is tested by cloning the
  exact fields of an actually issued capability: the valid ingress-looking
  prefix and data still fail without object identity, killing structural and
  prefix-only mutants.
- Seventh remediation rejects namespace central imports and scans every
  production `app/`/`lib/` source for direct or indirect contract-test issuer
  access. The issued-field clone is frozen before probing, so both prefix-only
  and superficial `Object.isFrozen` authenticity mutants are killed.
- Eighth remediation allowlists only the central builder and validator across
  all production consumers. Default/side-effect/namespace/relative access,
  non-allowlisted named aliases, indirect helpers, and dynamic imports fail;
  aliased-issuer and dynamic-access mutants are explicit controls.
- Ninth remediation removes the contract-test issuer from the expected
  production module entirely. Module references normalize extensions and
  constant string expressions; computed `import()`, `require`, re-export, and
  import-equals access are rejected. Trusted match/mismatch remains a test-only
  reference control until an approved ingress exists; production probing is
  limited to frozen-forgery rejection and missing-policy zero effects.
- The future central module runtime export surface is independently allowlisted
  to builder+validator only. Default/export-assignment, wildcard/re-export,
  class/enum, and named issuer-alias mutants fail, so computed consumers cannot
  mint truth from an unapproved central export.
- Opaque-token mutation controls kill both accept-all and reject-all mutants;
  the positive trusted match remains admissible and absent trusted provenance
  remains policy-undetermined. This does not define a toothpaste taxonomy.
- No production validation, reason code, classifier, taxonomy, deploy,
  provider, payment, credit, queue, DB, or production mutation was introduced.
  `TYPE_MISMATCH` remains proposal-only and C2 remains **BLOCKED on genuine
  Product Policy input**, while engineering discovery and RED fixtures are
  complete.
- Evidence: `../P0-C2-TYPE-MISMATCH-RED-CONTRACT-20260826/`.

### E.38 C2 RED-contract lineage remediation — 2026-08-26

TASK=`P0-C2-TYPE-MISMATCH-RED-CONTRACT-REMEDIATION-20260826`
PARENT_SHA=`f73383f48d2fa6e093b5f403a04f145f6a0f3e89`

- This bounded lineage task preserves and resolves exactly the three findings
  left by the parent round ceiling. E1 now inventories the
  `rejectAfterReferenceCheck` stored-image rollback alongside directory,
  temporary-file, durable-storage, row, and audit effects; an unguarded
  rollback mutant proves callback ownership is mandatory.
- Runtime `import()`/`require()` expressions that cannot be resolved by the
  constant evaluator fail conservatively. A nested same-name `const` can no
  longer hide a central-module import; the shadowed-binding mutant is killed.
- Validator and builder imports are direct-call-only. Property/element access,
  alias or assignment escape, call/apply/bind, spread, construction, and
  optional-call usage fail; the explicit validator-function-property issuer
  mutant is killed.
- Typecheck and the RED meta-verifier pass. The inner suite retains four passing
  discovery/control tests and exactly one intended `C2_MISSING_INVARIANT` RED.
  No production policy, signal, taxonomy, reason code, or behavior changed.

### E.39 C2 authoritative product-type implementation — 2026-08-27

TASK=`P0-C2-TYPE-MISMATCH-IMPLEMENTATION-20260827`
BASELINE=`c8588c67df8c5064e4cd231a6650d0c8b23d6e00`

- Founder approved the recommended safe bundle: a versioned opaque product type
  separate from merchandising category, explicit human self-confirmation as
  the second provenance input, and normalization limited to NFKC/trim/case.
  No taxonomy list, classifier truth, or staff verification was invented.
- Durable SQLite/PostgreSQL state records declaration, confirmation, actor,
  timestamp, version, and `QUARANTINED`/`CONFIRMED`. PostgreSQL and new SQLite
  schemas constrain confirmed rows to complete, equal version-1 tokens;
  additive migration leaves existing rows quarantined.
- E1/E3/E6/E7 and A1–A4 are protected by the central identity-bound seam.
  Missing/unconfirmed state fails closed; mismatch throws `TYPE_MISMATCH`
  before callback effects; normalized match executes the callback once. A4
  rechecks the exact type state under the admission product lock.
- Retail and org campaign UI require a separate confirmation explaining that
  it is the user's assertion, not staff verification. Success audits persist
  type/provenance; mismatch creates no audit.
- Reviewer remediation prevents empty/whitespace type or actor, invalid
  timestamp, missing version, and unequal-token rows from becoming confirmed.
  New SQLite/PostgreSQL schemas constrain them; upgraded SQLite quarantines old
  invalid rows and installs durable insert/update guards. E3/E7 now return an
  authorized confirmation summary and audit token/state/provenance/actor/time/
  version, with direct E3 and classified E7 regression coverage.
- Follow-up hardening uses the full ECMAScript Unicode whitespace set for
  SQLite and an exact ISO timestamp round-trip, rejecting U+00A0-only values
  and impossible dates such as 31 February. Ordinary E7 detail saves no longer
  send a new confirmation, so a different team editor preserves the original
  confirming actor/time while their mutation audit remains attributed to the
  editor.
- Concurrency remediation removes all C2 columns from ordinary E3/E7
  detail-save SQL and makes both mutation paths share the evidence lock. A1
  SQLite validates before storage preparation and CAS-compares C2 again inside
  admission; A1 PostgreSQL validates the complete `FOR SHARE` row. A2/A3 reload
  and validate complete C2 state under their lease before effects.
- Evidence gates: GREEN contract 5/5, implementation 7/7, focused regression
  45/45, full suite 1258 tests / 1210 pass / 0 fail / 48 skipped, typecheck and
  production build PASS. PostgreSQL contract assertions and disposable
  production-migration runner passed; focused real-PG admission/race passed 5/5.
  The broad schema runner applied 0036 idempotently, then hit its unrelated
  stale 10-table expectation against the current 21-table schema.
- OCR fail-closed, promo snapshot, broader legacy remediation, owner/legal/
  price, deploy, provider, money, and production operations are explicitly not
  bundled.
- Evidence: `../P0-C2-TYPE-MISMATCH-IMPLEMENTATION-20260827/`.

### E.40 C6 OCR fail-closed before spend — 2026-08-27

TASK=`P0-C6-OCR-FAIL-CLOSED-BEFORE-SPEND-20260827`
BASELINE=`dbf96691fd7b824e3d0dd0c2dc186172f02ca0bd`

- Founder approved explicit tri-state semantics: infrastructure/runtime/
  timeout/ambiguous OCR is canonical `OCR_FAILED` (503, retryable), while a
  completed inspection that finds the label unreadable is `LABEL_UNREADABLE`
  (400, nonretryable).
- E1/E4/E8 enforce the verdict before storage, row, append, or audit and bind
  status/version 1 into the exact image sidecar. E2/E6 extracted media is not
  silently blessed: without inspection it persists only as quarantined draft
  evidence (`OCR_FAILED`).
- A1–A7 require the central resolver to return an exact hash-bound reference
  with `labelOcrStatus=READABLE` and `labelOcrVersion=1` before provider/setup,
  hold, enqueue, or job effects. Legacy, missing, failed, or stale provenance
  fails closed.
- Immutable job reference manifests are version 2 and carry that provenance.
  W1/W2 parse/load it before provider work; the independent worker brand gate
  preserves `OCR_FAILED` and `LABEL_UNREADABLE` rather than treating either as
  success.
- C6 targeted controls cover timeout, runtime error, ambiguity, forged/stale/
  legacy evidence, actual E1 zero-effect HTTP failure, admission, manifest,
  worker, positive, and mutation behavior. Reviewer remediation normalizes
  before OCR and carries exact bytes in an opaque batch; regression proves the
  upload SHA differs while inspected, stored, sidecar, and manifest SHA match.
  Typecheck, full 1266-test suite,
  production build, and disposable PostgreSQL production-migration runner pass.
- No deploy, production database, provider, payment, credit, queue, or secret
  operation was performed.
- Evidence: `../P0-C6-OCR-FAIL-CLOSED-BEFORE-SPEND-20260827/`.

### E.41 C10 legacy-job quarantine — 2026-08-27

TASK=`P0-C10-LEGACY-JOB-QUARANTINE-20260827`
BASELINE=`7475ddb3ccbfe6390ec79dda789d3f2d9325ca3d`

- A shared pure read-only classifier now distinguishes missing, malformed, and
  unsupported manifest/snapshot versions, invalid OCR/hash evidence, and
  quarantined product-type provenance. It performs no database, storage,
  network, hold, queue, provider, or ledger effect and preserves the existing
  runtime error/reason codes.
- A1/A4 admissions require the prepared immutable reference manifest, product
  snapshot v3 with promo fields, and confirmed product-type provenance before
  job/hold visibility. A6, W1, W1 deterministic trace, and W2 apply the same
  classifier before materialization, regenerate, enqueue, provider, capture,
  or deliverable work.
- Worker-time pristine-legacy manifest installation/backfill was removed from
  both SQLite and PostgreSQL implementations. W1 no longer selects
  `products.images`; W1/W2 cannot rebuild immutable job evidence from mutable
  product rows. Existing durable manifest bytes remain hash-verified on retry
  and resume.
- Direct controls cover v1/v2/missing/corrupt evidence, OCR/hash failure,
  product-type quarantine, current v3 evidence, immutable bytes, retry/regen
  boundaries, zero materialize/provider/capture/deliverable effects, and static
  no-live-row-fallback guards. Reviewer remediation makes real-PG current-job
  fixtures admission-owned, removes obsolete worker-canary/source-row
  expectations, adds a provider-branch product-type case, and preserves typed
  reason codes in both worker audit paths. The full suite passes
  1264 total / 1220 pass / 0 fail / 44 skipped; typecheck and the
  production build pass.
- Disposable PostgreSQL was attempted but is not claimed as PASS: the guarded
  local endpoint `localhost:54329` refused the connection and Docker is not
  installed. PostgreSQL and SQLite use the same classifier seam; real-PG cases
  remain reported as skipped in this environment.
- No staging/production deploy or mutation, R2/database population audit,
  backfill, delete, replay, provider, payment, credit call, or policy/reason-code
  change was performed.
- Evidence: `../P0-C10-LEGACY-JOB-QUARANTINE-20260827/`.
