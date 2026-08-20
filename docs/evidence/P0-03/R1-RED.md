# P0-03 RED WAVE R1 — bukti MERAH sebelum perbaikan

BASE_SHA=66b4b338792a34890134c2450c9e78a20703516f (pendek: 66b4b33)
BRANCH=work/p0-product-truth-20260820
TANGGAL=2026-08-20
LINGKUP=C8 (bukti hilang/korup/basi/hash beda) + C1 (foto#1 banner, foto#2 packshot) + W1/W2
PERUBAHAN PRODUKSI=NOL. Hanya tiga berkas test baru (`git status --short` = 3 berkas `??` di `tests/`).

## Perintah persis

```
SCRIPT_LLM=0 npx tsx --test tests/product-truth-evidence.test.ts tests/product-truth-worker-reference.test.ts tests/product-truth-worker-wiring.test.ts
```

Hasil: **15 test · 5 lulus · 10 gagal · 0 skip · 0 cancelled · 0 todo**.
Dijalankan dua kali berturut-turut pada SHA ini, hasilnya identik.

Kelima yang LULUS adalah kontrol positif dan pemeriksa harness — bukan kebetulan.
Kesepuluh yang GAGAL semuanya gagal karena **asersi**, bukan karena harness:
tidak ada module-not-found, tidak ada error env, tidak ada skip, tidak ada
percobaan OCR/jaringan, tidak ada error fixture.

## Berkas

| Berkas | Cakupan |
|---|---|
| `tests/product-truth-evidence.test.ts` | kontrak bukti di pusat: `referensiLayak()` + `setMediaStorageForTests()` dengan storage in-memory |
| `tests/product-truth-worker-reference.test.ts` | W2 lewat `processJob()` nyata di atas SQLite lokal; spy storage mencatat setiap `materialize(key)` dan mengembalikan null supaya worker berhenti sebelum langkah berbayar |
| `tests/product-truth-worker-wiring.test.ts` | struktural: W1 + W2 harus lewat SATU resolver referensi bersama. **W1 TIDAK dijalankan** — ia butuh PostgreSQL; klaimnya struktural saja |

## Daftar test

`tests/product-truth-evidence.test.ts`
1. kontrol positif: sidecar sah (sha256 cocok + versi terkini) diterima — **LULUS**
2. kontrol positif: foto#1 promosi ditolak, foto#2 sah dipilih (C1) — **LULUS**
3. C8: berkas referensi hilang, sidecar masih ada -> tidak boleh lolos — **GAGAL**
4. C8: sidecar hilang (berkas ada) -> tidak boleh MENCETAK bukti baru saat render — **GAGAL**
5. C8: sidecar JSON korup -> tidak boleh ditimpa diam-diam lalu diloloskan — **GAGAL**
6. C8: sidecar tanpa versi bukti -> tidak boleh lolos — **GAGAL**
7. C8: versi bukti basi -> tidak boleh lolos — **GAGAL**
8. C8: sha256 sidecar beda dari bytes tersimpan -> tidak boleh lolos — **GAGAL**
9. nol jaringan selama seluruh berkas test ini — **LULUS**

`tests/product-truth-worker-reference.test.ts`
10. W2 C1: worker wajib memilih packshot sah, bukan images[0] (banner promo) — **GAGAL**
11. W2 C8: bukti korup -> worker tidak boleh menyentuh storage sama sekali — **GAGAL**
12. W2 kontrol positif: sesudah halt — nol output, nol capture, nol provider, nol jaringan — **LULUS**

`tests/product-truth-worker-wiring.test.ts`
13. harness: kedua sumber worker terbaca dan tidak kosong — **LULUS**
14. W1+W2: kedua worker memakai SATU resolver referensi tersetujui yang sama — **GAGAL**
15. W1+W2: tidak ada pengindeksan images[0] mentah di kedua worker — **GAGAL**

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

**(6) versi bukti tidak ada**
```
EVIDENCE_INVALID: sidecar TANPA versi bukti tetap diterima (["uploads/p0-03/1.webp"]).
MetaGambar (lib/product-images.ts:98-105) tidak punya field versi sama sekali, jadi bukti yang
dibuat aturan lama tidak bisa dibedakan dari bukti yang dibuat aturan sekarang.
```

**(7) versi bukti basi**
```
EVIDENCE_INVALID: sidecar dengan versi bukti BASI (0 < 1) tetap diterima
(["uploads/p0-03/1.webp"]). Aturan klasifikasi yang diperketat tidak akan pernah berlaku surut
selama versi tidak diperiksa.
```

**(8) sha256 sidecar beda dari bytes tersimpan**
```
EVIDENCE_INVALID / REF_HASH_MISMATCH: sidecar membawa sha256 23bc51f40102f80c… sementara bytes
tersimpan ber-sha256 02e9eb956da924e6…, tapi referensiLayak() tetap mengembalikan
["uploads/p0-03/1.webp"]. Hash di sidecar tidak pernah diverifikasi ulang terhadap isi berkas —
jadi bukti bisa ditempeli gambar apa pun.
```

**(10) W2 memilih referensi yang salah (C1)**
```
W2 memilih referensi utama YANG SALAH.
  diminta worker : uploads/w2-c1/0.webp  (banner promo, layakReferensi=false)
  seharusnya     : uploads/w2-c1/1.webp  (packshot, sidecar sah, sha256 cocok)
  seluruh urutan : ["uploads/w2-c1/0.webp"]
lib/worker.ts:109 memakai images[0] mentah — foto pertama menang hanya karena urutannya, tanpa
satu pun pembacaan bukti.
```

**(11) W2 menyentuh berkas referensi walau bukti korup**
```
EVIDENCE_INVALID: dengan sidecar KORUP, W2 tetap men-materialize ["uploads/w2-c8/0.webp"].
Worker harus gagal-tertutup SEBELUM menyentuh berkas referensi — ia tidak pernah membaca sidecar
sama sekali (lib/worker.ts:104-110), jadi bukti rusak dan bukti bersih diperlakukan identik.
```

**(14) tidak ada resolver bersama W1/W2**
```
TIDAK ADA resolver referensi tersetujui yang dipakai bersama oleh kedua worker.
  lib/postgres/worker.ts (W1) -> tidak ada kandidat
  lib/worker.ts (W2) -> tidak ada kandidat
  (dikecualikan, dan alasannya di BUKAN_RESOLVER: lib/media/person-safe-refs, lib/media/qc-frame)
Masing-masing worker memilih referensinya sendiri, jadi gerbang bukti yang dipasang di salah
satunya tidak pernah berlaku di yang lain.
```

**(15) indeks array mentah masih dipakai di kedua worker**
```
Referensi utama masih dipilih dengan indeks array mentah — urutan unggah, bukan bukti:
  lib/worker.ts:109: const imageRef = await mediaStorage().materialize(images[0]);
  lib/postgres/worker.ts:323: const imageRef = await mediaStorage().materialize(images[0]);
Pemilihan referensi harus lewat resolver bersama yang membaca sidecar, memverifikasi sha256
terhadap bytes tersimpan, dan gagal-tertutup kalau buktinya tidak sah.
```

## Nol jaringan, nol provider, nol biner

- `globalThis.fetch` diganti penjebak yang MENGHITUNG lalu MELEMPAR di kedua berkas
  runtime. Test 9 dan 12 menegaskan penghitungnya nol. Kalau ada satu panggilan
  saja, keduanya merah.
- Test 12 (lulus) membuktikan sesudah worker berhenti: `outputs` untuk job itu 0
  baris, `credit_ledger` type `capture` 0 baris, `provider_video` NULL,
  `provider_voice` NULL, `output_url` NULL, `cost_actual_idr` 0, dan storage spy
  mencatat 0 `put`.
- Biner: `tests/product-truth-evidence.test.ts` mengosongkan `PATH` ke direktori
  kosong; `tests/product-truth-worker-reference.test.ts` mengosongkan `PATH` DAN
  menunjuk `FFMPEG_PATH`/`FFPROBE_PATH` ke berkas yang tidak ada. Nol ffmpeg
  nyata, nol tesseract nyata, nol OCR nyata.
- Database: SQLite lokal di `/tmp` (dibuat dan dihapus per-jalan). Nol Postgres,
  nol Redis, nol R2, nol Render API, nol `.env` (`RACUN_NO_DOTENV=1`).

## Jebakan hijau-semu yang ditemukan dan ditutup saat menulis test ini

`klasifikasiGambar` MENELAN errornya sendiri dan mengembalikan
`promotional_graphic` ("RAGU = PROMOSI"). Versi pertama test untuk kasus
"sidecar hilang" dan "sidecar korup" digantungkan pada hasil akhir
`referensiLayak` — dan keduanya HIJAU, bukan karena invariantnya ada, melainkan
karena classifier gagal lalu memvonis "promosi". Itu bukti palsu.

Kedua kasus itu dipindahkan ke asersi yang tidak bergantung vonis classifier sama
sekali: **jalur baca tidak boleh MENULIS bukti baru ke storage**. Sekarang
keduanya merah karena `backfillMetaGambar` benar-benar mem-`put` sidecar di
tengah jalur render — dan kontrol positif (test 1) menegaskan pembacaan bukti
yang sah tidak menulis apa pun, jadi detektor tulisan itu bukan asersi kosong.

## Catatan cakupan

- **W1 (`lib/postgres/worker.ts`) TIDAK dijalankan.** Ia butuh PostgreSQL yang
  dilarang di gelombang ini. Klaim atas W1 hanya struktural (test 14 dan 15),
  dan itu ditulis eksplisit di kepala berkas testnya.
- `VERSI_BUKTI_TERKINI = 1` ditetapkan DI TEST, bukan diimpor: konstanta versi
  bukti belum ada di produksi — itu bagian dari cacatnya. Test menuntut
  PERILAKU (sidecar tanpa versi / versi lama ditolak), bukan nama simbol, supaya
  perbaikan bebas memilih penamaannya.
- Test 14 mengecualikan `lib/media/person-safe-refs` (soal wajah orang, bukan
  bukti produk) dan `lib/media/qc-frame` (`bolehJadiReferensi` menilai FRAME
  HASIL GENERASI untuk QC-F1, jauh sesudah foto produk dipilih, dan hanya ada di
  W1). Tanpa dua pengecualian itu test bisa lulus HAMPA.

RED_TEST_SHA=<to be filled after commit>
