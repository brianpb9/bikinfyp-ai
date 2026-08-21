# P0-03 / P0-A — kontrak RED diperbaiki SEBELUM implementasi

BASE_SHA=0c443ff36775da31d64dec5e54189dc5832209ce (pendek: 0c443ff)
BRANCH=work/p0-product-truth-20260820
TANGGAL=2026-08-21
TASK=SHIP-80-20260821
PERUBAHAN PRODUKSI=**NOL** (`git diff --stat` hanya menyentuh `tests/` dan `docs/`)

Gelombang ini TIDAK mengimplementasikan resolver. Ia memperbaiki kontraknya
lebih dulu, karena kontrak yang salah akan memaksa implementasi yang benar
menjadi merah — dan tekanan berikutnya adalah melemahkan gerbangnya, bukan
memperbaiki kodenya.

Sumber perbaikan: `CHANGES_REQUESTED` Reviewer terikat ke 0c443ff
(`.agent-bus/archive/1787295821000-reviewer-CHANGES_REQUESTED.json`, bagian
P0-A) dan addendum `QUESTION` (`…1787296153000-reviewer-QUESTION.json`).

## Perintah persis

```
SCRIPT_LLM=0 npx tsx --test \
  tests/product-truth-evidence.test.ts \
  tests/product-truth-worker-reference.test.ts \
  tests/product-truth-worker-wiring.test.ts \
  tests/klasifikasi-gambar.test.ts
```

| Jalan | Hasil |
|---|---|
| R1 awal (di f2ad65b) | 15 test · 5 lulus · 10 gagal |
| R1 diamandemen (di 39d363e) | 19 test · 5 lulus · 14 gagal |
| **R2/P0-A (di 4a0a343)** | **28 test · 10 lulus · 18 gagal · 0 skip · 0 cancelled · 0 todo** |

Kedelapan-belas kegagalan seluruhnya `code: 'ERR_ASSERTION'` — diverifikasi
`grep "  code: " | sort | uniq -c` → `18 code: 'ERR_ASSERTION'`, nol kode lain.
Nol module-not-found, nol error env, nol skip, nol error fixture.

`npx tsc --noEmit` → exit 0.

Suite penuh, `npm test` (`SCRIPT_LLM=0 tsx --test tests/*.test.ts`):

```
1..833
# tests 833 · pass 801 · fail 18 · cancelled 0 · skipped 14 · todo 0
exit 1   (18 merah DISENGAJA — red-before, belum ada implementasi)
```

Kedelapan-belas `not ok` di jalan penuh itu **persis** kedelapan-belas test
P0-03/karantina di atas — nol regresi di tempat lain. Aritmetikanya tertutup
terhadap baseline yang tercatat di `PATH-CASE-MATRIX.md` (810 test · 796 lulus ·
0 gagal · 14 skip):

```
810 + 23 test P0-03 baru            = 833 test
796 + 6 lulus P0-03 − 1 (karantina) = 801 lulus
       10 + 3 + 4 + 1               =  18 gagal
```

Angka 28 mencakup `tests/klasifikasi-gambar.test.ts` (5 test), yang sebelumnya
tidak ikut dilaporkan di R1 padahal ia berisi kontrak yang BERTABRAKAN dengan
kontrak P0-03 — lihat perbaikan 4.

## Enam perbaikan kontrak

### 1. Wiring: regex → AST + runtime binding (+ counterexample `images.at(0)`)

`tests/product-truth-worker-wiring.test.ts` ditulis ulang di atas AST
TypeScript (`ts.createSourceFile`; `typescript` sudah devDependency dan sudah
dipakai `npx tsc --noEmit`).

Dua lubang nyata yang ditutup:

| Lubang R1 | Akibat | Ditutup dengan |
|---|---|---|
| `/\bresolveApprovedReference\s*\(/` cocok pada KOMENTAR dan STRING | satu baris komentar di kedua worker cukup untuk memenangkan test tanpa satu pun perilaku berubah | hanya node `ImportDeclaration`/`CallExpression` sungguhan yang dihitung |
| `/images\s*\[\s*0\s*\]/` buta terhadap `images.at(0)` | menukar `images[0]` → `images.at(0)` membuat test hijau sambil mempertahankan cacatnya utuh | `ElementAccessExpression` **dan** `.at(n)`/`.at(-n)` diperiksa eksplisit |

Kedua klaim itu tidak dinyatakan, melainkan DIBUKTIKAN, oleh test
`counterexample detektor` yang menjalankan detektornya sendiri terhadap tiga
sumber sintetis:

* `CONTOH_BURUK` — wajib menghasilkan tepat empat pelanggaran:
  `images[0]`, `images.at(0)`, `produk.images[1]`, `produk.images.at(-1)`;
