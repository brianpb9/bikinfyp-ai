# Mengunci tarif NYATA per model — checklist sekali baca

Semua angka COGS kita berasal dari tabel tarif di
`lib/providers/stubs/byteplus.ts`, dan tabel itu menandai dirinya sendiri
"ESTIMASI dari COGS BRD §5.3" untuk kedua model dreamina. Sampai tarif nyata
dibaca, tidak ada keputusan harga landing yang boleh diambil.

**Ini tugas yang butuh login konsol BytePlus — tidak bisa dijalankan dari repo.**

## Yang perlu dibaca (5 angka)

Di dasbor BytePlus → Billing / Usage, pilih rentang **20 Agu 2026** (hari ini
ada 6 render yang tercatat, cukup untuk memisahkan per model):

| # | Yang dicari | Dipakai untuk |
|---|---|---|
| 1 | Tarif `dreamina-seedance-2-0-mini-260615` per detik 720p | COGS high_quality |
| 2 | Tarif `dreamina-seedance-2-0-260128` per detik 720p | COGS super_hq |
| 3 | Apakah audio ditagih terpisah dari video | semua tier bersuara |
| 4 | Total tagihan 20 Agu | uji silang: estimasi kita Rp84.406 |
| 5 | Kurs USD→IDR yang dipakai penagihan | semua konversi |

### Uji silang Rp84.406 BATAL — dan penggantinya lebih bersih

Ditambahkan 20 Agu sesudah membaca daftar task lewat API.

Rencana semula membandingkan tagihan 20 Agu dengan estimasi Rp84.406 milik
saya. Itu tidak sah: dari **62 task** akun pada 20 Agu, hanya **6 milik sesi
ini**. Sisanya — termasuk 20 task `dreamina-seedance-2-5` pukul 21:51 — berasal
dari sesi/pemakai lain. Tagihan akun mencakup semuanya, jadi selisih apa pun
terhadap Rp84.406 tidak membuktikan apa-apa tentang tarif.

**Dasar bersih penggantinya: token per task dari API.** Endpoint
`/contents/generations/tasks` mengembalikan `usage.total_tokens`, `duration`,
`resolution`, `model`, dan `generate_audio` per task — dan tokennya konsisten
per model+resolusi (mis. dreamina-2-0 720p ber-audio ≈ 39.113 token/detik).
Artinya **unit penagihannya token**, bukan detik.

Jadi yang dibutuhkan dari konsol tinggal **harga per juta token per model**.
Begitu angka itu masuk ke `MODEL_RATES` sebagai `tokenUsdPerM`,
`estimateCostIdr()` otomatis berhenti menaksir: ia sudah punya cabang token,
dan label "(estimasi tarif)" di log akan hilang sendiri tanpa render ulang.

## Sesudah angkanya ada

1. Perbarui `MODEL_RATES` di `lib/providers/stubs/byteplus.ts`, dan **hapus
   kata ESTIMASI** dari komentar model yang tarifnya sudah pasti.
2. Jalankan ulang perhitungan margin — angkanya turunan, bukan ditulis tangan:
   `npx tsx scripts/ukur-cogs-tier.ts <tier>` tidak perlu render ulang untuk
   ini; yang berubah cuma tabel tarifnya.
3. Perbarui ambang alarm margin dari angka terukur, bukan dari angka BRD.
4. Perbarui `docs/evidence/cogs-canary-2026-08-20.md` dan buang peringatan
   "cara baca" di atasnya.

## Kenapa tidak diotomatiskan

Respons render BytePlus yang kita terima tidak memuat `usage`/token, jadi biaya
per panggilan tidak bisa dihitung dari respons — hanya dari tarif. Kalau suatu
saat responsnya membawa usage, `estimateCostIdr()` sudah siap memakainya dan
label "(estimasi tarif)" di log akan hilang dengan sendirinya.
