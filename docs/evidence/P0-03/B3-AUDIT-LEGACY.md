# P0-B3 — audit bukti legacy: alatnya SELESAI, angkanya BELUM ADA

SHA=69d49fd61342b1a4fcc0b62c50d52a0721d55dbc (pendek: 69d49fd)
BRANCH=work/p0-product-truth-20260820
TANGGAL=2026-08-21
TASK=SHIP-80-20260821
STATUS REVIEW=**PASS** pada 69d49fd
STATUS SLICE=**alat selesai · angka BELUM DIUKUR**

Dokumen ini ditulis supaya sesi Builder berikutnya tidak perlu menyusun ulang
keadaan ini dari riwayat git. Ia mencatat dua hal yang sama pentingnya: apa
yang sudah lewat gerbang, dan apa yang **belum** — termasuk hal yang tidak
boleh disimpulkan dari PASS di atas.

## 1. Apa yang dijawab alat ini

Satu pertanyaan: **kalau penegakan bukti dinyalakan hari ini, berapa produk
yang berhenti bisa dirender, dan kenapa masing-masing?**

Seluruh produk yang hidup di produksi dibuat sebelum kontrak bukti ada.
Menyalakan gerbang tanpa mengetahui angkanya berarti mengetahui akibatnya dari
keluhan pengguna — yaitu terlambat.

## 2. Berkas

| Berkas | Peran |
|---|---|
| `lib/audit-bukti-produk.ts` | penghitung; hakimnya `resolveApprovedReference` yang SAMA |
| `lib/audit-sumber-produk.ts` | adapter baris: SQLite (`readonly`+`fileMustExist`) dan Postgres |
| `scripts/audit-bukti-produk.ts` | pembungkus CLI tipis; nol logika yang bisa salah hitung |
| `tests/audit-bukti-produk.test.ts` | 23 test |
| `tests/audit-sumber-produk.test.ts` | 5 test |

Menjalankannya:

```
npx tsx scripts/audit-bukti-produk.ts            # laporan siap-baca
npx tsx scripts/audit-bukti-produk.ts --json     # keluaran mesin
npx tsx scripts/audit-bukti-produk.ts --batas 50 # potong daftar, BUKAN cacah
```

Kode keluar SENGAJA 0 walau ada produk terbrick: ini alat UKUR, bukan gerbang.

## 3. Empat ember, dan kenapa dipisah

Menggabungkan salah satu pasangan di bawah membuat angkanya tidak bisa
ditindaklanjuti — itu penyebab enam dari sembilan temuan Reviewer pada slice ini.

| Ember | Arti | Kenapa TIDAK boleh digabung |
|---|---|---|
| `produkTerbrick` | punya foto, nol yang tersetujui | ini SATU-SATUNYA yang disebabkan gerbang |
| `produkTanpaFoto` | `images` = `[]` | memang belum pernah bisa dirender; gerbang tidak mengubah apa pun |
| `produkKolomRusak` | kolom `images` tidak terbaca | rusak SEKARANG; jumlah fotonya TIDAK DIKETAHUI |
| `produkGagalDiperiksa` | pemeriksaannya melempar | audit tidak bisa menilai — bukan vonis |

Sub-sebab `EVIDENCE_INVALID` juga dipisah (`SIDECAR_MISSING`, `SIDECAR_CORRUPT`,
`SIDECAR_SCHEMA`, `SIDECAR_VERSION`, `SIDECAR_CONTRADICTORY`) karena
pemulihannya berbeda: versi tidak cocok bisa direvalidasi SEANGKATAN, bentuk
rusak harus diperiksa satu per satu.

Sebab kolom rusak: `IMAGES_COLUMN_EMPTY`, `IMAGES_COLUMN_UNPARSEABLE`,
`IMAGES_COLUMN_NOT_ARRAY`, `IMAGES_COLUMN_BAD_ELEMENT`, `IMAGES_COLUMN_BAD_KEY`.

## 4. Invarian yang dijaga test — jangan dilemahkan tanpa mengganti penjaganya

1. **HANYA BACA.** Nol tulis ke storage. Jalur SQLite dibuka `readonly` +
   `fileMustExist`; test membandingkan sha256 SELURUH BERKAS, dump
   `sqlite_master`, DAN daftar isi direktori (supaya penyalaan WAL yang membuat
   `-wal`/`-shm` juga terhitung perubahan).
   Sebabnya: `getDb()` bukan pembuka koneksi — ia meng-exec schema lalu migrasi,
   termasuk `DROP TABLE otp_codes`, sederet `ALTER TABLE`, `UPDATE jobs`, dan
   pembangunan ulang tabel `users` lewat rename.
2. **HAKIMNYA RESOLVER YANG SAMA.** Disilangkan langsung terhadap
   `resolveApprovedReference`. Aturan tandingan akan melaporkan angka yang tidak
   pernah cocok dengan kenyataan saat gerbang menyala.
3. **KERUSAKAN TIDAK MENYAMAR JADI KEKOSONGAN.** Hanya `[]` yang berarti "tidak
   punya foto". `NULL`, `""`, whitespace → kerusakan. Skema menyatakan
   `images TEXT NOT NULL DEFAULT '[]'`.