* `CONTOH_PALSU` — impor, panggilan, dan `images[0]`/`images.at(0)` yang hanya
  ada di komentar, string, dan template string: wajib menghasilkan **nol**
  binding, **nol** panggilan, **nol** pelanggaran;
* `CONTOH_BAIK` — impor dan panggilan sungguhan: wajib terdeteksi, dan
  komentar di dalamnya wajib TIDAK dihitung pelanggaran.

Detektor yang patah gagal di test itu lebih dulu, sebelum sempat memberi vonis
palsu tentang worker.

API pusat diperiksa lewat **runtime binding** (`await import` + `typeof ===
"function"`), bukan regex `export function` atas teks: berkas berisi komentar
bernama benar tidak bisa memenangkan test itu.

Ditambahkan satu invariant baru yang R1 tidak punya: resolver tidak cukup
diimpor dan dipanggil, ia harus dipanggil **atas daftar `images`**. Gerbang
yang dipanggil atas daftar lain adalah gerbang salah alamat, dan sebelumnya
tidak ada yang memeriksanya.

### 2. Versi bukti dengan TIPE salah — tiga counterexample baru

R1 hanya menguji versi HILANG dan versi BASI. Implementasi yang memeriksa
versinya dengan `meta.versiBukti >= VERSI_BUKTI_TERKINI` saja akan hijau,
padahal JavaScript memaksa tipe:

```
"1" >= 1   -> true    string lolos sebagai versi terkini
1.5 >= 1   -> true    bukan integer, tetap lolos
null >= 1  -> false   kebetulan tertolak, bukan karena diperiksa
```

Tiga kasus baru di `tests/product-truth-evidence.test.ts` mengunci bahwa
bentuknya wajib diperiksa, bukan hanya besarnya. `null` ikut diuji supaya
alasan penolakannya benar dan tetap benar kalau nilai terkini naik.

### 3. Satu kontrak bukti tidak sah, bukan tiga

R1 menulis "daftar kosong, throw, atau reason code — urusan implementasi". Itu
bukan kontrak, itu tiga kontrak yang bertabrakan: pemanggil yang menyiapkan
`try/catch` meledak kalau resolver memilih daftar kosong, dan pemanggil yang
memeriksa `.length` melewatkan throw.

Ditetapkan, dan test + pemanggil diselaraskan ke satu bentuk:

1. **Resolver TIDAK PERNAH melempar untuk bukti tidak sah.** Bukti tidak sah
   adalah keadaan data yang normal dan terduga, bukan kondisi luar biasa.
   Yang boleh melempar hanya kegagalan infrastruktur (storage mati).
2. Bukti tidak sah = gambarnya tidak muncul di daftar tersetujui; kalau tidak
   ada satu pun yang sah, hasilnya `[]`.
3. Alasan penolakan per gambar tetap dilaporkan sebagai **data** (reason code),
   bukan sebagai exception.
4. **Gagal-tertutup adalah tugas pemanggil.** Worker yang tidak mendapat
   referensi tersetujui wajib berhenti sebelum langkah berbayar; itu diuji di
   `tests/product-truth-worker-reference.test.ts`.

### 4. Kontrak backfill malas dicabut, diganti KARANTINA

`tests/klasifikasi-gambar.test.ts` punya satu test yang menuntut KEBALIKAN dari
kebijakan P0-03: "gambar lama tanpa sidecar diklasifikasi saat hendak jadi
referensi", termasuk asersi eksplisit bahwa sidecarnya WAJIB ditulis dari dalam
jalur baca. Selama test itu hidup, implementasi yang benar akan merah di sana.

Diganti dengan test karantina, dan alasannya ditulis di berkasnya:

* bukti yang dicetak di tengah jalur render tidak pernah dilihat siapa pun —
  tidak ada rantai kustodi, ia menempel pada bytes apa pun yang kebetulan ada
  di storage detik itu;
* di produksi, jalur baca itu bisa berjalan di runtime yang **tidak punya
  ffmpeg/tesseract**. Klasifikasi gagal, `klasifikasiGambar` memvonis "promosi"
  (RAGU = PROMOSI), dan vonis palsu itu dibekukan jadi sidecar permanen — foto
  produk sah dicap promosi selamanya oleh mesin yang kebetulan tidak punya OCR.
  Ini bukan hipotetis; lihat P0-B2 di bawah;
* menulis dari jalur baca membuat operasi baca tidak idempoten.

Test barunya sengaja TANPA fixture dan TANPA biner (bytes sintetis), jadi ia
deterministik di mesin mana pun — termasuk mesin tanpa OCR, yang justru mesin
paling penting untuk kasus ini. Versi lama di-skip di mesin tanpa OCR; versi
baru tidak pernah di-skip.

