// Penebak kategori dari nama produk.
//
// DIPISAH DARI lib/extract.ts supaya bisa dipakai komponen klien: extract.ts
// mengimpor getDb (better-sqlite3), yang tidak bisa masuk bundel browser.
// extract.ts sekarang me-reexport dari sini, jadi jalur ekstraksi URL memakai
// tabel kata kunci yang SAMA — kalau kamusnya diperbaiki, keduanya ikut, dan
// tidak ada dua kamus yang diam-diam berbeda.
//
// ────────────────────────────────────────────────────────────────────────────
// BATAS KATA — kenapa setiap pola sekarang memakai \b (2026-09-09)
// ────────────────────────────────────────────────────────────────────────────
// Tabel lama mencocokkan SUBSTRING. Bahasa Indonesia penuh imbuhan, jadi itu
// bukan cacat teoretis — ia salah menebak pada nama produk sungguhan:
//
//   "Cairan Penghilang KeRAK Jamur Kaca Mobil"  -> home    (dari "rak")
//   "CREAM Polish Body Mobil"                   -> beauty  (dari "cream")
//   "Obat Poles LAMPU Mobil Kusam"              -> home    (dari "lampu")
//
// Ketiganya produk otomotif. Salah tebak di sini tidak berhenti sebagai label
// yang keliru: kategori memilih ruang, aktivitas, identitas, dan prioritas
// hook yang disuntikkan ke prompt penulis — jadi produk pengkilap kendaraan
// diberi konteks "meja skincare / skincare-an malem / tim glowing", dan
// naskahnya hanyut ke produk kecantikan. Brian melaporkannya 9 Sep 2026:
// pembersih kendaraan menghasilkan naskah tentang cat rambut.
//
// OTOMOTIF ADALAH KATEGORI BARU. Sebelumnya tidak ada sama sekali, jadi
// SELURUH produk kendaraan yang tidak salah-tebak jatuh ke "default" —
// dan "default" berarti konteks paling hambar yang kita punya.
//
// URUTAN PENTING: yang lebih khusus didahulukan. "pembersih kaca mobil" harus
// jadi otomotif, bukan home — maka otomotif diperiksa sebelum home.
//
// HOME SEBELUM FASHION, karena nama majemuk dinamai dari WADAHNYA: "rak
// sepatu" dan "lemari baju" adalah perabot rumah, bukan pakaian. Sepatu polos
// tanpa kata rumah tetap jatuh ke fashion.

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  // Otomotif lebih dulu: kata kendaraannya khas, dan produk perawatannya
  // memakai kosakata yang bertabrakan dengan home ("pembersih", "lap") dan
  // beauty ("cream", "shampoo", "poles").
  [/\b(mobil|motor|kendaraan|otomotif|automotive|velg|ban|knalpot|helm|wiper|aki|busi|karburator|spion|dashboard)\b/i, "otomotif"],
  [/\b(serum|skincare|glow|moisturizer|moisturiser|sunscreen|toner|cream|facial|masker wajah|micellar|retinol|niacinamide)\b/i, "beauty"],
  [/\b(hijab|mukena|khimar|gamis|jilbab|sajadah|peci)\b/i, "muslim_fashion"],
  [/\b(dapur|panci|wajan|spatula|rice cooker|blender|teflon|talenan|pisau dapur)\b/i, "kitchen"],
  [/\b(rumah|organizer|rak|lemari|lampu|gorden|sapu|pel|keset|bantal|sprei)\b/i, "home"],
  [/\b(baju|kaos|dress|celana|kemeja|jaket|skirt|rok|hoodie|sepatu|sandal|tas)\b/i, "fashion"],
  [/\b(hp|gadget|charger|earphone|headset|casing|powerbank|kabel|mouse|keyboard|laptop)\b/i, "gadget"],
  [/\b(snack|makanan|cemilan|kopi|teh|susu|madu|sambal|keripik|biskuit)\b/i, "food"],
  [/\b(bayi|anak|popok|diaper|mainan|stroller|bedong)\b/i, "kids"],
];

/** "default" berarti TIDAK KETEMU — pemanggil harus memperlakukannya sebagai
 *  "jangan ubah apa pun", bukan sebagai kategori pilihan. */
export function guessCategory(text: string): string {
  for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return "default";
}