4. **KONTRAK KUNCI DIPINJAM, BUKAN DISALIN.** `kunciStorageSah` (lib/storage)
   memanggil `safeKey` yang sama dengan setiap adapter. Test menyilangkan
   keputusan parser dengan predikat itu untuk sembilan kunci.
   Catatan yang mudah salah ditebak: `"/x.webp"` dan `"   "` **lolos validasi
   kunci** — safeKey membuang garis miring di depan, dan whitespace adalah nama
   berkas yang sah. Vonis SESUDAHNYA bergantung pada keadaan sidecar dan bytes,
   bukan pada bentuk kuncinya: `nilaiSatu()` memeriksa sidecar LEBIH DULU, jadi
   tanpa sidecar hasilnya `EVIDENCE_INVALID / SIDECAR_MISSING`; `REF_MISSING`
   hanya terjadi kalau sidecar SAH ada sementara bytes utamanya hilang.
   (Koreksi temuan Reviewer atas cd70288: baris ini semula menyatakan keduanya
   "berakhir REF_MISSING" — saya menebak vonis resolver tanpa membaca urutan
   pemeriksaannya. Sekarang urutan itu dikunci test, bukan diklaim di dokumen.)
5. **SATU PINTU.** `ProdukUntukAudit.images` menerima `string[] | HasilKolomRusak`
   saja. Bentuk `{ok:true}` tidak bisa diungkapkan, DAN diperiksa ulang saat
   runtime kalau diselundupkan lewat `as`.
6. **SELALU KELUAR DENGAN ANGKA.** Satu baris yang melempar tidak boleh
   menihilkan laporan. Audit yang mati di baris ke-9.000 dari 10.000 memberi nol
   informasi.
7. **BATAS DAFTAR TIDAK MEMOTONG CACAH.** Cacah yang ikut terpotong adalah cara
   audit berbohong tanpa berbohong.

## 5. Yang BELUM selesai — jangan disimpulkan dari PASS

**Alatnya belum pernah dijalankan terhadap data nyata.** Ia butuh akses database
produksi/staging, dan akses itu belum ada. Artinya: **berapa produk yang akan
terbrick masih TIDAK DIKETAHUI** — yaitu justru pertanyaan yang seluruh slice
ini dibangun untuk menjawab. P0-B3 belum bisa disebut selesai sebagai LANGKAH,
hanya sebagai ALAT.

**PASS ini berbasis review statis.** Reviewer menutup pesannya: *"Test suite
serta typecheck tidak dapat dijalankan karena worktree ini sengaja tidak
memiliki `node_modules`; angka pengujian dalam pesan Builder tidak dianggap
sebagai bukti terverifikasi."* Yang ada adalah review statis Reviewer plus bukti
mutasi Builder (setiap perbaikan dimatikan, lalu ditunjukkan test mana yang
merah). Itu mitigasi, bukan verifikasi pihak kedua.

## 6. Urutan yang tersisa, dan gerbangnya

**P0-B4 dipecah dua, dan itu koreksi atas penilaian Builder sendiri.** Catatan
versi pertama dokumen ini menyebut seluruh P0-B4 tertahan T43. Yang tertahan
adalah TINDAKANNYA (hold, tolak, atau revalidasi). PENGAMATANNYA dibutuhkan sama
saja di ketiga opsi — dan justru pengamatan itulah yang menghasilkan angka untuk
memutuskan T43.

| Bagian | Isi | Status |
|---|---|---|
| P0-B4 observasi | kanari bukti (`lib/kanari-bukti.ts`): kode alasan sebagai data, satu baris terstruktur per penilaian di KEDUA worker, `ditolakSemuaBelumDiperiksa` dihitung sendiri | **SELESAI** — nol penegakan |
| P0-B4 tindakan | apa yang DILAKUKAN saat kanari menyala | menunggu T43 |
| P0-B5 | resolver ketat jadi otoritatif di admission | menunggu T43 |

Kanari TIDAK memblokir, TIDAK menunda, TIDAK mengubah satu pun vonis, dan TIDAK
PERNAH MELEMPAR — termasuk saat penulisannya sendiri melempar. Cacahnya
PROSES-LOKAL (hilang saat restart; cacah worker tidak muncul di `/api/health`
milik web); permukaan agregasi yang sebenarnya adalah baris lognya.

Ia juga hanya menghasilkan angka KALAU DI-DEPLOY. Di mesin pengembang ia tidak
membuktikan apa pun tentang produksi.

**T43 — di meja Founder, belum dijawab.** Penegakan tidak bisa dinyalakan
sebelum ada jalur revalidasi: di runtime web tanpa biner klasifikasi, setiap
unggahan menghasilkan `belum_diperiksa` yang SAH, worker menolak setiap render,
dan unggah ulang menghasilkan keadaan yang sama. Titik penegakannya
`lib/job-intake.ts:104` (`assertPaidAdmission`).

| Opsi | Isi |
|---|---|
| A | worker revalidasi + gerbang bukti sebelum hold |
| B | admission digerbangi kapabilitas |
| C | ubah kapabilitas/deployment web |

Rekomendasi Builder: **A+B**, didahului satu deploy staging untuk membaca
`/api/health` (probe kapabilitas sudah ada sejak 0028850) — supaya kapabilitas
runtime web diukur, bukan ditebak.

Prasyarat lain yang tidak boleh dilewati: **angka audit di bagian 5 harus ada
lebih dulu.** Menyalakan penegakan tanpanya persis kesalahan yang alat ini
dibangun untuk mencegah.
