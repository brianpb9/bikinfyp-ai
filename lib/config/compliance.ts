// Konfigurasi kepatuhan konten (F-07 / BR-07.5) — teks disimpan sebagai konfigurasi
// agar bisa diperbarui saat aturan platform berubah TANPA deploy.

export const AIGC_WATERMARK_TEXT = "Dibuat dengan AI";

// Negative prompt wajib ke semua model video (aturan keras #3):
// AI dilarang menulis teks/logo — semua teks ditambahkan via overlay FFmpeg.
export const MANDATORY_NEGATIVE_PROMPT = "no text, no logo, no writing";

export const COMPLIANCE_CHECKLIST: string[] = [
  "Saat upload di TikTok, nyalakan toggle 'Konten yang dibuat AI' (AI-generated content) biar akun kamu aman.",
  "Tanda 'Dibuat dengan AI' sudah tertanam di dalam video — jangan di-crop atau ditutup stiker.",
  "Jangan tambahkan klaim berlebihan di caption (mis. 'pasti sembuh', '100% ampuh') — bisa kena teguran TikTok.",
  "Pastikan harga di video sama dengan harga di etalase toko kamu.",
  "Kalau ada perubahan harga/stok, update caption sebelum posting.",
];

export const PRE_DOWNLOAD_NOTICE =
  "Sebelum posting: nyalakan tanda 'konten AI' di TikTok ya, biar akun kamu aman.";
