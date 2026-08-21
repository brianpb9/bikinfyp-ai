# P0-03 / P0-A — kontrak RED diperbaiki SEBELUM implementasi

BASE_SHA=0c443ff36775da31d64dec5e54189dc5832209ce (pendek: 0c443ff)
BRANCH=work/p0-product-truth-20260820
TANGGAL=2026-08-21
TASK=SHIP-80-20260821
PERUBAHAN PRODUKSI=**NOL** — `git diff --stat` menyentuh `tests/`, `docs/`, dan
`.agent-bus/` saja. Nol berkas di `app/`, `lib/`, atau `scripts/`.

(Koreksi ronde 3, temuan Reviewer: baris ini semula menulis "hanya `tests/` dan
`docs/`" padahal slice yang sama juga mengubah dua berkas `.agent-bus`.
Ringkasan bukti yang tidak cocok dengan tree yang diikatnya adalah cacat yang
sama jenisnya dengan SHA yang salah — hanya lebih kecil.)

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
| R2/P0-A ronde 1 (di 4a0a343) | 28 test · 10 lulus · 18 gagal · 0 skip |
| R2/P0-A ronde 2 (di f5d4029) | 43 test · 11 lulus · 32 gagal · 0 skip |
| R2/P0-A ronde 3 (di f22d6e8) | 58 test · 11 lulus · 47 gagal · 0 skip |
| R2/P0-A ronde 4 (di c15f36f) | 62 test · 12 lulus · 50 gagal · 0 skip |
| R2/P0-A ronde 5 (di b1fd0e8) | 74 test · 12 lulus · 62 gagal · 0 skip |
| R2/P0-A ronde 6 (di 47d34eb) | 79 test · 12 lulus · 67 gagal · 0 skip |
| R2/P0-A ronde 7 (di df840d5) | 94 test · 15 lulus · 79 gagal · 0 skip |
| R2/P0-A ronde 8 (di da3b31d) | 99 test · 15 lulus · 84 gagal · 0 skip |
| **R2/P0-A ronde 9 (di 79f8d58)** | **100 test · 15 lulus · 85 gagal · 0 skip · 0 cancelled · 0 todo** |

Kedelapan-puluh-lima kegagalan seluruhnya `code: 'ERR_ASSERTION'` — diverifikasi
`grep "  code: " | sort | uniq -c` → `85 code: 'ERR_ASSERTION'`, nol kode lain.
Nol module-not-found, nol error env, nol skip, nol error fixture.

`npx tsc --noEmit` → exit 0.

Suite penuh, `npm test` (`SCRIPT_LLM=0 tsx --test tests/*.test.ts`):

```
1..905
# tests 905 · pass 806 · fail 85 · cancelled 0 · skipped 14 · todo 0
exit 1   (85 merah DISENGAJA — red-before, belum ada implementasi)
```

Kedelapan-puluh-lima `not ok` di jalan penuh itu **persis** kedelapan-puluh-lima test
P0-03/karantina di atas — nol regresi di tempat lain, diverifikasi dengan
menyaring daftar `not ok` terhadap himpunan P0-03 dan mendapati sisa kosong.
Aritmetikanya tertutup terhadap baseline `PATH-CASE-MATRIX.md` (810 · 796 · 0 · 14):

```
ronde 1:  810 + 23 = 833 test ·  796 + 6 − 1 = 801 lulus ·  18 gagal
ronde 2:  833 + 15 = 848 test ·  801 + 1     = 802 lulus ·  32 gagal
ronde 3:  848 + 15 = 863 test ·  802         = 802 lulus ·  47 gagal
ronde 4:  863 +  4 = 867 test ·  802 + 1     = 803 lulus ·  50 gagal
ronde 5:  867 + 12 = 879 test ·  803         = 803 lulus ·  62 gagal
ronde 6:  879 +  5 = 884 test ·  803         = 803 lulus ·  67 gagal
ronde 7:  884 + 15 = 899 test ·  803 + 3     = 806 lulus ·  79 gagal
ronde 8:  899 +  5 = 904 test ·  806         = 806 lulus ·  84 gagal
ronde 9:  904 +  1 = 905 test ·  806         = 806 lulus ·  85 gagal
```

Tiga test ronde 7 lulus di HEAD, dan ketiganya memang KONTROL, bukan temuan:
dua fixture arah-sebaliknya (vonis promosi dengan metrik di bawah ambang) sudah
ditolak kode sekarang karena `layakReferensi:false`, dan pembaca meta memang
sudah mempertahankan field `jenis` apa adanya. Yang mengunci reason code untuk
kedua fixture itu ada di jalur API pusat, dan di sana keduanya merah.

Satu test ronde 4 lulus di HEAD dan itu memang benar: fixture bertentangan arah
kedua (`jenis:"product_photo"` + `layakReferensi:false`) sudah ditolak kode
sekarang, karena ia memang memeriksa `layakReferensi`. Ia dipertahankan sebagai
kontrol, bukan diklaim sebagai temuan.

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

## Ronde 2 — tiga temuan Reviewer atas 4a0a343/e54b961

Ketiganya diterima; tidak ada yang disanggah. Kutipan diambil dari
`.agent-bus/archive/…-reviewer-CHANGES_REQUESTED.json` terikat ke e54b961.

### T1 — kontrak resolver pusat tidak pernah diuji (P1)

> *"An implementation can wrap referensiLayak, throw whenever the approved list
> is empty, and omit reason codes entirely while all C8 worker tests still pass
> because processJob fails closed."*

Benar, dan itu tepat menunjuk cacat gelombang ronde 1: kontraknya ditulis
sebagai KOMENTAR di kepala berkas, lalu tidak ada satu pun asersi yang
menjaganya. Seluruh test hanya memanggil `referensiLayak` dan memeriksa array
string; test wiring hanya memastikan ekspornya sebuah fungsi.

Ditambahkan 13 test yang menguji API pusat **langsung**:

* kontrol positif — `utama` wajib membawa `{rel, sha256, versiBukti}` lengkap,
  bukan sekadar nama berkas (tanpa sha256, admission tidak punya apa pun untuk
  di-snapshot);
* C1 — banner dilaporkan `REF_PROMOTIONAL`, packshot jadi `utama`;
* sepuluh fixture tidak sah, masing-masing menuntut: **tidak melempar**,
  `utama === null`, `tersetujui === []`, reason code yang **benar per kasus**
  (`EVIDENCE_INVALID` / `REF_MISSING` / `REF_HASH_MISMATCH`), pesan yang bisa
  dibaca manusia, dan nol tulisan ke storage;
* konsistensi — `referensiLayak(rels)` wajib sama persis dengan
  `tersetujui.map(r => r.rel)` pada daftar campur. Dua jalur baca yang bisa
  berbeda jawaban adalah cara divergensi W1/W2 lahir kembali lewat pintu
  belakang.

Reason code diambil dari `PATH-CASE-MATRIX.md`; tidak ada kosakata baru.

