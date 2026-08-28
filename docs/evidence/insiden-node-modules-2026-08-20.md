# Insiden: node_modules lenyap di tengah sesi — 20 Agu 2026

## Apa yang terjadi

Selama sesi kerja 20 Agu, `app/node_modules` hilang seluruhnya.

- ~15 menit sebelumnya: `npm run test` berjalan normal, 780 test, 0 gagal.
- Lalu: `npm run test` → `sh: tsx: command not found`.
- `ls node_modules` → tidak ada. `zod` juga tidak ada.
- Tidak ada perintah `rm`, `npm prune`, atau `npm install` yang dijalankan
  sesi ini. Kemungkinan besar sesi lain di mesin yang sama.

Pemulihan: `npm ci` dari `package-lock.json`. Suite kembali normal.

## Kenapa ini serius, terlepas dari penyebabnya

Selama beberapa menit, "suite hijau" dan "suite tidak bisa jalan" tidak bisa
dibedakan dari luar. Kalau kegagalannya lebih halus — misalnya satu paket
turun versi alih-alih hilang seluruhnya — hasil uji akan tetap keluar hijau
sambil menguji lingkungan yang berbeda dari yang dikira.

Ini kelas masalah yang sama dengan bukti render yang beku: laporan yang benar
tentang keadaan yang sudah tidak ada.

## Yang dipasang sesudahnya

Di `.github/workflows/ci.yml`, job `verify`:

1. `package-lock.json` wajib ada — hilangnya lockfile bukan peringatan, tapi
   kegagalan.
2. `git diff --exit-code` atas `package-lock.json` dan `package.json` SESUDAH
   `npm ci` — menangkap langkah yang menggeser dependensi diam-diam.
3. Pemeriksaan yang sama diulang SESUDAH `npm test`, karena langkah uji juga
   bisa memanggil `npm install`.

`npm ci` sendiri sudah menolak `package.json` yang tidak sinkron dengan
lockfile; yang belum dijaga adalah pergeseran yang terjadi SESUDAH install.

## Yang TIDAK diselesaikan

CI berjalan di runner bersih, jadi ia tidak bisa menangkap penyebab insiden ini
— proses lain di mesin pengembang. Untuk itu tidak ada penjagaan otomatis di
repo; yang ada cuma kebiasaan: kalau perilaku uji berubah mendadak dan tidak
masuk akal, periksa `node_modules` sebelum membedah kode.
