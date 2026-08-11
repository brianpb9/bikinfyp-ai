// Penebak kategori dari nama produk.
//
// DIPISAH DARI lib/extract.ts supaya bisa dipakai komponen klien: extract.ts
// mengimpor getDb (better-sqlite3), yang tidak bisa masuk bundel browser.
// extract.ts sekarang me-reexport dari sini, jadi jalur ekstraksi URL memakai
// tabel kata kunci yang SAMA — kalau kamusnya diperbaiki, keduanya ikut, dan
// tidak ada dua kamus yang diam-diam berbeda.

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/serum|skincare|glow|moistur|sunscreen|toner|cream|facial/i, "beauty"],
  [/hijab|mukena|khimar|gamis|jilbab/i, "muslim_fashion"],
  [/baju|kaos|dress|celana|kemeja|jaket|skirt/i, "fashion"],
  [/dapur|panci|wajan|spatula|rice cooker|blender/i, "kitchen"],
  [/rumah|organizer|rak|lemari|lampu|gorden/i, "home"],
  [/hp|gadget|charger|earphone|headset|casing|powerbank|kabel/i, "gadget"],
  [/snack|makanan|cemilan|kopi|teh|susu|madu|sambal/i, "food"],
  [/bayi|anak|popok|diaper|mainan/i, "kids"],
];

/** "default" berarti TIDAK KETEMU — pemanggil harus memperlakukannya sebagai
 *  "jangan ubah apa pun", bukan sebagai kategori pilihan. */
export function guessCategory(text: string): string {
  for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return "default";
}