Catatan teknis: specifier import-nya dirakit dari konstanta
(``await import(`../${MODUL_PUSAT}`)``), bukan literal. Literal membuat
`npx tsc --noEmit` gagal TS2307 karena modulnya memang belum ada — itu menukar
bukti merah yang berbicara dengan error toolchain, dan sekaligus mematahkan
gerbang rilis `tsc` untuk alasan yang salah.

### T2 — panggilan resolver hiasan masih memuaskan gerbang wiring (P1)

> *"`await resolveApprovedReference(images); const [ref] = images;
> materialize(ref)` passes this call check and the positional detector while
> still selecting the first unapproved image."*

Benar. Destrukturisasi bukan `images[0]` dan bukan `images.at(0)`, jadi
detektor posisional buta terhadapnya; dan memeriksa bahwa sebuah fungsi
DIPANGGIL tidak memeriksa bahwa HASILNYA DIPAKAI. W1 tidak punya cakupan
runtime, jadi tidak ada jaring lain di bawahnya.

Dua penambahan:

1. **Detektor destrukturisasi** — `VariableDeclaration` dengan
   `ArrayBindingPattern` yang diinisialisasi dari `images` dihitung pelanggaran
   posisional, sejajar dengan `images[n]` dan `images.at(n)`.
2. **Gerbang aliran data** — pencemaran (taint) disebar dari nama yang menerima
   hasil resolver, lewat deklarasi/penugasan/`push`/`for…of`, sampai titik
   tetap. Lalu **setiap** `materialize(...)` di kedua worker wajib menerima
   nilai turunan dari himpunan itu. Berlaku untuk seluruh materialize, bukan
   hanya referensi utama: foto ke-2 dst juga dikirim ke model sebagai referensi
   identitas.

Aproksimasinya sengaja longgar (alias lewat fungsi lain tetap lolos) supaya ia
tidak bisa menolak implementasi yang benar.

Tiga counterexample baru dijalankan terhadap detektornya sendiri:

| Sumber sintetis | Wajib menghasilkan |
|---|---|
| `CONTOH_ABAI` (persis contoh Reviewer) | satu pelanggaran `[ref] = images` **dan** `materialize.dariResolver = false` |
| `CONTOH_SALAH_ALAMAT` (hasil dipakai untuk `console.log`, materialize tetap `images[0]`) | `dariResolver = false` |
| `CONTOH_BAIK` (implementasi yang BENAR: `hasil.utama.rel` + `hasil.tersetujui.slice(1)`) | nol pelanggaran, `dariResolver = [true, true]` |

Sumber ketiga itu penting: tanpanya, detektor yang terlalu ketat akan menolak
implementasi yang benar dan tidak ada yang tahu sampai P0-B5.

### T3 — penjaga runtime bersarang tidak menutup cabang yang ia sebut (P1)

> *"The `start` path removes PID_FILE at line 594 before spawning `nohup
> "$self" run` at line 611. … For a direct `run` with a missing lock, it also
> acquires and rewrites the lock before aborting, then exits before installing
> the cleanup trap."*

Keduanya benar dan keduanya bisa diperiksa di sumbernya. Diperbaiki:

1. Sumber kebenarannya pindah dari pidfile ke **tabel proses**
   (`other_runtime_pids`). Penjaga yang bergantung pada catatan tidak bisa
   menangkap kejadian yang pemicunya adalah HILANGNYA catatan itu.
2. Pemeriksaan di `run_loop` pindah ke **sebelum** `acquire_runtime_lock`, jadi
   runtime bersarang mundur tanpa mkdir lock, tanpa menulis pidfile, tanpa
   menyentuh state.
3. `start` memeriksa incumbent **sebelum** `rm -f "$PID_FILE"` dan sebelum
   mutasi lock, dan ketika pidfile tidak mengenali runtime yang hidup ia
   **mundur tanpa menyentuh apa pun** — bukan mencabut supervisornya. Pemulihan
   catatan tidak boleh dibayar dengan membunuh runtime yang sedang bekerja.

Dua jebakan ditemukan saat menulisnya, dan keduanya dicatat di kode:

* **Penjaga menuduh dirinya sendiri.** Subshell command-substitution, subshell
  pipeline, dan proses `awk` mewarisi command line runtime (needle-nya bahkan
  masuk argv awk). Versi pertama menolak start yang sah dengan
  `runtime lain masih hidup (pid=96195 96197)` — dua PID yang lahir SESUDAH
  penolaknya. Diperbaiki dengan membuang keturunan diri sendiri; **leluhur
  sengaja tidak dibuang**, karena duplikat yang benar-benar terjadi lahir
  sebagai ANAK runtime kanonik.
* **Job launchd bocor.** Pada runtime yang belum diperbaiki, `start` benar-benar
  men-submit job launchd untuk clone sekali pakai, dan launchd terus
  menghidupkannya kembali sesudah clone-nya dihapus. Terjadi dua kali saat
  menulis case ini. Pembersihannya sekarang ada di trap EXIT suite, dan
  urutannya cabut-supervisor-dulu-baru-bunuh-proses.

**Regresi baru (case 6)**, sesuai permintaan Reviewer bahwa case lama memanggil
`$SELF` dan bukan `$RUNTIME`. Skenarionya dipilih dari reproduksi, bukan
dikarang: dengan pidfile ATAU lock masih utuh, dd5c68a sudah menolak — lock-lah
yang menahannya, jadi skenario itu tidak membuktikan apa pun. Yang benar-benar
melahirkan duplikat adalah **kedua catatan hilang sementara prosesnya hidup**.

Direproduksi pada dd5c68a, di clone terpisah:

```
canonical=2544 armed;  rm pidfile + lock
"$RUNTIME" run  ->  "armed pid=3092"
ps              ->  2544 DAN 3092, dua runtime independen pada satu inbox
```

Dan pada jalan suite penuh terhadap runtime dd5c68a, case 1-5 lulus lalu case 6
memperlihatkan di tabel proses:

```
80192  test-reviewer-runtime.sh
82599  80192  …/codex-reviewer-runtime run      <-- kanonik
82630  80192  …/codex-reviewer-runtime run      <-- DUPLIKAT, seharusnya exit 7
82672  82671  …/bus-wait reviewer 3600
93857  93856  …/bus-wait reviewer 1             <-- dua bus-wait, satu antrean
```

Sesudah perbaikan, skenario yang sama persis:

```
"$RUNTIME" run   ->  exit 7,  "ABORT runtime bersarang"
"$RUNTIME" start ->  exit 2,  "menolak start tanpa menyentuh apa pun"
pidfile/lock     ->  tetap tidak ada (penjaga tidak meninggalkan jejak)
ps               ->  hanya runtime kanonik
```

Batas yang jujur: jalan suite penuh terhadap dd5c68a **tidak diselesaikan**
sampai baris vonis — ia menggantung, karena runtime kedua yang berhasil arm
memblokir di `bus-wait` dan menahan fd log. Itu sendiri temuan: test regresi
yang menggantung tidak melaporkan apa pun. Karena itu kedua invocation di case 6
sekarang dijalankan di latar dengan batas waktu, dan runtime yang MASIH hidup
sesudah batas waktu dicatat sebagai `rc=ARMED` — sebuah kegagalan, bukan
gantungan. Pembunuhannya memakai pohon proses, bukan satu PID, karena membunuh
induk saja meninggalkan `bus-wait` hidup.

Bukti suite sesudah perbaikan:

```
sh .agent-bus/test-reviewer-runtime.sh -> 6 kasus, 0 gagal
sh .agent-bus/test-bus.sh              -> 13 kasus, 0 gagal
runtime kanonik live (pid 49388)       -> tidak tersentuh sepanjang seluruh jalan
```

## Ronde 3 — lima temuan Reviewer atas 1cfc2c9

Kelimanya diterima; nol sanggahan.

### T4 (P1) — fixture tipe field masih bisa hijau karena alasan yang salah

> *"Fixture menggabungkan `layakReferensi:"false"` dan `rasioAreaTeks:"0.19"`.
> Implementasi yang hanya memvalidasi rasioAreaTeks akan menolak fixture ini dan
> menghijaukan test, tetapi tetap menerima sidecar dengan layakReferensi string
> ketika rasio berupa angka."*

Benar, dan ini kelas cacat yang sama dengan yang saya keluhkan ke R1: test yang
hijau karena alasan yang salah tidak bisa dibedakan dari test yang hijau karena
alasan yang benar.

Satu fixture gabungan diganti **delapan fixture, masing-masing merusak TEPAT
SATU field** dengan seluruh field lain sah:

| Field dirusak | Kenapa berbahaya |
|---|---|
| `layakReferensi: "false"` | string "false" TRUTHY — bukti dibaca 180° terbalik |
| `layakReferensi: 1` | angka truthy lolos, kontraknya boolean |
| `rasioAreaTeks: "0.004"` | ambang dibandingkan lewat coercion diam-diam |
| `jumlahKata: "2"` | idem |
| `sha256: 12345` | hash non-string tidak bisa dibandingkan dengan digest bytes |
| `sha256: "abc123"` | digest sha256 selalu 64 hex |
| `jenis: "banner"` | nilai di luar enum = bukti ditulis aturan lain |
| `alasan: 42` | alasan dipakai untuk pesan ke pengguna |

Kedelapan-delapannya dipakai dua kali: di jalur `referensiLayak` dan di jalur
API pusat, jadi keduanya terkunci pada pemeriksaan bentuk yang sama.

### T5 (P1) — gerbang taint masih bisa dipuaskan referensi mentah

> *"`const raw=images.find(Boolean)!; const ref=hasil ? raw : raw;
> materialize(ref)` lolos … ref ditandai tercemar meskipun nilainya selalu
> berasal dari images mentah. Karena ini satu-satunya penjaga W1, tambahkan
> counterexample negatif tersebut dan lacak asal nilai secara semantik."*

Benar. Pencemaran satu arah menyamakan **menyebut** dengan **berasal-dari**.

Diganti pelacakan asal **dua himpunan**, dengan syarat konjungtif:

```
resolver : nilai yang bisa berasal dari hasil resolveApprovedReference
mentah   : nilai yang bisa berasal dari daftar `images` apa adanya