### 5. W2 test #14 — fixture sukses tanpa bukti, diperbaiki

Temuan Reviewer, verbatim: *"current W2 test #14 is future false-fail (fixture
has no sidecar but expects materialize>0); give it a valid sidecar."*

Kontrol positif `W2 … sesudah halt` memakai foto TANPA sidecar sambil menuntut
`materializeCalls.length > 0`. Itu hijau hari ini hanya karena worker belum
memeriksa bukti sama sekali. Begitu resolver ketat menyala, test itu merah
karena alasan yang justru BENAR — tidak ada bukti, jadi tidak boleh
materialize — persis seperti yang dituntut dua test C8 di berkas yang sama.
Kontrol positif yang menuntut keberhasilan wajib membawa bukti yang sah; kalau
tidak, ia menekan implementasi untuk melemahkan gerbangnya sendiri.

Fixture-nya sekarang membawa sidecar sah (sha256 cocok dengan bytes tersimpan,
`versiBukti` terkini, `layakReferensi: true`), dan asersinya dipertajam dari
`length > 0` menjadi `deepEqual([relFoto])` — tepat satu materialize, atas
berkas yang benar.

### 6. SHA bukti R1 dikoreksi

| Klaim R1 | Kenyataan | Bukti |
|---|---|---|
| `AMEND_BASE_SHA=6623c4f` dan "R1 diamandemen (di 6623c4f)" | 6623c4f hanya mengubah SATU baris `R1-RED.md`; berkas test pada commit itu masih versi 15-test | `git show --stat 6623c4f` |
| jalan 19-test | hanya mungkin di 39d363e — commit yang benar-benar berisi test itu | `git show --stat 39d363e` |
| `R1_AMENDED_EVIDENCE_SHA=<commit ini sendiri …>` | placeholder tak terikat | diikat ke `bf22341` |

Bukti yang menunjuk SHA yang salah adalah bukti yang tidak bisa direproduksi
siapa pun. Koreksinya ditulis di `R1-RED.md` beserta cara memeriksanya, bukan
disunting diam-diam.

## Yang SENGAJA belum dikerjakan di gelombang ini

Urutan rollout dari `QUESTION` Reviewer dipatuhi: resolver ketat menyala
TERAKHIR, bukan pertama.

| Tahap | Isi | Status |
|---|---|---|
| P0-A | kontrak/test diperbaiki | **gelombang ini** |
| P0-B1 | setiap jalur ingestion sah memproduksi sidecar (`saveUniqueProductImages`, `downloadProductImages`, …) | belum |
| P0-B2 | batas runtime ffmpeg/ffprobe/tesseract — klasifikasi di web Render (`runtime: node`) tidak punya binernya | belum |
| P0-B3 | audit legacy offline + karantina | belum |
| P0-B4 | canary/product-truth verification di batas yang dipakai produksi | belum |
| P0-B5 | resolver ketat jadi otoritatif | belum |

Verifikasi call-site untuk P0-B1 (dibaca ulang pada 0c443ff, bukan disalin dari
handover):

* `lib/product-images.ts:saveUniqueProductImages` — menulis bytes, **tidak
  pernah** menulis sidecar;
* `lib/product-image-download.ts:downloadProductImages` — menulis bytes,
  **tidak pernah** menulis sidecar;
* `lib/product-images.ts:saveProductImages` — menulis sidecar (satu-satunya
  yang melakukannya).

Verifikasi P0-B2 (dibaca ulang pada 0c443ff):

* `lib/media/klasifikasi-gambar.ts:98-106` menjalankan `ffmpeg`, `ffprobe`, dan
  `tesseract -l eng`;
* `Dockerfile.worker` memasang ketiganya (+ `tesseract-ocr-eng`);
* `render.yaml` dan `render.production.yaml`: service web memakai
  `runtime: node`, **bukan** image itu. Klasifikasi saat unggah berjalan di web.

Mac lokal punya ketiga biner (`/opt/homebrew/bin/…`) — itulah tepatnya kenapa
hijau lokal bukan bukti deployment.

## Batas klaim

Gelombang ini adalah perbaikan KONTRAK. Ia tidak menaikkan skor readiness sama
sekali: nol perubahan produksi, dan jumlah test merah justru NAIK (14 → 18)
karena kontraknya sekarang menuntut lebih banyak hal yang benar. Sesuai batas
Reviewer, seluruh slice product-truth yang selesai pun hanya memindahkan
kesiapan keseluruhan sekitar 40 → 55–58; 80/100 tetap butuh gerbang
Founder/eksternal yang belum dikerjakan.

P0A_TEST_SHA=4a0a3434848a9cb79c687d1dd238f79e63d7df5e
