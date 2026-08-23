// Terbilang harga untuk DIALOG LISAN (resep r4, keputusan Brian 2026-08-07):
// model video membaca "Rp299.000" secara harfiah/ngaco — harga di dialog wajib
// ditulis kata: "dua ratus sembilan puluh sembilan ribu rupiah". Teks skrip/
// caption/validator TETAP memakai angka; konversi hanya di shot-planner.
//
// HATI-HATI: jangan konversi semua digit — nama produk sering berkode angka
// (SKIN1004, EZ4, R45). Hanya POLA HARGA yang dikonversi: berprefiks Rp,
// berformat ribuan (299.000), atau berakhiran rb/ribu/jt/juta.

const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

/** Terbilang bilangan bulat 0..999.999.999.999 dalam bahasa Indonesia. */
export function terbilang(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n < 12) return n === 0 ? "nol" : SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh${n % 10 ? ` ${terbilang(n % 10)}` : ""}`;
  if (n < 200) return `seratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 2000) return `seribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ""}`;
  if (n < 1_000_000) return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ""}`;
  if (n < 1_000_000_000) return `${terbilang(Math.floor(n / 1_000_000))} juta${n % 1_000_000 ? ` ${terbilang(n % 1_000_000)}` : ""}`;
  return `${terbilang(Math.floor(n / 1_000_000_000))} miliar${n % 1_000_000_000 ? ` ${terbilang(n % 1_000_000_000)}` : ""}`;
}

/**
 * Ganti pola HARGA dalam kalimat dengan bentuk terbilang.
 * - "Rp299.000" / "Rp 299.000"  -> "dua ratus sembilan puluh sembilan ribu rupiah"
 * - "299.000" (format ribuan)    -> "dua ratus sembilan puluh sembilan ribu"
 * - "85rb" / "85 ribu"           -> "delapan puluh lima ribu"
 * - "1,5jt" -> "satu juta lima ratus ribu"
 * Angka polos tanpa penanda harga (kode produk, "7 hari") TIDAK disentuh.
 */
export function hargaTerbilang(text: string): string {
  let out = text;
  // 1) Berprefiks Rp (dengan/atau tanpa pemisah ribuan, opsional akhiran rb/ribu/jt/juta)
  out = out.replace(/Rp\s?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s?(rb|ribu|jt|juta))?/gi, (_m, num: string, suffix?: string) => {
    let value = Number(num.replace(/[.,]/g, ""));
    if (suffix) value *= /jt|juta/i.test(suffix) ? 1_000_000 : 1000;
    return `${terbilang(value)} rupiah`;
  });
  // 2) Format ribuan tanpa Rp: 299.000 (>= 4 digit efektif — bukan kode produk)
  out = out.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (_m, num: string) => terbilang(Number(num.replace(/\./g, ""))));
  // 3) Akhiran rb/ribu/jt/juta tanpa Rp: "85rb", "85 ribu", "2jt"
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\s?(rb|ribu)\b/gi, (_m, num: string) =>
    terbilang(Math.round(Number(num.replace(",", ".")) * 1000)));
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\s?(jt|juta)\b/gi, (_m, num: string) =>
    terbilang(Math.round(Number(num.replace(",", ".")) * 1_000_000)));
  return out;
}