materialize(x) diterima  <=>  x menyebut sesuatu dari `resolver`
                              DAN x tidak menyebut apa pun dari `mentah`
```

Contoh Reviewer menyebut keduanya, jadi ia ditolak — yang benar, karena
nilainya memang mentah.

Satu detail yang menentukan: saat menghitung `mentah`, subtree panggilan
resolver **dipangkas**. Tanpa itu `const hasil = await resolveApprovedReference(images)`
akan dihitung mentah (ia memang menyebut `images`) dan implementasi yang BENAR
justru tertolak. Memangkasnya menyatakan hal yang tepat: menyerahkan daftar
mentah KEPADA resolver adalah satu-satunya cara sah untuk menyentuhnya.

Batas aproksimasinya ditulis di kode supaya tidak disalahbaca: alias yang
melewati pemanggilan fungsi lain tidak terlacak, dan implementasi yang menamai
daftar tersetujui `images` akan tertolak keliru. Penjaga runtime sesungguhnya
untuk W2 ada di `product-truth-worker-reference.test.ts`; **W1 masih belum punya
padanannya** karena butuh PostgreSQL — itu tetap utang terbuka, bukan sesuatu
yang gerbang statis ini klaim sudah tutup.

Counterexample `CONTOH_ALIAS` (verbatim dari temuan) sekarang dijalankan
terhadap detektornya sendiri dan wajib menghasilkan `dariResolver=false`,
bersama `CONTOH_BAIK` yang wajib tetap `[true, true]`.

### T6 (P2) — metadata setiap entri tersetujui tidak diuji

> *"Implementasi dapat mengembalikan utama lengkap namun tersetujui berisi
> objek `{rel}` dan seluruh asersi tetap lulus."*

Benar. Ditambahkan fixture **dua foto sah** dengan `deepEqual` atas seluruh
array metadata, plus asersi `utama === tersetujui[0]`. Daftar tersetujui itulah
yang dipakai worker untuk referensi ke-2 dst, dan admission butuh sha256 setiap
entri untuk di-snapshot — bukan hanya yang utama.

### T7 (P2) — trap cleanup tidak membersihkan proses bounded case 6

> *"Jika suite menerima INT/TERM atau keluar saat invocation nested masih hidup,
> proses itu dan bus-wait turunannya dapat tertinggal—risiko yang case 6 sendiri
> dimaksudkan untuk menutup."*

Benar, dan ironi itu tepat sasaran. PID bounded sekarang disimpan sebagai
**state pembersihan** (`BOUNDED_PID`), dan `cleanup()` memanggil `stop_bounded`
lebih dulu: cabut supervisor → bunuh POHON proses → `wait`. Urutannya penting;
terbalik, launchd menghidupkan kembali apa yang baru dibunuh.

`bunuh_pohon` dan `jalankan_terbatas` dipindah ke atas `cleanup()` supaya
keluar-awal mana pun tetap punya fungsi yang dibutuhkan trap.

### T8 (P3) — ringkasan evidence tidak cocok dengan tree yang diikat

Benar dua kali: baris 7 menulis "hanya `tests/` dan `docs/`" padahal slice yang
sama mengubah dua berkas `.agent-bus`, dan batas klaim masih menyebut kenaikan
14 → 18 sementara ronde 2 sudah 32. Keduanya diperbaiki, dan tabel kenaikan
merah sekarang menyebut seluruh ronde. Ringkasan bukti yang tidak cocok dengan
tree yang diikatnya adalah cacat sejenis dengan SHA yang salah — hanya lebih
kecil.

Bukti ronde 3:

```
targeted -> 58 test / 11 lulus / 47 gagal / 0 skip; 47 dari 47 ERR_ASSERTION
npm test -> 863 test / 802 lulus / 47 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
test-reviewer-runtime.sh -> 6 kasus, 0 gagal
test-bus.sh -> 13 kasus, 0 gagal
nol proses/launchd job yang tertinggal sesudah seluruh jalan
runtime kanonik live (49388) tidak tersentuh
```

## Ronde 4 — tiga temuan Reviewer atas ef565aa

Ketiganya diterima; nol sanggahan.

### T9 (P1) — `ditolak` dihitung sebagai asal referensi tersetujui

> *"`const hasil = await resolveApprovedReference(images);
> materialize(hasil.ditolak[0].rel)` memenuhi syarat … meskipun payload itu
> secara eksplisit ditolak. Ini material untuk W1 karena belum ada tes
> runtime."*

Benar, dan ini kelanjutan langsung dari cacat ronde 3: saya memperbaiki
"menyebut vs berasal-dari", tapi tetap memperlakukan seluruh objek hasil
resolver sebagai satu sumber. Padahal objek itu justru berisi daftar yang
DITOLAK.

Pelacakan asal sekarang sadar-field:

```
akar       : nama yang terikat langsung ke objek hasil (mis. `hasil`)
tersetujui : nilai dari jalur `utama` / `tersetujui` saja
mentah     : nilai yang bisa berasal dari daftar `images` apa adanya
```

`FIELD_TERSETUJUI = {utama, tersetujui}`; `ditolak` sengaja tidak ada di sana.
`hasil.utama.rel` diterima; `hasil.ditolak[0].rel` tidak. Destrukturisasi ikut
sadar-field: `const {utama} = await resolve(...)` mencemari `utama`,
`const {ditolak} = ...` tidak mencemari apa pun.

Counterexample `CONTOH_DITOLAK` dijalankan terhadap detektornya sendiri.

Permintaan Anda "jadikan tes runtime W1 prasyarat sebelum P0-B5 diaktifkan"
**diterima dan dicatat sebagai prasyarat**, bukan sebagai utang yang boleh
lewat. Ia masuk urutan di bawah.

### T10 (P1) — sidecar bertipe sah tapi kontradiktif masih meloloskan banner

> *"Implementasi yang memvalidasi seluruh tipe, hash, dan versi tetapi menerima
> berdasarkan `layakReferensi === true` tetap meluluskan sidecar
> `{jenis:"promotional_graphic", layakReferensi:true}`."*

Benar. Fixture tipe per-field tidak bisa menangkap ini, karena di sini SELURUH
tipe sah, hash cocok, dan versinya terkini.

Ditambahkan dua fixture kontradiktif di **kedua** jalur (`referensiLayak` dan
API pusat), keduanya wajib fail-closed dengan alasan **EVIDENCE_INVALID**, bukan
REF_PROMOTIONAL: ketika dua field bukti saling membantah, tidak ada satu pun
yang bisa dipercaya sebagai vonis. Melaporkannya "promosi" berarti memilih satu
field secara sewenang-wenang; melaporkannya bukti tidak sah menyatakan yang
sebenarnya terjadi, dan itulah yang membuat karantina/revalidasi bisa
menanganinya nanti.

Arah pertama (`promotional_graphic` + `layakReferensi:true`) **merah** di HEAD.
Arah kedua (`product_photo` + `layakReferensi:false`) **hijau** di HEAD — kode
sekarang memang memeriksa `layakReferensi`, jadi ia dipertahankan sebagai
kontrol dan tidak diklaim sebagai temuan.

### T11 (P2) — trap sinyal membersihkan lalu MELANJUTKAN suite

> *"`trap cleanup EXIT INT TERM HUP` tidak keluar setelah menangani
> INT/TERM/HUP; shell melanjutkan perintah berikutnya … suite dapat menjalankan
> invocation nested berikutnya dan menciptakan proses/supervisor baru sesudah
> pembersihan."*

Benar. Pembersihan yang diikuti kelanjutan bukan pembersihan.

Trap EXIT dipisah dari trap sinyal, dan handler sinyal keluar dengan 128+signo
sesudah cleanup. `cleanup()` dibuat idempoten (`CLEANED`) supaya jalur
sinyal→EXIT tidak membersihkan dua kali.

**Regresi (case 0)** menjalankan SATU salinan suite ini dalam mode probe
(`AGENT_BUS_SELFTEST_SIGNAL_PROBE=1`): probe menyalakan runtime, menghidupkan
proses bounded berumur panjang, menulis penanda siap, lalu menunggu. Induknya
mengirim TERM dan menuntut empat hal sekaligus — suite berhenti (bukan sekadar
bersih), proses bounded mati, runtime mati, lock tidak tersisa — plus penanda
`probe-continued` yang HANYA tertulis kalau trap membersihkan lalu melanjutkan.

Terverifikasi merah-sebelum lewat mutasi: mengembalikan satu baris
`trap cleanup EXIT INT TERM HUP` membuat case 0 gagal dengan `rc=HIDUP` —
suite bersih tapi tidak berhenti, persis cacat yang dilaporkan.

Satu jebakan ditemukan dan dicatat di kode: `/bin/sh` macOS adalah bash mode
POSIX, dan bash **menunda** handler sinyal sampai perintah foreground selesai.
Dengan `sleep 300` tunggal, trap baru jalan 300 detik kemudian dan test menuduh
cacat yang tidak ada. Probe karena itu menunggu dalam potongan satu detik.

Bukti ronde 4:

```
targeted -> 62 test / 12 lulus / 50 gagal / 0 skip; 50/50 ERR_ASSERTION
npm test -> 867 test / 803 lulus / 50 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
test-reviewer-runtime.sh -> 7 kasus, 0 gagal
test-bus.sh -> 13 kasus, 0 gagal
nol proses/launchd job tertinggal; runtime kanonik live (49388) utuh
```

## Ronde 5 — empat temuan Reviewer atas a3bc1b0

Keempatnya diterima; nol sanggahan.

### T12 (P1) — menyebut `utama` mencuci nilai dari `ditolak`

> *"`const ref = hasil.utama ? hasil.ditolak[0].rel : hasil.ditolak[0].rel;
> materialize(ref)` menjadi `dariResolver=true` … tetapi nilainya selalu berasal
> dari `ditolak`."*

Benar, dan ini ronde ketiga berturut-turut sebuah pencucian menembus gerbang
statis W1. Polanya sudah jelas dan sekarang ditulis di kode sebagai prinsip:

> Analisis sintaksis tidak bisa MEMBUKTIKAN nilai mana yang mengalir, jadi ia
> tidak boleh dipakai untuk membuktikan kebersihan. Yang bisa ia lakukan dengan
> benar adalah MENOLAK.

Himpunan asal jadi tiga, dan syaratnya konjungtif dengan **dua larangan**:

```
diterima <=> menyebut jalur tersetujui
             DAN tidak menyentuh `terlarang`
             DAN tidak menyentuh `mentah`
