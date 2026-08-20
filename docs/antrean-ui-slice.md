# Antrean slice UI berikutnya

Tiga hal yang menunggu satu slice UI, dikumpulkan supaya tidak tercecer di
riwayat percakapan.

## 1. Saran resolusi foto di wizard unggah

Sarankan penjual mengunggah foto produk **≥1000px di sisi panjang**, dengan
ALASANNYA — bukan sekadar angka:

> Foto yang lebih besar bikin bagian penutup video (foto produkmu) tampil lebih
> tajam.

Dasarnya terukur: packshot penutup dibangun dari foto asli lalu dinaikkan ke
720×1280. Bukti 20 Agu memakai sumber 351px — mereknya tetap terbaca tapi
hurufnya melunak (`docs/evidence/kebijakan-jarak-label-2026-08-20.md`).

Ini SARAN, bukan gerbang: menolak foto kecil akan mengunci penjual yang cuma
punya foto dari marketplace.

## 2. Ingatan pilihan terakhir (client-side)

Bagian frontend dari pustaka aset. Simpan pilihan referensi terakhir per
produk di sisi klien, supaya pengguna tidak memilih ulang tiap generasi.
Batasnya `MAKS_REFERENSI_PER_GENERASI = 7` (lib/product-images.ts).

## 3. Pemilih tiga ide teratas

Layar untuk `IDEA_GATE_FAILED` (422). Badan responsnya sudah membawa
`ide_kandidat` (ide + skor + sebab gagal) dan `sebab_gagal`. Yang dibutuhkan:
dua tombol — "cari ide lagi" dan "tulis dari ide ini" — dan yang kedua
mengirim ulang permintaan dengan `idea: <kandidat>`.

Tanpa layar ini, gate yang gagal berakhir sebagai pesan error tanpa jalan
keluar, padahal jalan keluarnya sudah ada di API.
