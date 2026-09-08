/**
 * Penyaring foto produk hasil scraping link marketplace.
 *
 * ---------------------------------------------------------------------------
 * MASALAH (Brian, 8 Sep 2026)
 * ---------------------------------------------------------------------------
 * "gambar yang diambil sebaiknya gambar real object bukan gambar promo yang ada
 *  di toko karena akan mengganggu kualitas foto yang di generate"
 *
 * Ia benar, dan akibatnya terukur: foto acuan adalah otoritas bentuk, warna,
 * dan proporsi produk bagi mesin gambar. Kalau yang jadi acuan adalah banner
 * "DISKON 50% GRATIS ONGKIR", mesin menggambar bannernya — tulisan promo ikut
 * tersalin ke video, dan tulisan buatan model selalu jadi huruf acak.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MENGURUTKAN, BUKAN MEMBUANG
 * ---------------------------------------------------------------------------
 * Membuang berisiko menyisakan NOL foto — dan produk tanpa foto tidak bisa
 * dibuatkan video sama sekali. Banyak toko kecil memang hanya punya banner.
 *
 * Jadi kandidatnya DIURUTKAN: foto yang paling mirip objek nyata naik ke atas,
 * banner turun ke bawah. Yang terpakai sebagai acuan utama adalah yang pertama,
 * dan sisanya tetap ikut sebagai referensi tambahan. Kalau semuanya banner,
 * pengguna tetap dapat sesuatu — hanya urutannya yang berubah.
 */

/** Ambang yang sudah dipakai jalur render (lib/media/foto-produk.ts). Diketik
 *  ulang di sini SEBAGAI ANGKA, bukan diimpor: modul itu menarik tesseract dan
 *  sharp saat diimpor, dan modul ini dipakai di jalur permintaan web. */
export const MIN_SISI_PX = 400;

/**
 * Rasio di atas ini dianggap bentuk BANNER.
 *
 * Foto produk marketplace nyaris selalu bujur sangkar (Shopee dan Tokopedia
 * memaksa 1:1 pada foto utama). Banner promo dibuat melebar supaya muat
 * headline. 1,6 dipilih supaya foto lanskap wajar (4:3 = 1,33) tetap lolos,
 * sementara spanduk (2:1 ke atas) tidak.
 */
export const RASIO_BANNER = 1.6;

export interface KandidatFoto {
  /** Urutan asal: og:image lebih dulu, lalu JSON-LD, lalu pindaian inline. */
  urutan: number;
  lebar: number;
  tinggi: number;
  /** Jumlah kata yang terbaca OCR. -1 = OCR tidak dijalankan/gagal. */
  kata: number;
}

/**
 * Skor rendah = lebih layak jadi acuan.
 *
 * Bukan boolean karena keputusannya bukan "layak/tidak" melainkan "mana yang
 * PALING layak dari yang ada" — lihat catatan mengurutkan vs membuang.
 */
export function skorFoto(f: KandidatFoto): number {
  let skor = 0;

  // Tulisan adalah sinyal terkuat, jadi bobotnya paling besar. OCR yang gagal
  // (-1) TIDAK dihukum: menghukum ketidaktahuan akan menenggelamkan foto bagus
  // hanya karena tesseract kebetulan tersedak.
  if (f.kata > 0) skor += f.kata * 10;

  // Bentuk banner.
  const rasio = f.tinggi > 0 ? f.lebar / f.tinggi : 1;
  if (rasio >= RASIO_BANNER) skor += 40;

  // Terlalu kecil untuk jadi acuan yang berguna.
  if (Math.min(f.lebar, f.tinggi) < MIN_SISI_PX) skor += 25;

  // Urutan asal jadi pemecah seri, bukan penentu: og:image biasanya foto utama,
  // tapi di sebagian toko justru banner promo yang dipasang di og:image.
  // Bobotnya sengaja kecil supaya kalah oleh bukti tulisan dan bentuk.
  skor += f.urutan;

  return skor;
}

/** Urutkan kandidat: paling layak lebih dulu. Stabil terhadap seri lewat
 *  `urutan`, jadi hasilnya bisa diulang dan diuji. */
export function urutkanFoto<T extends KandidatFoto>(daftar: T[]): T[] {
  return [...daftar].sort((a, b) => skorFoto(a) - skorFoto(b) || a.urutan - b.urutan);
}
