# P0-03 RED WAVE R1 — bukti MERAH sebelum perbaikan

BASE_SHA=66b4b338792a34890134c2450c9e78a20703516f (pendek: 66b4b33)
AMEND_BASE_SHA=39d363e6980ea792f98d9bcb1446242bee299ffe (pendek: 39d363e)

KOREKSI SHA (P0-A, 21 Agu — temuan Reviewer). Baris ini SEBELUMNYA menyebut
6623c4f sebagai basis jalan yang diamandemen. Itu salah dan bisa diperiksa:
`git show --stat 6623c4f` hanya mengubah SATU baris dokumen ini; berkas test
pada commit itu masih versi R1 awal (15 test). Jalan 19-test hanya mungkin di
39d363e — commit yang benar-benar berisi test itu. Bukti yang menunjuk SHA yang
salah adalah bukti yang tidak bisa direproduksi siapa pun.
BRANCH=work/p0-product-truth-20260820
TANGGAL=2026-08-20 · diamandemen 2026-08-21
LINGKUP=C8 (bukti hilang/korup/tipe salah/basi/hash beda) + C1 (foto#1 banner, foto#2 packshot) + W1/W2
PERUBAHAN PRODUKSI=NOL. **EMPAT berkas baru**: tiga berkas test + satu berkas bukti (dokumen ini).

## Perintah persis

```
SCRIPT_LLM=0 npx tsx --test tests/product-truth-evidence.test.ts tests/product-truth-worker-reference.test.ts tests/product-truth-worker-wiring.test.ts
```

| Jalan | Hasil |
|---|---|
| R1 awal (di 66b4b33) | 15 test · 5 lulus · 10 gagal · 0 skip |
| **R1 diamandemen (di 39d363e)** | **19 test · 5 lulus · 14 gagal · 0 skip · 0 cancelled · 0 todo** |
| **R2 kontrak diperbaiki (di P0A_TEST_SHA)** | lihat `docs/evidence/P0-03/R2A-KONTRAK.md` |

Jalan yang diamandemen dijalankan dua kali berturut-turut, hasilnya identik.

Kelima yang LULUS adalah kontrol positif dan pemeriksa harness — bukan kebetulan.
Keempat-belas yang GAGAL semuanya `code: 'ERR_ASSERTION'` (diverifikasi: 14 dari
14 kegagalan ber-kode itu, nol kode lain). Tidak ada module-not-found, tidak ada
error env, tidak ada skip, tidak ada percobaan jaringan, tidak ada error fixture.

## Berkas

| Berkas | Cakupan |
|---|---|
| `tests/product-truth-evidence.test.ts` | kontrak bukti di pusat: `referensiLayak()` + `setMediaStorageForTests()` dengan storage in-memory |
| `tests/product-truth-worker-reference.test.ts` | W2 lewat `processJob()` nyata di atas SQLite lokal; spy storage mencatat setiap `materialize(key)` dan mengembalikan null supaya worker berhenti sebelum langkah berbayar |
| `tests/product-truth-worker-wiring.test.ts` | struktural: W1 + W2 wajib mengimpor DAN memanggil `resolveApprovedReference` dari `lib/product-truth.ts`. **W1 TIDAK dijalankan** — ia butuh PostgreSQL; klaimnya struktural saja |
| `docs/evidence/P0-03/R1-RED.md` | dokumen ini |

## Kontrak yang DIKUNCI test ini (wajib dipakai perbaikan R2)

Ini bukan usulan. Test sudah mengikat nama-namanya; implementasi yang memakai
nama lain akan tetap merah.

| Hal | Nilai terkunci |
|---|---|
| Modul API pusat | `lib/product-truth.ts` |
| Ekspor bernama | `resolveApprovedReference` |
| Field versi di sidecar | `versiBukti` |
| Tipe field versi | integer |
| Nilai versi kini | `1` |

Sidecar tanpa `versiBukti`, atau dengan nilai lebih kecil dari nilai kini,
adalah `EVIDENCE_INVALID`. Kedua worker wajib memilih referensi HANYA lewat
`resolveApprovedReference()`; indeks array mentah `images[0]` dilarang di
keduanya.

## Daftar test

`tests/product-truth-evidence.test.ts`
1. kontrol positif: sidecar sah (sha256 cocok + versi terkini) diterima — **LULUS**
2. kontrol positif: foto#1 promosi ditolak, foto#2 sah dipilih (C1) — **LULUS**
3. C8: berkas referensi hilang, sidecar masih ada -> tidak boleh lolos — **GAGAL**
4. C8: sidecar hilang (berkas ada) -> tidak boleh MENCETAK bukti baru saat render — **GAGAL**
5. C8: sidecar JSON korup -> tidak boleh ditimpa diam-diam lalu diloloskan — **GAGAL**
6. C8: skema sah tapi TIPE FIELD salah -> tidak boleh lolos — **GAGAL** *(baru, amandemen 3)*
7. C8: sidecar tanpa versi bukti -> tidak boleh lolos — **GAGAL**
8. C8: versi bukti basi -> tidak boleh lolos — **GAGAL**
9. C8: sha256 sidecar beda dari bytes tersimpan -> tidak boleh lolos — **GAGAL**
10. nol jaringan selama seluruh berkas test ini — **LULUS**

`tests/product-truth-worker-reference.test.ts`
11. W2 C1: worker wajib memilih packshot sah, bukan images[0] (banner promo) — **GAGAL**
12. W2 C8: sidecar KORUP — payload tidak boleh di-materialize sebelum bukti sah — **GAGAL** *(diperbaiki kata-katanya, amandemen 2)*
13. W2 C8: sidecar HILANG (bytes ada) — payload tidak boleh di-materialize sebelum bukti sah — **GAGAL** *(baru, amandemen 2)*
14. W2 kontrol positif: sesudah halt — nol output/capture/regen/provider/put/jaringan — **LULUS**

`tests/product-truth-worker-wiring.test.ts`
15. harness: kedua sumber worker terbaca dan parser impor benar-benar bekerja — **LULUS**
16. API pusat lib/product-truth.ts ada dan mengekspor resolveApprovedReference — **GAGAL** *(baru, amandemen 5)*
17. W1+W2: kedua worker mengimpor resolveApprovedReference dari lib/product-truth — **GAGAL** *(ditulis ulang, amandemen 5)*
18. W1+W2: kedua worker benar-benar MEMANGGIL resolveApprovedReference — **GAGAL** *(baru, amandemen 5)*
19. W1+W2: tidak ada pengindeksan images[0] mentah di kedua worker — **GAGAL**

## Pesan asersi persis, per cacat

**(3) berkas referensi hilang, sidecar masih ada**
```
EVIDENCE_INVALID: berkas uploads/p0-03/1.webp TIDAK ADA di storage, tapi referensiLayak() tetap
mengembalikan ["uploads/p0-03/1.webp"] karena ia hanya membaca sidecar dan tidak pernah
membuktikan bytes-nya ada.
```

**(4) sidecar hilang — bukti dicetak sendiri saat render**
```
EVIDENCE_INVALID: referensiLayak() MENULIS bukti baru saat dibaca:
["uploads/p0-03/1.webp.meta.json"]. backfillMetaGambar (lib/product-images.ts:156-178)
mengklasifikasi ulang dan mem-put sidecar di tengah jalur render — bukti dicetak sendiri oleh
pemakainya, tanpa rantai kustodi.
```

**(5) sidecar JSON korup — ditimpa diam-diam**
```
EVIDENCE_INVALID: sidecar KORUP diperlakukan sama dengan "tidak ada" (bacaMetaGambar menelan
error, lib/product-images.ts:113-115), lalu backfill MENIMPANYA:
["uploads/p0-03/1.webp.meta.json"]. Bukti yang rusak justru dihapus jejaknya, bukan dilaporkan.
```

**(6) skema sah tapi TIPE FIELD salah — BARU**
```
EVIDENCE_INVALID: sidecar dengan TIPE FIELD salah (layakReferensi: "false" sebagai STRING) tetap
diterima (["uploads/p0-03/1.webp"]). bacaMetaGambar hanya JSON.parse lalu meng-cast ke MetaGambar
(lib/product-images.ts:112) — tidak ada satu pun pemeriksaan bentuk, jadi string "false" yang
truthy dibaca sebagai LAYAK. Buktinya sendiri berkata sebaliknya.
```

**(7) versi bukti tidak ada**
```
EVIDENCE_INVALID: sidecar TANPA versi bukti tetap diterima (["uploads/p0-03/1.webp"]).
MetaGambar (lib/product-images.ts:98-105) tidak punya field versi sama sekali, jadi bukti yang
dibuat aturan lama tidak bisa dibedakan dari bukti yang dibuat aturan sekarang.
```

**(8) versi bukti basi**
```
EVIDENCE_INVALID: sidecar dengan versi bukti BASI (0 < 1) tetap diterima
(["uploads/p0-03/1.webp"]). Aturan klasifikasi yang diperketat tidak akan pernah berlaku surut
selama versi tidak diperiksa.
```

**(9) sha256 sidecar beda dari bytes tersimpan**
```
EVIDENCE_INVALID / REF_HASH_MISMATCH: sidecar membawa sha256 23bc51f40102f80c… sementara bytes
tersimpan ber-sha256 02e9eb956da924e6…, tapi referensiLayak() tetap mengembalikan
["uploads/p0-03/1.webp"]. Hash di sidecar tidak pernah diverifikasi ulang terhadap isi berkas —
jadi bukti bisa ditempeli gambar apa pun.
```

**(11) W2 memilih referensi yang salah (C1)**
```
W2 memilih referensi utama YANG SALAH.
  diminta worker : uploads/w2-c1/0.webp  (banner promo, layakReferensi=false)
  seharusnya     : uploads/w2-c1/1.webp  (packshot, sidecar sah, sha256 cocok)
  seluruh urutan : ["uploads/w2-c1/0.webp"]
lib/worker.ts:109 memakai images[0] mentah — foto pertama menang hanya karena urutannya, tanpa
satu pun pembacaan bukti.
```

**(12) W2 mengambil payload walau bukti korup**
```
EVIDENCE_INVALID: dengan sidecar KORUP, W2 tetap men-materialize payload
["uploads/w2-c8-korup/0.webp"]. Worker harus gagal-tertutup SEBELUM mengambil bytes referensi —
ia tidak pernah membaca sidecar sama sekali (lib/worker.ts:104-110), jadi bukti rusak dan bukti
bersih diperlakukan identik. (Membaca sidecar lewat get()/stat() untuk MEMVALIDASI justru wajib,
dan tidak dilarang test ini.)
```

**(13) W2 mengambil payload walau bukti TIDAK ADA — BARU**
```
EVIDENCE_INVALID: TANPA sidecar sama sekali, W2 tetap men-materialize payload
["uploads/w2-c8-hilang/0.webp"]. Tidak ada satu pun bukti yang menyatakan gambar ini layak jadi
referensi, tapi worker langsung mengambil bytes-nya karena ia hanya melihat posisi images[0]
(lib/worker.ts:104-110).
```

**(16) API pusat belum ada — BARU**
```
Modul pusat lib/product-truth.ts BELUM ADA. Pemilihan referensi tersetujui tidak punya satu rumah
pun, jadi setiap pemanggil terpaksa menyusun aturannya sendiri — dan itulah kenapa W1 dan W2 bisa
berbeda.
```

**(17) kedua worker tidak mengimpor API pusat**
```
Worker berikut TIDAK mengimpor resolveApprovedReference dari lib/product-truth:
  lib/worker.ts (W2)
  lib/postgres/worker.ts (W1)
Selama pemilihan referensi tidak lewat satu API pusat, gerbang bukti yang dipasang di satu worker
tidak pernah berlaku di worker yang lain.
```

**(18) kedua worker tidak memanggil API pusat — BARU**
```
Worker berikut tidak pernah MEMANGGIL resolveApprovedReference():
  lib/worker.ts (W2)
  lib/postgres/worker.ts (W1)
Referensi utamanya masih dipilih dengan cara lain.
```

**(19) indeks array mentah masih dipakai di kedua worker**
```
Referensi utama masih dipilih dengan indeks array mentah — urutan unggah, bukan bukti:
  lib/worker.ts:109: const imageRef = await mediaStorage().materialize(images[0]);
  lib/postgres/worker.ts:323: const imageRef = await mediaStorage().materialize(images[0]);
Pemilihan referensi harus lewat lib/product-truth.resolveApprovedReference(), yang membaca
sidecar, memverifikasi sha256 terhadap bytes tersimpan, memeriksa versiBukti, dan gagal-tertutup
kalau buktinya tidak sah.
```

## Nol efek samping pada job yang SAMA

`assertNolEfekSamping(jobId, spy, konteks)` dipanggil untuk SETIAP job di
`tests/product-truth-worker-reference.test.ts`, dan **sebelum** asersi merah
utamanya — supaya pemeriksaan uang tetap berjalan walaupun asersi pilihan
referensi gagal. Pada job yang sama ia menuntut:

- 0 baris `outputs`;
- 0 baris `credit_ledger` bertipe `capture`;
- 0 baris `credit_ledger` bertipe `regen`;
- `provider_video`, `provider_voice`, `output_url` masih NULL;
- `cost_actual_idr` masih 0;
- 0 `put` ke storage;
- 0 panggilan jaringan.

`release`/`REFUNDED` **sengaja TIDAK dilarang**. Job yang gagal wajib boleh
mengembalikan hold-nya; melarang release berarti menuntut kredit user hangus
saat gerbang bukti menolak — kebalikan dari yang benar.

## Nol jaringan, nol biner yang benar-benar jalan

- `globalThis.fetch` diganti penjebak yang MENGHITUNG lalu MELEMPAR di kedua
  berkas runtime. Penghitungnya **0** di seluruh jalan (test 10 dan test 14
  menegaskannya, dan helper nol-efek-samping memeriksanya lagi di setiap job).
  Nol permintaan jaringan, nol panggilan provider.
- **Koreksi terhadap klaim R1 sebelumnya:** ada **dua percobaan spawn `ffmpeg`
  yang berakhir ENOENT** di `tests/product-truth-evidence.test.ts` (terlihat di
  log TAP: `[klasifikasi] gagal memeriksa, dianggap promosi: spawn ffmpeg
  ENOENT`, dua kali). Itu datang dari `backfillMetaGambar` pada dua kasus C8
  yang menyentuh jalur backfill. Jadi klaim yang benar adalah **nol biner yang
  benar-benar dieksekusi**, bukan "nol percobaan": `PATH` dikosongkan ke
  direktori kosong sehingga setiap spawn mati seketika di ENOENT. Nol ffmpeg
  nyata berjalan, nol tesseract nyata berjalan, nol OCR nyata.
  `tests/product-truth-worker-reference.test.ts` mengosongkan `PATH` DAN
  menunjuk `FFMPEG_PATH`/`FFPROBE_PATH` ke berkas yang tidak ada; di berkas itu
  bahkan nol percobaan spawn terjadi, karena worker berhenti jauh sebelumnya.
- Database: SQLite lokal di `/tmp` (dibuat dan dihapus per-jalan). Nol Postgres,
  nol Redis, nol R2, nol Render API, nol `.env` (`RACUN_NO_DOTENV=1`).

## Jebakan hijau-semu yang ditemukan dan ditutup saat menulis test ini

1. **Vonis classifier menutupi cacat.** `klasifikasiGambar` MENELAN errornya
   sendiri dan mengembalikan `promotional_graphic` ("RAGU = PROMOSI"). Versi
   pertama test untuk "sidecar hilang" dan "sidecar korup" digantungkan pada
   hasil akhir `referensiLayak` — dan keduanya HIJAU, bukan karena invariantnya
   ada, melainkan karena classifier gagal lalu memvonis "promosi". Keduanya
   dipindahkan ke asersi yang tidak bergantung vonis sama sekali: **jalur baca
   tidak boleh MENULIS bukti baru ke storage**. Kontrol positif (test 1)
   menegaskan pembacaan bukti yang sah tidak menulis apa pun, jadi detektor
   tulisan itu bukan asersi kosong.
2. **Regex nama generik bisa lulus-palsu DAN gagal-palsu.** Test wiring versi
   pertama berburu resolver lewat `/referensi|reference/i` dan sempat menyorot
   `bolehJadiReferensi` (milik QC frame, soal frame HASIL generasi) sebagai
   kandidat. Sekarang modul dan nama ekspornya ditetapkan
   (`lib/product-truth.resolveApprovedReference`), jadi tidak ada ruang tebak.
3. **"Tidak boleh menyentuh storage sama sekali" terlalu keras.** Validator yang
   BENAR justru harus membaca sidecar dan bytes lewat `get()`/`stat()` untuk
   memverifikasi sha256. Asersinya dipersempit ke `materialize()` — pengambilan
   PAYLOAD — dan judul testnya diperbaiki mengikuti.

## Catatan cakupan

- **W1 (`lib/postgres/worker.ts`) TIDAK dijalankan.** Ia butuh PostgreSQL yang
  dilarang di gelombang ini. Klaim atas W1 hanya struktural (test 16-19), dan
  itu ditulis eksplisit di kepala berkas testnya.
- Kasus C8 "sidecar hilang" di W2 bukan hipotetis: jalur org
  (`saveUniqueProductImages`) memang tidak pernah menulis sidecar sama sekali
  (matriks P0-03 baris E8), jadi itu keadaan normal untuk setiap produk yang
  dibuat lewat dashboard enterprise.

RED_TEST_SHA=f2ad65bbe9e31b75740690f0cbe86f5128ea2b5b (R1 awal, 15 test)
R1_AMENDED_TEST_SHA=39d363e6980ea792f98d9bcb1446242bee299ffe
R1_AMENDED_EVIDENCE_SHA=bf22341305edcc615565b91eae9ccda18ecfb842

(Placeholder `<commit ini sendiri ...>` yang lama sudah diikat ke SHA nyata:
bf22341 adalah commit yang menulis R1_AMENDED_TEST_SHA ke berkas ini.)

LANJUTAN: kontrak di dokumen ini DIPERBAIKI di gelombang P0-A. Lihat
`docs/evidence/P0-03/R2A-KONTRAK.md` untuk enam perbaikan kontrak, alasannya,
dan hitungan merah yang baru. Bagian "Daftar test" di atas menggambarkan
keadaan pada 39d363e, bukan keadaan sekarang.