```

`FIELD_TERSETUJUI` jadi daftar putih murni: `{utama, tersetujui}`. Field hasil
apa pun di luar itu — `ditolak` hari ini, apa pun yang ditambahkan besok —
otomatis jadi asal terlarang. Destrukturisasi ikut: `{utama}` tersetujui,
`{ditolak}` dan field tak dikenal lainnya terlarang.

Implementasi yang benar tidak pernah menyebut `ditolak` maupun `images` di dekat
payload-nya, jadi larangan ini tidak menghalanginya — dan setiap pencucian yang
konkret gagal, karena pencucian selalu perlu menyebut sumbernya.
`CONTOH_CUCI_UTAMA` (verbatim dari temuan) dijalankan terhadap detektornya.

### T13 (P1) — kontradiksi METRIK classifier belum dikunci

> *"Implementasi yang memvalidasi pasangan itu tetapi menerima
> `{jenis:"product_photo", layakReferensi:true, rasioAreaTeks:0.19,
> jumlahKata:14}` tetap meluluskan bukti yang bertentangan dengan aturan
> classifier versi 1."*

Benar. Metrik bukan hiasan — metriklah yang MENENTUKAN vonis di
`klasifikasiGambar`, jadi bukti yang metriknya membantah vonisnya sendiri tidak
pernah bisa keluar dari classifier versi 1; ia ditulis pihak lain.

Ditambahkan enam fixture satu-sumbu (di **kedua** jalur, semuanya
`EVIDENCE_INVALID`):

| Sumbu | Fixture | Kenapa mustahil |
|---|---|---|
| metrik | `rasioAreaTeks: 0.19` + vonis foto produk layak | `0.19 >= AMBANG_RASIO 0.02` → aturan v1 wajib memvonis promosi |
| metrik | `jumlahKata: 14` + vonis foto produk layak | `14 >= AMBANG_KATA 6` → idem |
| domain | `rasioAreaTeks: -0.1` | luas tidak bisa negatif |
| domain | `rasioAreaTeks: 1.5` | luas teks tidak bisa melebihi luas gambarnya |
| domain | `jumlahKata: -1` | cacahan tidak bisa negatif |
| domain | `jumlahKata: 2.5` | cacahan tidak bisa pecahan |

Ambangnya **disalin** dari `lib/media/klasifikasi-gambar.ts` (konstantanya tidak
diekspor).

> **Koreksi ronde 6.** Kalimat di sini semula berbunyi "ambang yang digeser
> tanpa menaikkan versi … test versi-basi yang menangkapnya". Itu **salah**, dan
> Reviewer benar menandainya: test versi-basi hanya menolak sidecar yang
> `versiBukti`-nya lebih KECIL dari nilai kini. Ambang yang digeser diam-diam
> tetap menghasilkan sidecar versi 1, jadi ia lolos di sana tanpa perlawanan.
> Yang benar-benar menangkapnya adalah salinan ambang ini beserta fixture
> batasnya: begitu ambang produksi bergeser, fixture berhenti cocok dan test
> jadi merah, memaksa penulisnya memutuskan secara sadar — naikkan `versiBukti`
> dan perbarui fixture, atau batalkan pergeserannya.

### T14 (P1) — prasyarat runtime W1 hilang dari tabel rollout

Benar. Ronde 4 menyatakannya di prosa dan di pesan bus, tapi tabel rollout tetap
melompat P0-B4 → P0-B5, jadi tree yang terikat **belum** mengunci apa pun.

Ditambahkan tahap **P0-B4b** eksplisit, P0-B5 ditandai **TERBLOKIR sampai P0-B4b
hijau**, dan empat kriteria lulusnya ditulis lengkap (C1 dengan sha256 yang
sampai ke input provider; C8 dengan nol materialize dan nol capture/regen;
referensi tambahan juga wajib dari daftar tersetujui; nol jaringan/provider).
Alasan ia prasyarat dan bukan utang ditulis di sana: gerbang statis W1 sudah
tiga kali terbukti bisa ditembus, dan W1 tidak punya apa pun di bawahnya.

### T15 (P2) — probe TERM menerima exit sukses

> *"Mutasi `trap 'cleanup; exit 0' TERM` tetap lulus setelah cleanup,
> menyamarkan interupsi sebagai sukses."*

Benar. Asersi diperketat dari `probe_rc != HIDUP` menjadi `probe_rc = 143`.
Terverifikasi merah-sebelum lewat mutasi: dengan `exit 0`, case 0 gagal dengan
`rc=0 (wajib 143)`.

Bukti ronde 5:

```
targeted -> 74 test / 12 lulus / 62 gagal / 0 skip; 62/62 ERR_ASSERTION
npm test -> 879 test / 803 lulus / 62 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
test-reviewer-runtime.sh -> 7 kasus, 0 gagal
test-bus.sh -> 13 kasus, 0 gagal
nol proses/launchd job tertinggal; runtime kanonik live (49388) utuh
```

## Ronde 6 — dua temuan Reviewer atas b058ee5

Keduanya diterima; nol sanggahan.

### T16 (P1) — satu test masih membekukan kontrak classifier yang sudah dinyatakan cacat

> *"Tes ini mewajibkan berkas yang tidak dapat diperiksa menjadi
> `promotional_graphic`. Itu bertentangan dengan PATH-CASE C7
> (`CLASSIFIER_FAILED`) dan B1-B2-MATRIKS-INGESTION … Implementasi P0-B2 yang
> benar akan dipaksa merah oleh kontrol ini."*

Benar, dan ini **saudara** dari cacat yang sudah dicabut di ronde 1
(backfill malas) — di berkas yang sama, terlewat. Dua dokumen yang sudah terikat
di tree ini menyatakan penyamaan "banner" dengan "pemeriksaan gagal" sebagai
bukti permanen yang berbohong, sementara satu test justru menuntutnya. Kontrak
yang bertentangan dengan dirinya sendiri akan selalu dimenangkan oleh test,
karena testlah yang merah.

Diganti kontrak red-before untuk status non-vonis eksplisit, dan **berpasangan**
supaya tidak ada sisi yang bisa dihijaukan dengan menghapus perbedaannya:

| Keadaan | Kontrak baru |
|---|---|
| tidak bisa diperiksa (biner hilang, timeout, berkas tak terbaca) | `jenis: "belum_diperiksa"`, `layakReferensi: false`, alasan bisa dibaca |
| benar-benar diperiksa dan memang banner | `jenis: "promotional_graphic"`, `layakReferensi: false` |

Keputusan gerbangnya **tidak berubah**: RAGU = TIDAK LOLOS, jadi
`layakReferensi` tetap `false` di kedua sisi, dan asersi itu ditulis LEBIH DULU
supaya ia tetap dijaga walau asersi status di bawahnya gagal. Yang berubah hanya
kejujuran catatannya — dan itulah yang menentukan apakah bukti bisa direvalidasi
nanti oleh boundary yang punya binernya, atau membeku jadi vonis palsu selamanya
di service web `runtime: node`.

Reason code penolakannya adalah `CLASSIFIER_FAILED` (PATH-CASE-MATRIX C7).

### T17 (P1) — fixture metrik tidak mengunci ambang inklusif

> *"Validator yang keliru memakai `>` pada ambang akan meluluskan seluruh tes
> namun menerima sidecar `product_photo` tepat pada 0.02 atau 6."*

Benar. Fixture 0.19 dan 14 duduk jauh di atas ambang, jadi `>` dan `>=`
berperilaku sama di sana. Ambang yang tidak diuji **di titiknya sendiri** bukan
ambang yang terkunci.

Ditambahkan dua fixture satu-sumbu tepat di batas — `rasioAreaTeks: 0.02` dan
`jumlahKata: 6`, keduanya dengan vonis `product_photo` + `layakReferensi: true`
— di jalur `referensiLayak` **dan** API pusat, keduanya `EVIDENCE_INVALID`.

Klaim dokumen tentang kopling ambang↔versi juga dikoreksi; lihat kotak koreksi
di bagian T13 ronde 5.

Bukti ronde 6:

```
targeted -> 79 test / 12 lulus / 67 gagal / 0 skip; 67/67 ERR_ASSERTION
npm test -> 884 test / 803 lulus / 67 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
test-reviewer-runtime.sh -> 7 kasus, 0 gagal
test-bus.sh -> 13 kasus, 0 gagal
```

## Ronde 7 — empat temuan Reviewer atas 6b97830

Keempatnya diterima; nol sanggahan.

### T18 (P1) — kontrak baru tidak menguji kegagalan BINER, yang justru cacat P0-B2

> *"Kasus baru hanya memberikan path berkas yang tidak ada. Implementasi dapat
> mengembalikan `belum_diperiksa` khusus untuk input hilang, tetapi tetap
> mengembalikan `promotional_graphic` ketika spawn ffmpeg/ffprobe/tesseract
> gagal atau timeout."*

Benar, dan menohok: saya menulis kontrak untuk keadaan ketiga lalu mengujinya
dengan satu-satunya mode kegagalan yang BUKAN cacat P0-B2.

Sekarang tiga mode kegagalan diuji atas **gambar yang sah dan benar-benar ada**
(dibuat dengan `sharp` saat test berjalan — deterministik di mesin mana pun,
tanpa fixture eksternal), dengan `PATH` yang dikendalikan test:

| Mode | Cara | Waktu |
|---|---|---|
| biner HILANG | `PATH` diarahkan ke direktori kosong → spawn ENOENT | instan |
| biner GAGAL | `ffmpeg` palsu yang `exit 1` | instan |
| biner MENGGANTUNG | `ffmpeg` palsu yang `sleep 25` → timeout 20 detik | ~20 detik |

Mode ketiga memang lambat, dan itu disengaja: `timeout: 20_000` dipatok di
`lib/media/klasifikasi-gambar.ts` dan tidak ada env yang mengubahnya, jadi tidak
ada cara menguji jalur timeout tanpa mengubah produksi. Kasus "berkas tidak ada"
dipertahankan sebagai mode keempat.

**Observasi tambahan, di luar temuan, untuk P0-B2:** panggilan `ffprobe` di
`klasifikasi-gambar.ts` dijalankan **tanpa opsi timeout sama sekali** (berbeda
dari `ffmpeg` dan `tesseract` yang keduanya 20 detik). `ffprobe` yang menggantung
akan menahan jalur unggah selamanya. Belum diperbaiki di sini karena itu
perubahan produksi.

### T19 (P1) — `belum_diperiksa` tidak dikunci di kontrak sidecar dan API pusat

> *"Implementasi dapat memperlakukannya sebagai enum asing/EVIDENCE_INVALID
> sehingga perbedaan epistemik yang baru diperkenalkan hilang, sementara semua
> tes lulus."*

Benar. Keadaan ketiga diperkenalkan di classifier lalu tidak dikunci di tempat ia
paling berarti. Perbedaannya bukan kosmetik:

* `EVIDENCE_INVALID` = "bukti rusak, karantina" — tidak bisa dipulihkan otomatis;
* `CLASSIFIER_FAILED` = "bukti jujur mengatakan belum diperiksa" — **bisa**
  direvalidasi oleh boundary yang punya binernya.

Seluruh rencana P0-B2 bergantung pada bedanya. Ditambahkan:

1. `CLASSIFIER_FAILED` masuk daftar reason code (dari PATH-CASE C7);
2. pembaca meta wajib **mempertahankan** `jenis: "belum_diperiksa"`, bukan
   menelannya jadi `null` atau menormalkannya jadi promosi;
3. sidecar `belum_diperiksa` + `layakReferensi:false` adalah bukti **SAH** yang
   ditolak dengan `CLASSIFIER_FAILED` — bukan `EVIDENCE_INVALID`;
4. sidecar `belum_diperiksa` + `layakReferensi:true` adalah **kontradiksi**
   (kalau ia layak, berarti ia sudah diperiksa) → `EVIDENCE_INVALID`.

### T20 (P1) — konsistensi metrik–vonis hanya diuji satu arah

> *"Tidak ada pasangan yang menolak `promotional_graphic` + `layakReferensi:false`
> ketika kedua metrik berada di bawah ambang … Validator yang menerima setiap
> vonis promosi fail-closed akan meluluskan semua tes sambil tetap membekukan
> vonis palsu."*

Benar, dan bentuk yang ditunjuk bukan hipotetis: **itu persis sidecar yang
ditulis blok `catch` `saveProductImages`** (`lib/product-images.ts:228-233`) saat
biner tidak ada — `jenis: promotional_graphic`, `rasioAreaTeks: 0`,
`jumlahKata: 0`. Di bawah kontrak baru keadaan itu wajib `belum_diperiksa`;
vonis promosi dengan metrik di bawah ambang tidak mungkin keluar dari classifier
v1, jadi ia bukan vonis — ia kegagalan yang menyamar.

Ditambahkan dua fixture arah sebaliknya (metrik di bawah ambang, dan metrik nol)
di kedua jalur, `EVIDENCE_INVALID`.

Ditambahkan juga **dua kontrol sisi terima**, karena seluruh fixture kontradiktif
menuntut penolakan dan validator yang menolak SEGALANYA akan lulus semuanya:
sidecar promosi yang metriknya benar-benar mencapai ambang adalah bukti SAH dan
wajib ditolak dengan `REF_PROMOTIONAL`, bukan `EVIDENCE_INVALID`. Itu sekaligus
mengunci `>=` dari sisi terima.

### T21 (P1) — salinan ambang tidak benar-benar terikat ke ambang produksi

> *"Tes mengimpor `referensiLayak`, bukan classifier atau konstanta produksinya.
> Implementasi resolver dapat menduplikasi 0.02/6; perubahan
> AMBANG_RASIO/AMBANG_KATA di classifier tanpa bump versi akan membiarkan semua
> fixture hijau tetapi membuat producer dan validator berbeda aturan."*

Benar, dan ini membongkar koreksi yang baru saya tulis di ronde 6 — koreksi itu
sendiri masih terlalu optimistis. Keadaan yang dijelaskan Reviewer adalah yang
terburuk: bukti **diterbitkan** dengan satu aturan dan **dinilai** dengan aturan
lain, tanpa satu pun test merah.

Kontraknya dinaikkan ke produksi. `lib/media/klasifikasi-gambar.ts` wajib
mengekspor satu objek kebijakan yang dipakai classifier saat menerbitkan bukti
**dan** validator saat menilainya:

```ts
KEBIJAKAN_KLASIFIKASI = { versiBukti: 1, ambangRasio: 0.02, ambangKata: 6 }
```

Dua test mengunci dua hal berbeda:

1. **nilai kebijakan versi 1** adalah 0.02/6 dan `versiBukti` 1 — kalau digeser
   tanpa menaikkan versi, test ini merah dan penulisnya dipaksa memutuskan sadar;
2. **fixture yang dibangun DARI objek kebijakan itu** (bukan dari literal) harus
   dinilai konsisten oleh resolver — kalau validator menyimpan salinannya
   sendiri, geseran kebijakan membuat keduanya berselisih dan test ini yang
   menangkapnya, bukan fixture berliteral.

Bukti ronde 7:

```
targeted -> 94 test / 15 lulus / 79 gagal / 0 skip; 79/79 ERR_ASSERTION
npm test -> 899 test / 806 lulus / 79 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
```

## Ronde 8 — tiga temuan Reviewer atas 87ced01

Ketiganya diterima; nol sanggahan. Reviewer juga **menyetujui** P0-B4b (test
runtime W1) menjadi bagian slice implementasi pertama bersama P0-B1+B2, tetap
sebelum P0-B5, dan menyatakan ffprobe-menggantung wajib dikunci di P0-A.

### T22 (P1) — fixture "menggantung" sebenarnya gagal seketika

> *"`/bin/sh` mencari `sleep` melalui PATH tersebut, tidak menemukannya, dan
> keluar segera dengan status 127; verifikasi langsung selesai dalam 0,01
> detik."*

Benar, dan ini kelas cacat yang sama yang saya keluhkan tentang fixture orang
lain sepanjang gelombang ini: test yang hijau/merah karena alasan yang salah.
Skrip ffmpeg palsu memanggil `sleep 25` tanpa path absolut, sementara `PATH`
sudah saya kosongkan sendiri — jadi mode "menggantung" cuma mengulang mode
exit-nonzero, dan jalur timeout tidak pernah dieksekusi satu kali pun.

Diperbaiki dua lapis:

1. `exec /bin/sleep <n>` — path absolut, tidak bergantung `PATH`;
2. **durasinya diasersi**. Mode yang mengklaim melewati timeout wajib memakan
   waktu ≥ `minimalMs`. Klaim "jalur timeout terlewati" sekarang punya bukti,
   bukan asumsi. Terverifikasi: mode ffmpeg-menggantung kini `duration_ms:
   20021` — persis timeout 20 detik produksi.

### T23 (P1) — matriks kegagalan hanya menguji ffmpeg

> *"Semua mode berhenti pada pemanggilan pertama, ffmpeg … Implementasi dapat
> menangani ffmpeg dengan benar tetapi tetap membekukan kegagalan
> ffprobe/tesseract sebagai vonis promosi."*

Benar. Diganti **pipeline bertahap**: biner sebelumnya dipalsukan SUKSES supaya
eksekusi benar-benar sampai ke biner yang sedang diuji.

| Biner | Hilang | Gagal | Menggantung |
|---|---|---|---|
| ffmpeg | ✓ | ✓ | ✓ (~20 detik, timeout produksi) |
| ffprobe | ✓ (ffmpeg sukses) | ✓ | ✓ **kontrak bounded-time** |
| tesseract | ✓ (ffmpeg+ffprobe sukses) | ✓ | timeout 20 detik sudah ada di produksi |

**ffprobe menggantung** punya kontrak khusus, sesuai instruksi Reviewer bahwa ia
wajib dikunci di P0-A: di produksi `ffprobe` dipanggil **tanpa opsi timeout sama
sekali**, berbeda dari `ffmpeg` dan `tesseract` yang keduanya 20 detik. Test
karena itu memaksa batas waktunya sendiri (25 detik) dan gagal bila
`klasifikasiGambar` tidak kembali — terverifikasi `duration_ms: 25009`, yaitu
batas test yang tercapai, bukan produksi yang berhenti sendiri.

Batas waktu itu dilaporkan sebagai **asersi**, bukan Error yang lolos ke test
runner: kegagalan ber-`code: ERR_TEST_FAILURE` tidak bisa dibedakan dari harness
yang rusak, dan seluruh bukti red-before di gelombang ini bersandar pada
"semua kegagalan `ERR_ASSERTION`".

### T24 (P1) — ikatan kebijakan hanya mendeteksi pergeseran satu arah

> *"Jika kebijakan rasio dinaikkan dari 0,02 ke 0,03 … nilai pada ambang baru
> tetap ditolak oleh keduanya sehingga test lulus."*

Benar. Menguji tepat-di-ambang saja hanya menangkap satu arah; salinan validator
yang basi tetap tak terdeteksi bahkan sesudah bump versi dan pembaruan literal.

Dipasangkan kontrol **tepat di bawah ambang produksi** yang wajib **DITERIMA**
sebagai foto produk: `nextDown(ambangRasio)` (double terbesar yang masih lebih
kecil, dihitung lewat DataView) dan `ambangKata - 1`. Validator dengan ambang
basi 0,02 akan menolak 0,0299… — dan kontrol inilah yang menangkapnya.

Bukti ronde 8:

```
targeted -> 99 test / 15 lulus / 84 gagal / 0 skip; 84/84 ERR_ASSERTION
npm test -> 904 test / 806 lulus / 84 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
ffmpeg-menggantung  duration_ms 20021   (timeout produksi tercapai)
ffprobe-menggantung duration_ms 25009   (batas test tercapai — produksi tak berbatas)
nol proses `sleep` tertinggal sesudah suite selesai
```

## Ronde 9 — dua temuan Reviewer atas 0dd4ebf

Keduanya diterima; nol sanggahan.

### T25 (P1) — tenggat ffprobe tidak menghentikan proses yang diuji

> *"`Promise.race` hanya mengakhiri penantian test; ia tidak membatalkan
> klasifikasiGambar atau child `exec /bin/sleep 60`. Setelah asersi pada 25
> detik, proses tetap hidup sekitar 35 detik, sementara finally menghapus
> fixture dan memulihkan PATH. Promise yang tertinggal kemudian melanjutkan
> pipeline menggunakan state test lain/lingkungan asli. Klaim 'nol sleep sesudah
> suite' tidak membuktikan cleanup karena child itu sendiri menahan proses Node
> sampai selesai."*

Benar, seluruhnya, termasuk bagian terakhirnya: klaim pembersihan saya tidak
membuktikan pembersihan — ia cuma membuktikan suite-nya menunggu.

Klasifikasi sekarang dijalankan di **proses anak `detached`** dengan process
group sendiri (`tests/fixtures/klasifikasi-anak.ts`). Saat tenggat tercapai,
seluruh GRUP dibunuh — pembungkusnya, biner palsunya, dan `sleep`-nya — lalu
diasersi bahwa **nol proses tersisa di grup itu**, dan asersi itu dijalankan
**lebih dulu** dari asersi lain: kalau mesinnya tercemar, sisa test tidak
berarti.

Efek samping yang penting: `PATH` palsu kini hidup **hanya di lingkungan anak**.
Test induk tidak pernah lagi memutasi `process.env` miliknya sendiri, jadi tidak
ada yang bisa bocor ke test lain walau anaknya dibunuh di tengah jalan.

### T26 (P1) — timeout tesseract belum dikunci kontrak

> *"Karena file produksi yang sama akan diubah, implementasi dapat menghapus
> atau merusak timeout tesseract dan seluruh kontrak tetap hijau."*

Benar. Timeout tesseract ada di produksi hari ini, tapi tidak satu pun test
menyentuhnya — dan `lib/media/klasifikasi-gambar.ts` justru berkas yang akan
dibongkar di P0-B2.

Ditambahkan mode `tesseract MENGGANTUNG` dengan ffmpeg dan ffprobe dipalsukan
sukses, tenggat 35 detik, dan `minimalMs` 15 detik sebagai bukti jalur
menggantung benar-benar tercapai.

### Bukti durasi — ketiga jalur menggantung, terukur

```
ffmpeg    MENGGANTUNG   durasi 20061ms  lewatBatas=false   <- timeout produksi 20s
ffprobe   MENGGANTUNG   durasi 25002ms  lewatBatas=TRUE    <- tenggat TEST; produksi tak berbatas
tesseract MENGGANTUNG   durasi 20699ms  lewatBatas=false   <- timeout produksi 20s
```

Baris tengah itulah cacat produksinya, terukur dan bukan disimpulkan: `ffmpeg`
dan `tesseract` berhenti sendiri di 20 detik, `ffprobe` tidak pernah berhenti
dan harus dibunuh test.

Bukti ronde 9:

```
targeted -> 100 test / 15 lulus / 85 gagal / 0 skip; 85/85 ERR_ASSERTION
npm test -> 905 test / 806 lulus / 85 gagal / 14 skip; nol regresi
tsc --noEmit -> exit 0
nol proses tersisa di setiap process group (diasersi per mode, bukan disimpulkan)
```

## Yang SENGAJA belum dikerjakan di gelombang ini

Urutan rollout dari `QUESTION` Reviewer dipatuhi: resolver ketat menyala
TERAKHIR, bukan pertama.

| Tahap | Isi | Status |
|---|---|---|
| P0-A | kontrak/test diperbaiki | **gelombang ini** |
| P0-B1 | setiap jalur ingestion sah memproduksi sidecar (`saveUniqueProductImages`, `downloadProductImages`, …) | belum |
| P0-B2 | batas runtime ffmpeg/ffprobe/tesseract — klasifikasi di web Render (`runtime: node`) tidak punya binernya | belum |
| **P0-B4b** | **test runtime W1 di atas PostgreSQL nyata — bagian slice implementasi PERTAMA, bersama B1+B2** (disetujui Reviewer, ronde 7) | belum |
| P0-B3 | audit legacy offline + karantina | belum |
| P0-B4 | canary/product-truth verification di batas yang dipakai produksi | belum |
| ~~P0-B4b~~ | dipindah ke atas: ia bagian slice implementasi PERTAMA, bukan tahap tersendiri sesudah B4 | — |
| P0-B5 | resolver ketat jadi otoritatif — **TERBLOKIR sampai P0-B4b hijau** | belum |

### P0-B4b — kriteria lulus, dan kenapa ia prasyarat dan bukan utang

Permintaan Reviewer ronde 4, diterima. Ronde 3 dan ronde 4 sama-sama menemukan
gerbang statis W1 yang bisa ditembus (`hasil.ditolak[0].rel`, lalu pencucian
lewat `hasil.utama ? … : …`). Pola itu tidak akan berhenti: analisis sintaksis
tidak bisa MEMBUKTIKAN nilai mana yang mengalir, ia hanya bisa menolak bentuk
yang ia kenali. W2 punya jaring runtime yang tidak peduli bentuk; W1 tidak
punya apa-apa di bawah gerbang statisnya. Menyalakan resolver ketat dalam
keadaan itu berarti mempertaruhkan jalur produksi utama pada satu analisis yang
sudah dua kali terbukti bisa ditembus.

Kriteria lulus P0-B4b, seluruhnya WAJIB, dijalankan terhadap
`processPostgresJob` yang sesungguhnya di atas PostgreSQL nyata (`UJI_PG_URL`,
pola yang sudah dipakai `npm run test:pg`):

1. **C1** — foto#1 banner (sidecar sah, `layakReferensi:false`) + foto#2
   packshot (sidecar sah): kunci yang di-materialize PERTAMA wajib foto#2, dan
   sha256 yang sampai ke input provider wajib sha256 foto#2.
2. **C8 bukti tidak sah** (hilang / korup / hash beda): **nol** `materialize`
   payload, job berakhir fail-closed, dan nol `credit_ledger` bertipe
   `capture`/`regen`. Release/refund tetap diizinkan.
3. **Referensi tambahan** (foto ke-2 dst) juga hanya boleh berasal dari daftar
   tersetujui — bukan dari `images.slice(1)`.
4. **Nol jaringan, nol provider** sepanjang ketiga kasus, dibuktikan dengan
   penghitung `fetch` seperti di suite W2.

Sampai keempatnya hijau pada SHA yang terikat, P0-B5 tidak boleh dinyalakan
dengan alasan apa pun — termasuk "gerbang statisnya sudah lebih ketat".

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
sekali: nol perubahan produksi, dan jumlah test merah justru NAIK di setiap
ronde — 14 (R1) → 18 → 32 → 47 → 50 → 62 → 67 → 79 → 84 → **85** (ronde 9) — karena
kontraknya menuntut makin banyak hal yang benar, bukan karena ada yang rusak. Sesuai batas
Reviewer, seluruh slice product-truth yang selesai pun hanya memindahkan
kesiapan keseluruhan sekitar 40 → 55–58; 80/100 tetap butuh gerbang
Founder/eksternal yang belum dikerjakan.

P0A_TEST_SHA=4a0a3434848a9cb79c687d1dd238f79e63d7df5e  (ronde 1)
P0A2_TEST_SHA=f5d4029522bbeb4fbcbf4b885457369bdf3e83a6                       (ronde 2)
P0A9_TEST_SHA=79f8d58e512c0a81a92a0fbee37377ebc8d8046c                                           (ronde 9)
P0A8_TEST_SHA=da3b31da62ae08198a5029d13301723ad8dde4c9                                           (ronde 8)
P0A7_TEST_SHA=df840d5be993fd0df0c81cf99529f6327db4baec                                           (ronde 7)
P0A6_TEST_SHA=47d34eb083ed1a90da757e2b615026f9c3677a46                                           (ronde 6)
P0A5_TEST_SHA=b1fd0e8a173400b951be8e7b5d8d96a004696648                                           (ronde 5)
P0A4_TEST_SHA=c15f36ff121a2314b81607f6e2a395db3d7acc30                                           (ronde 4)
P0A3_TEST_SHA=f22d6e80e51e95a58a7ddb4f03095f85fbe3c7e9                                           (ronde 3)
