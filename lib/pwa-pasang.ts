/**
 * Aturan kapan ajakan "pasang aplikasi" boleh muncul.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA ATURANNYA, BUKAN LANGSUNG TAMPIL
 * ---------------------------------------------------------------------------
 * Ajakan memasang aplikasi adalah interupsi. Ia muncul di atas pekerjaan orang,
 * dan kalau salah waktu ia jadi persis jenis gangguan yang membuat orang
 * menutup tab. Yang paling buruk: muncul di tengah alur bikin video, saat orang
 * sedang menunggu sesuatu yang ia bayar.
 *
 * Dipisah dari komponennya supaya keputusannya bisa diuji tanpa DOM — ini
 * aturan produk, bukan detail tampilan.
 */

/** Berapa lama ajakan didiamkan setelah ditutup. 30 hari: cukup lama untuk
 *  tidak terasa mengejar, cukup pendek untuk menangkap orang yang berubah
 *  pikiran setelah videonya jadi. */
export const DIAM_HARI = 30;

export const KUNCI_TUNDA = "aiugc.pasang.tunda";

/**
 * Halaman yang TIDAK boleh menampilkan ajakan.
 *
 * /bikin/** adalah alur berbayar: orang di sana sedang mengisi form, meninjau
 * storyboard, atau menunggu render. Menaruh banner di atas itu berarti menutupi
 * pekerjaan yang sedang ia bayar.
 *
 * /onboarding juga dikecualikan — pengunjung pertama belum tahu ini apa, dan
 * mengajaknya memasang sebelum ia melihat satu video pun adalah urutan yang
 * terbalik.
 */
const JALUR_TERLARANG = ["/bikin", "/onboarding", "/admin", "/dashboard"];

export interface KeadaanPasang {
  pathname: string;
  /** Sudah berjalan sebagai aplikasi terpasang? */
  sudahTerpasang: boolean;
  /** Browser sudah memberi kita event pemasangan? (Chrome/Edge/Android) */
  adaPrompt: boolean;
  /** Safari iOS: tidak punya event, tapi BISA dipasang manual. */
  iosSafari: boolean;
  /** Nilai localStorage penundaan (ms epoch), atau null. */
  tundaSampai: number | null;
  sekarang: number;
}

export function bolehTampil(k: KeadaanPasang): boolean {
  // Sudah terpasang: mengajak memasang lagi membuat kita terlihat tidak tahu
  // keadaan pengguna sendiri.
  if (k.sudahTerpasang) return false;
  if (JALUR_TERLARANG.some((p) => k.pathname.startsWith(p))) return false;
  if (k.tundaSampai !== null && k.sekarang < k.tundaSampai) return false;
  // Tidak ada cara memasang sama sekali (mis. Firefox desktop) -> jangan
  // menawarkan sesuatu yang tidak bisa dikerjakan.
  return k.adaPrompt || k.iosSafari;
}

export function waktuTunda(sekarang: number, hari = DIAM_HARI): number {
  return sekarang + hari * 24 * 60 * 60 * 1000;
}

/** Deteksi Safari di iOS/iPadOS. Chrome di iOS memakai WebKit yang sama tapi
 *  TIDAK punya menu "Add to Home Screen" — jadi Chrome iOS sengaja tidak
 *  dihitung; menyuruhnya membuka menu bagikan hanya membuat orang bingung. */
export function deteksiIosSafari(ua: string, vendor: string): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Version\//.test(ua) && /Mobile/.test(ua));
  if (!ios) return false;
  // CriOS = Chrome iOS, FxiOS = Firefox iOS, EdgiOS = Edge iOS.
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  return /Apple/.test(vendor);
}
