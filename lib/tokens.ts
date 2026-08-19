// Model token untuk dashboard brand (masukan tester lewat Brian, 2026-08-11:
// "topup 20.000 IDR maka dikonversi token 20.000. Setiap usage dikonversi
// menjadi token. Dan setiap additional service ada opsi charge token tambahan").
//
// KURSNYA SENGAJA 1 TOKEN = Rp1.
//
// Itu bukan kemalasan — itu yang membuat perubahan ini TIDAK memerlukan
// migrasi apa pun. credit_ledger.delta sudah menyimpan bilangan bulat rupiah,
// dan seluruh jalur tahan/tangkap/kembalikan sudah berjalan di atasnya selama
// berbulan-bulan (termasuk pengembalian otomatis saat render gagal). Kurs
// selain 1:1 akan memaksa mengubah setiap baris ledger yang sudah ada, dan
// setiap pembulatan menjadi peluang saldo melenceng beberapa token — pada
// uang, itu bug yang paling mahal untuk diperbaiki belakangan.
//
// Yang benar-benar berubah karena masukan tester: BAHASANYA (brand melihat
// "token", bukan "Rp") dan adanya harga eksplisit untuk layanan tambahan.
// Retail (bikinfyp.com) sengaja TIDAK diikutkan — di sana orang membeli paket
// rupiah lewat Duitku dan menyebutnya token justru membingungkan.

// Modul ini WAJIB bebas impor. DashboardChrome ("use client") memakainya
// lewat _components/format.ts; begitu file ini mengimpor lib/credits.ts,
// webpack ikut menyeret node:fs/node:path ke bundle klien dan build gagal.
// Karena itu fungsi HARGA (yang butuh tierPriceIdr) tinggal di lib/credits.ts,
// bukan di sini. Ketahuan saat build, bukan saat typecheck.

export const TOKEN_PER_IDR = 1;

export function idrToTokens(idr: number): number {
  return Math.round(idr * TOKEN_PER_IDR);
}

/** "20.000" — satuannya ditulis terpisah di UI supaya bisa dirangkai bebas. */
export function formatTokens(idr: number): string {
  return idrToTokens(idr).toLocaleString("id-ID");
}

/** "20.000 token" */
export function tokens(idr: number): string {
  return `${formatTokens(idr)} token`;
}
