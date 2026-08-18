/**
 * PENGETAHUAN MEREK — satu modul, dua pemakai.
 *
 * Canary 19 Agu menemukan dua fungsi pemilih merek yang menyimpang:
 * qc.brandTokens (dengan daftar kata generik lengkap) dan validator.tokenMerek
 * (dengan daftar pendeknya sendiri). Hasilnya nyata: T-01 menuntut penutup TVC
 * menyebut "kopi" — kata generik — untuk produk "KOPI TANG", dan penulis LLM
 * disuruh mengejar merek yang salah. Dua salinan pengetahuan yang sama akan
 * menyimpang; ini salinan satu-satunya.
 */

/** Kata produk generik — tidak pernah identitas merek. */
export const GENERIC_PRODUCT_WORDS = new Set([
  "gamis", "dress", "baju", "kaos", "kemeja", "jaket", "sweater", "hoodie", "celana", "rok",
  "hijab", "kerudung", "jilbab", "scarf", "jubah", "sepatu", "sandal", "tas", "tote", "pouch",
  "serum", "sabun", "soap", "cream", "krim", "ampoule", "essence", "toner", "sunscreen", "cleanser", "lotion",
  "snack", "keripik", "kripik", "tempura", "seaweed", "cemilan", "kopi", "teh", "susu",
  "earphone", "headset", "gaming", "chair", "kursi", "mouse", "mousepad", "deskmat", "tumbler", "botol",
  "original", "flavor", "premium", "murah", "viral", "terlaris", "wanita", "pria", "anak", "basic", "polos",
]);

/** Kata depan/ekor yang bukan merek walau berdiri di depan nama. */
export const KATA_DEPAN_MEREK = new Set([
  "the", "pt", "cv", "by", "dan", "and", "official", "store", "new", "premium",
  "original", "asli", "paket", "isi",
]);

/**
 * Token merek dari nama produk, URUTAN NAMA DIPERTAHANKAN.
 *
 * Nama produk Indonesia menaruh mereknya di depan; kandungan dan deskriptor
 * menyusul. Token pertama yang bukan kata umum adalah tebakan terbaik —
 * BUKAN token terpanjang (heuristik itu memilih "niacinamide" untuk
 * SOMETHINC, dan sudah dua kali ditolak).
 */
export function pilihTokenMerek(productName: string): string[] {
  return (productName.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 4 && /[a-z]/.test(t))
    .filter((t) => !GENERIC_PRODUCT_WORDS.has(t) && !KATA_DEPAN_MEREK.has(t))
    .slice(0, 3);
}
