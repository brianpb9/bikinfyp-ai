// APA PRODUKNYA SEBENARNYA — blok prompt bersama untuk tahap ide dan penulis.
//
// ────────────────────────────────────────────────────────────────────────────
// KEGAGALAN YANG MELAHIRKAN FILE INI (dilaporkan Brian, 9 Sep 2026)
// ────────────────────────────────────────────────────────────────────────────
// Produk yang dimasukkan adalah pembersih dan pengkilap KENDARAAN. Naskah yang
// keluar bercerita tentang CAT RAMBUT.
//
// Sebabnya bukan model yang berhalusinasi. Sampai hari ini kedua tahap penulis
// hanya diberi satu baris:
//
//     PRODUCT: <nama> (<kategori>), price <harga> rupiah.
//
// Itu SELURUH pengetahuannya tentang produk. Kalau namanya tidak menjelaskan
// dirinya sendiri, satu-satunya petunjuk yang tersisa adalah label kategori —
// dan kategori itu ditebak oleh pencocok substring yang membaca "CREAM Polish
// Body Mobil" sebagai beauty. Dari sana konteksnya diisi "meja skincare /
// skincare-an malem / tim glowing", dan penulis menulis persis apa yang
// diberitahukan kepadanya.
//
// Padahal deskripsi wujud produk SUDAH ADA di basis data (product_visual_desc,
// hasil Gemini vision atas fotonya) dan SUDAH dipakai — tapi hanya oleh
// shot-planner. Jadi model video menggambar botol pengkilap yang benar
// sementara suaranya bicara soal rambut. Datanya tidak hilang; ia cuma tidak
// pernah diberikan kepada pihak yang paling membutuhkannya.
//
// ────────────────────────────────────────────────────────────────────────────
// KENAPA DESKRIPSI MENGALAHKAN KATEGORI
// ────────────────────────────────────────────────────────────────────────────
// Kategori adalah TEBAKAN dari sebuah tabel; deskripsi ini dibaca dari FOTO
// produk yang diunggah penjual. Kalau keduanya bertentangan, yang melihat
// barangnya lebih layak dipercaya daripada yang mencocokkan kata. Urutan itu
// dinyatakan eksplisit ke model, karena kalau tidak, dua sinyal yang saling
// bertentangan akan diselesaikan sesuka model.

/** Batas aman: cukup untuk satu kalimat wujud, tidak cukup untuk menenggelamkan
 *  sisa prompt. Deskripsi vision kita rata-rata jauh di bawah ini. */
const MAKS_DESK = 400;
const MAKS_BRIEF = 400;

/**
 * Blok "produk ini sebenarnya apa", atau string kosong kalau tidak ada yang
 * bisa dikatakan.
 *
 * Sengaja mengembalikan "" alih-alih kalimat penuh harapan saat deskripsinya
 * kosong: produk lama tidak punya kolom ini, dan menyuntikkan "The product is
 * (unknown)" justru menambah keraguan yang tidak perlu ke prompt.
 */
export function blokProdukNyata(p: {
  productVisualDesc?: string | null;
  brandBrief?: string | null;
}): string {
  const desk = p.productVisualDesc?.trim().slice(0, MAKS_DESK);
  const brief = p.brandBrief?.trim().slice(0, MAKS_BRIEF);
  if (!desk && !brief) return "";

  const baris: string[] = ["", "WHAT THE PRODUCT ACTUALLY IS — read this before anything else:"];
  if (desk) {
    baris.push(
      `  This product is: ${desk}`,
      "  This description was read from the seller's own product photo. The category label",
      "  above is only a keyword guess. WHERE THEY DISAGREE, THIS DESCRIPTION WINS.",
      "  Every line you write must be true of THIS object. Do not write about a product",
      "  from a different category, and do not invent a use it plainly does not have.",
    );
  }
  if (brief) baris.push(`  Brand direction (obey it): ${brief}`);
  return baris.join("\n");
}
