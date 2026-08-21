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
| **R2/P0-A ronde 3 (di f22d6e8)** | **58 test · 11 lulus · 47 gagal · 0 skip · 0 cancelled · 0 todo** |

Keempat-puluh-tujuh kegagalan seluruhnya `code: 'ERR_ASSERTION'` — diverifikasi
`grep "  code: " | sort | uniq -c` → `47 code: 'ERR_ASSERTION'`, nol kode lain.
Nol module-not-found, nol error env, nol skip, nol error fixture.

`npx tsc --noEmit` → exit 0.

Suite penuh, `npm test` (`SCRIPT_LLM=0 tsx --test tests/*.test.ts`):

```
1..863
# tests 863 · pass 802 · fail 47 · cancelled 0 · skipped 14 · todo 0
exit 1   (47 merah DISENGAJA — red-before, belum ada implementasi)
```

Keempat-puluh-tujuh `not ok` di jalan penuh itu **persis** keempat-puluh-tujuh test
P0-03/karantina di atas — nol regresi di tempat lain, diverifikasi dengan
menyaring daftar `not ok` terhadap himpunan P0-03 dan mendapati sisa kosong.
Aritmetikanya tertutup terhadap baseline `PATH-CASE-MATRIX.md` (810 · 796 · 0 · 14):

```
ronde 1:  810 + 23 = 833 test ·  796 + 6 − 1 = 801 lulus ·  18 gagal
ronde 2:  833 + 15 = 848 test ·  801 + 1     = 802 lulus ·  32 gagal
ronde 3:  848 + 15 = 863 test ·  802         = 802 lulus ·  47 gagal
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
sekali: nol perubahan produksi, dan jumlah test merah justru NAIK di setiap
ronde — 14 (R1) → 18 (ronde 1) → 32 (ronde 2) → **47** (ronde 3) — karena
kontraknya menuntut makin banyak hal yang benar, bukan karena ada yang rusak. Sesuai batas
Reviewer, seluruh slice product-truth yang selesai pun hanya memindahkan
kesiapan keseluruhan sekitar 40 → 55–58; 80/100 tetap butuh gerbang
Founder/eksternal yang belum dikerjakan.

P0A_TEST_SHA=4a0a3434848a9cb79c687d1dd238f79e63d7df5e  (ronde 1)
P0A2_TEST_SHA=f5d4029522bbeb4fbcbf4b885457369bdf3e83a6                       (ronde 2)
P0A3_TEST_SHA=f22d6e80e51e95a58a7ddb4f03095f85fbe3c7e9                                           (ronde 3)
