/**
 * IDENTITAS PLATFORM — satu tempat, dipakai semua layar dan email.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA ADA
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian 4 Sep 2026: mengganti merek bikinfyp.com menjadi aiugc.id,
 * "termasuk mengganti template email dan lain-lain".
 *
 * Sebelum ini nama merek diketik ulang di 62 tempat — judul halaman, footer,
 * subjek email, badan email, teks onboarding. Nama yang disalin 62 kali adalah
 * nama yang tidak akan pernah selesai diganti: satu tertinggal, dan pembeli
 * menerima email dari merek yang sudah tidak ada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NAMA DAN ALAMAT DIPISAH, DAN ITU BUKAN KERAPIAN
 * ────────────────────────────────────────────────────────────────────────────
 * NAMA yang dibaca orang boleh berganti hari ini juga. ALAMAT yang dipakai
 * mesin TIDAK BOLEH, sampai domainnya benar-benar menunjuk server ini.
 *
 * Diperiksa 4 Sep 2026: aiugc.id menunjuk 104.21.0.184 / 172.67.128.48
 * (Cloudflare), sedangkan server kita 187.77.148.89, dan https://aiugc.id belum
 * menjawab sama sekali.
 *
 * Kalau alamat teknis diganti sekarang, yang rusak bukan tampilan:
 *   - kie.ai TIDAK BISA mengunduh gambar acuan (URL provider-image), jadi
 *     SETIAP render Standard gagal;
 *   - callback pembayaran Duitku menunjuk alamat yang mati;
 *   - redirect Google OAuth ditolak;
 *   - URL bertanda tangan untuk video menunjuk host yang salah.
 *
 * Jadi ALAMAT tetap dibaca dari config.appBaseUrl, dan pergantiannya cukup satu
 * baris di env begitu DNS dan sertifikatnya siap.
 */

/** Nama merek sebagaimana dibaca orang. */
export const NAMA_PLATFORM = "AIUGC.ID";

/**
 * Nama panjang untuk judul halaman dan pengirim email.
 *
 * Dipisah dari NAMA_PLATFORM karena keduanya memang beda pemakaian: yang
 * pendek muncul di dalam kalimat, yang panjang berdiri sendiri sebagai judul.
 */
export const NAMA_PLATFORM_PANJANG = "AIUGC.ID";

/**
 * Domain yang DITULIS di teks untuk dibaca orang.
 *
 * BUKAN alamat yang dipakai memanggil apa pun — itu selalu
 * config.appBaseUrl. Lihat catatan di kepala berkas.
 */
export const DOMAIN_TAMPIL = "aiugc.id";
