// Konfigurasi kepatuhan konten (F-07 / BR-07.5) — teks disimpan sebagai konfigurasi
// agar bisa diperbarui saat aturan platform berubah TANPA deploy.

export const AIGC_WATERMARK_TEXT = "Dibuat dengan AI";

// Negative prompt wajib ke semua model video (aturan keras #3):
// AI dilarang menulis teks/logo — semua teks ditambahkan via overlay FFmpeg.
/** Negative prompt wajib untuk setiap panggilan model video.
 *
 *  DIPERBAIKI 2026-08-15, dan ini akar cacat label yang selama ini disalahkan
 *  ke modelnya.
 *
 *  Bunyinya dulu "no text, no logo, no writing". Maksudnya benar: jangan
 *  sampai model MENAMBAHKAN caption, watermark, atau tulisan karangan di atas
 *  gambar. Tapi kalimatnya tidak membedakan tulisan yang DITAMBAHKAN dari
 *  tulisan yang MEMANG TERCETAK DI PRODUKNYA — dan model menurutinya: ia
 *  menekan label produk, dan yang tersisa jadi coretan.
 *
 *  Terbukti dengan render berpasangan pada foto Wardah asli (720p, model dan
 *  prompt sama, HANYA negative-nya berbeda):
 *    dengan "no writing"  -> "NACNADNAAMLNO- HYCOMRLE C3 HONIC"
 *    tanpa "no writing"   -> "NANO-NIACINAMIDE COMPLEX* HYALURONIC
 *                             POLYGLUTAMIC"  (persis aslinya, nol huruf salah)
 *
 *  Selama berbulan-bulan kesimpulannya "model tidak bisa merender teks kecil".
 *  Yang tidak bisa adalah model yang kita larang menulis.
 *
 *  Versi sekarang melarang yang memang harus dilarang — lapisan tambahan di
 *  ATAS gambar — tanpa menyentuh apa yang tercetak pada produknya sendiri. */
export const MANDATORY_NEGATIVE_PROMPT =
  "no added text overlay, no caption bar, no subtitle, no watermark, no invented logo";

export const COMPLIANCE_CHECKLIST: string[] = [
  "Saat upload di TikTok, nyalakan toggle 'Konten yang dibuat AI' (AI-generated content) biar akun kamu aman.",
  // DIPERBAIKI 20 Agu 2026 (board review). Kalimat lama berbunyi "tanda sudah
  // tertanam di dalam video — jangan di-crop atau ditutup stiker", padahal
  // watermark VISUAL dihapus 7 Agu (lihat lib/media/compositor.ts): yang
  // tersisa metadata berkas, dan tidak ada apa pun yang bisa ditutup stiker.
  // Menyuruh pengguna menjaga sesuatu yang tidak ada membuat seluruh daftar
  // ini kehilangan wibawa — dan yang benar-benar melindungi akunnya justru
  // baris pertama.
  "Penanda AI ada di dalam berkas video (metadata), bukan tulisan di gambar — jadi toggle di atas itulah yang dilihat penonton.",
  "Jangan tambahkan klaim berlebihan di caption (mis. 'pasti sembuh', '100% ampuh') — bisa kena teguran TikTok.",
  "Pastikan harga di video sama dengan harga di etalase toko kamu.",
  "Kalau ada perubahan harga/stok, update caption sebelum posting.",
];

export const PRE_DOWNLOAD_NOTICE =
  "Sebelum posting: nyalakan tanda 'konten AI' di TikTok ya, biar akun kamu aman.";
