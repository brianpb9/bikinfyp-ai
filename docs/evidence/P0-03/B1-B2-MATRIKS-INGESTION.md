# P0-B1 / P0-B2 — matriks call-site ingestion × runtime biner

BASE_SHA=e54b961eeb4531e5a5fd852f6a2ed79d191a1a51
BRANCH=work/p0-product-truth-20260820
TANGGAL=2026-08-21
TASK=SHIP-80-20260821
METODE=pembacaan call-site langsung pada SHA di atas (`grep -rn` atas `app/`,
`lib/`, `scripts/`), BUKAN daftar handover dan BUKAN matriks P0-03 lama
STATUS=inventaris SELESAI · implementasi BELUM

Dokumen ini adalah prasyarat yang diminta Reviewer sebelum P0-B1 dikerjakan:
*"Build a call-site matrix first. Do not assume Retail is the only path."*

## A. Semua jalur yang menulis bytes foto produk

Lima, seluruhnya di `app/api/**` — artinya **seluruhnya berjalan di service
web**, bukan di worker.

| # | Route (file:line) | Jalur | Fungsi penyimpan | Menulis sidecar? |
|---|---|---|---|---|
| I1 | `app/api/products/route.ts:93` | POST buat produk manual (Retail) | `saveProductImages` | **YA** |
| I2 | `app/api/products/[id]/photos/route.ts:106` | POST tambah foto (Retail) | `saveProductImages` | **YA** |
| I3 | `app/api/products/extract/route.ts:46` | POST ekstrak URL → buat produk (Retail) | `downloadProductImages` | **TIDAK** |
| I4 | `app/api/dashboard/campaign/product/route.ts:64` | POST buat produk org (Enterprise) | `downloadProductImages` | **TIDAK** |
| I5 | `app/api/dashboard/campaign/product/[id]/photos/route.ts:59` | POST tambah foto org (Enterprise) | `saveUniqueProductImages` | **TIDAK** |

Verifikasi penulis sidecar, dibaca pada SHA ini:

* `lib/product-images.ts` `saveProductImages` — `mediaStorage().put(relMeta(rel), …)`
  sesudah menulis bytes. Satu-satunya yang melakukannya.
* `lib/product-images.ts` `saveUniqueProductImages` — hanya
  `mediaStorage().put(rel, normalized, "image/webp")`. Nol sidecar.
* `lib/product-image-download.ts` `downloadProductImages` — hanya
  `mediaStorage().put(rel, normalized, "image/webp")`. Nol sidecar.

Temuan Reviewer dikonfirmasi, dan cakupannya **lebih luas dari yang ia sebut**:
Reviewer menyebut `saveUniqueProductImages` (Enterprise) dan
`downloadProductImages` (Retail + Enterprise). Pembacaan call-site menunjukkan
`downloadProductImages` dipakai DUA route berbeda (I3 Retail dan I4
Enterprise), jadi jalur tanpa bukti ada **tiga**, bukan dua.

## B. Cacat yang LEBIH BURUK dari yang dilaporkan: I1/I2 pun tidak aman

Ini tidak ada di temuan Reviewer dan tidak ada di matriks P0-03 lama.

`saveProductImages` (I1, I2) memanggil `klasifikasiGambar(abs)`, dan
`lib/media/klasifikasi-gambar.ts:98-106` menjalankan tiga biner eksternal:

```
ffmpeg   -vf scale=1440:-2   (normalisasi lebar supaya rasio bisa dibandingkan)
ffprobe  -show_entries stream=width,height
tesseract png stdout -l eng --psm 11 tsv
```

Kalau salah satu tidak ada, `execFile` gagal ENOENT dan blok `catch`
`saveProductImages` (`lib/product-images.ts:228-233`) menulis sidecar:

```json
{ "jenis": "promotional_graphic", "layakReferensi": false,
  "alasan": "Belum bisa diperiksa: spawn ffmpeg ENOENT" }
```

Jadi jalur yang "menulis sidecar" pun, di runtime tanpa biner, menulis **vonis
yang salah dan membekukannya secara permanen**. Begitu resolver ketat menyala,
akibatnya bukan "sebagian produk terbrick" melainkan **setiap foto Retail yang
baru diunggah ditolak**, dengan sidecar yang tampak sah dan tidak bisa
dibedakan dari banner sungguhan oleh pembaca mana pun.

Kesimpulan: I1..I5 SEMUANYA belum aman untuk resolver ketat. Tiga karena tidak
punya bukti sama sekali, dua karena buktinya bisa berisi kebohongan yang
tampak sah.

## C. Batas eksekusi produksi — dibaca dari konfigurasi, bukan diasumsikan

| Komponen | Sumber | Punya ffmpeg/ffprobe/tesseract? |
|---|---|---|
| Worker | `Dockerfile.worker` — `apt-get install … ffmpeg … tesseract-ocr tesseract-ocr-eng`, plus `FFMPEG_PATH`/`FFPROBE_PATH` | **YA, tertulis eksplisit** |
| Web staging | `render.yaml`, service `racun-ai-staging-web`: `runtime: node` | **tidak dijamin oleh konfigurasi mana pun** |
| Web production | `render.production.yaml`, service `bikinfyp-ai-production-web`: `runtime: node` | **tidak dijamin oleh konfigurasi mana pun** |
| Mac pengembang | `which ffmpeg ffprobe tesseract` → ketiganya ada di `/opt/homebrew/bin` | ya — dan **justru itu masalahnya** |

**Addendum current 24 Agu:** tabel di atas adalah keadaan saat matriks ini
ditulis. `P0-B2-WEB-CLASSIFIER-CAPABLE-20260824` kemudian menambahkan candidate
`Dockerfile.web` dan wiring Docker khusus staging; production tetap native
Node. Candidate belum deployed, sehingga fakta managed current tetap
`mampu=false` sampai exact-SHA managed build dan health smoke membuktikan
sebaliknya. Lihat `web-classifier-capable-20260824/`.

Seluruh ingestion (I1..I5) berjalan di web. Seluruh biner hanya dijamin di
worker. Komentar di `scripts/worker.ts` bahkan sudah menyatakan batas itu untuk
pipeline lain: *"Runs in this same Docker container because that's where
ffmpeg/ffprobe live."*

Bukti deployment yang tersedia hari ini, dan batasnya:

```
curl -s https://bikinfyp.com/api/health
{"ok":true,"intake":"closed","payments_provider":"duitku","payments_env":"sandbox",
 "payments_live":false,"build_sha":"00ee62efd86ae7e10453a2a1896e63b62228aa4d"}
```

Produksi menjalankan `00ee62e` — tidak ada satu pun commit branch ini yang
hidup di sana. Dan health SAAT INI tidak melaporkan kapabilitas biner sama
sekali, jadi **tidak ada satu pun bukti, ke arah mana pun, tentang apakah
runtime web produksi bisa menjalankan ketiga biner itu.** Klaim "bisa" maupun
"tidak bisa" sama-sama tidak berdasar sampai ada probe yang berjalan di sana.

Karena itu arsitektur yang dipilih TIDAK boleh bertaruh pada salah satu
jawaban.

## D. Cacat kontrak di classifier: "gagal memeriksa" menyamar jadi vonis

`klasifikasiGambar` mengembalikan tipe yang sama untuk dua keadaan yang secara
epistemik berbeda:

| Keadaan | Yang dikembalikan sekarang | Yang benar |
|---|---|---|
| Diperiksa, ternyata banner | `promotional_graphic`, `layakReferensi:false` | sama |
| **Tidak bisa diperiksa** (biner hilang, timeout, OCR mati) | `promotional_graphic`, `layakReferensi:false` | **bukan vonis sama sekali** |

"RAGU = PROMOSI" benar sebagai **keputusan gerbang** — ragu tidak boleh lolos.
Ia salah sebagai **catatan bukti** — menuliskan "ini banner" saat yang terjadi
adalah "saya tidak bisa memeriksa" adalah bukti yang berbohong, dan bukti itu
permanen.

Perbedaannya bukan filosofis, ia menentukan apa yang bisa diperbaiki nanti:
sidecar yang berkata "tertunda, biner tidak ada" bisa direvalidasi oleh boundary
yang punya binernya; sidecar yang berkata "promosi" tidak bisa dibedakan dari
banner sungguhan dan akan bertahan selamanya.

## E. Arah yang diusulkan (belum diimplementasikan, minta koreksi Reviewer)

Tiga langkah, dan sengaja TIDAK bertaruh pada apakah web punya biner:

1. **Tiga keadaan, bukan dua.** `klasifikasiGambar` membedakan
   `product_photo` / `promotional_graphic` / `belum_diperiksa`. Sidecar menyimpan
   status itu apa adanya. Gerbangnya tetap fail-closed: `belum_diperiksa`
   TIDAK layak jadi referensi. Yang berubah hanya kejujuran catatannya.
2. **Probe kapabilitas + health.** Satu probe yang benar-benar menjalankan
   ketiga biner (termasuk memastikan data bahasa `eng` tesseract ada), hasilnya
   di-cache per proses dan diekspos di `/api/health`. Probe itulah bukti
   deployment yang diminta — dievaluasi di lingkungan sungguhan, bukan di Mac.
3. **Revalidasi di boundary yang terbukti punya biner.** Worker (Docker,
   `Dockerfile.worker`) mengangkat sidecar `belum_diperiksa` menjadi vonis
   sungguhan, lewat antrean tersendiri — persis pola yang sudah dipakai promo
   queue di `scripts/worker.ts`.

Konsekuensinya: I1..I5 semuanya menulis sidecar (P0-B1 terpenuhi), tidak ada
satu pun vonis palsu yang dibekukan (P0-B2 terpenuhi tanpa menebak isi image
Render), dan jalur unggah tidak rusak kalau ternyata web MEMANG punya binernya
— ia hanya langsung mendapat vonis sungguhan alih-alih `belum_diperiksa`.

Alternatif (b) yang disebut Reviewer — menjalankan web di image Docker berisi
ketiga biner — tetap terbuka sesudahnya sebagai optimisasi, dan tidak mengubah
kontrak di atas. Ia tidak dipilih sebagai langkah pertama karena mengubah
`runtime: node` → `runtime: docker` pada service web produksi adalah tindakan
deploy yang dampaknya di luar mandat Builder, sementara langkah 1–3 bisa
dibuktikan lewat test dan probe tanpa menyentuh produksi.

## F. Yang BELUM diverifikasi di dokumen ini

* Apakah runtime web Render benar-benar punya/tidak punya ketiga biner —
  **tidak diklaim ke arah mana pun**; itulah yang akan dijawab probe langkah 2
  saat benar-benar berjalan di sana.
* Jalur mutasi (PATCH/DELETE foto & produk) belum dibahas di sini; cakupannya
  C9/C12 di `PATH-CASE-MATRIX.md` dan masuk P0-B3.
* Jalur promo (`lib/promo/**`) tetap di luar cakupan Product Truth sampai ada
  keputusan eksplisit — sama seperti catatan di `PATH-CASE-MATRIX.md` bagian D.
