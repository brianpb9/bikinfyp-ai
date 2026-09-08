/**
 * Naikkan resolusi URL gambar marketplace sebelum diunduh.
 *
 * ---------------------------------------------------------------------------
 * KENAPA
 * ---------------------------------------------------------------------------
 * Link berbagi TikTok Shop membawa foto produk di parameter `og_info`, dan
 * foto itu adalah THUMBNAIL: URL-nya memuat direktif ukuran
 *
 *     ~tplv-<kunci>-resize-webp:260:260.webp
 *
 * 260x260 ada DI BAWAH AMBANG_TOLAK_PX (400) yang dipakai periksaFotoProduk —
 * jadi satu-satunya foto yang bisa kita dapat dari TikTok Shop justru terlalu
 * kecil untuk jadi acuan render yang layak. Dan acuan render adalah otoritas
 * bentuk, warna, dan proporsi produk bagi mesin gambar; acuan 260px membuat
 * mesin mengarang detail yang tidak terlihat.
 *
 * Diukur 8 Sep 2026 pada link nyata (kursi SIHOO):
 *     :260:260   -> 260x260,   6 KB
 *     :1080:1080 -> 800x800,  47 KB
 *     :1600:1600 -> 800x800,  47 KB   (CDN berhenti di ukuran sumber)
 *
 * Tiga kali lipat sisi, delapan kali lipat piksel, dari satu penggantian teks.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MEMINTA 1080, BUKAN ANGKA TERBESAR YANG BISA
 * ---------------------------------------------------------------------------
 * CDN-nya berhenti di ukuran sumber, jadi meminta 4000 tidak memberi apa-apa
 * selain angka yang menyesatkan pembaca kode berikutnya. 1080 dipilih karena ia
 * sisi terpanjang kanvas render kita (720x1280) — meminta lebih berarti mengunduh
 * piksel yang pasti dibuang.
 */

/** Sisi yang diminta. Lihat catatan di atas soal kenapa bukan angka terbesar. */
export const SISI_DIMINTA = 1080;

/**
 * Kembalikan URL varian resolusi lebih tinggi, atau URL asli bila polanya tidak
 * dikenali.
 *
 * TIDAK PERNAH melempar dan tidak pernah mengembalikan kosong: pemanggilnya ada
 * di jalur unduhan foto, dan URL yang tidak dikenali harus tetap dicoba apa
 * adanya — kehilangan satu foto lebih buruk daripada mengunduhnya kecil.
 */
export function urlResolusiTinggi(url: string): string {
  // Bytedance/TikTok Shop: ~tplv-<kunci>-resize-webp:260:260.webp
  //
  // Hanya angka DI DALAM direktif tplv yang disentuh. Mengganti pola ":\d+:\d+"
  // di mana pun akan merusak URL yang kebetulan memuat rasio atau cap waktu di
  // query string.
  const tplv = /(~tplv-[^/?#]*?):(\d{2,4}):(\d{2,4})/.exec(url);
  if (tplv) {
    const [cocok, awalan, w, h] = tplv as unknown as [string, string, string, string];
    // Sudah lebih besar dari yang kita minta? Biarkan — menurunkannya konyol.
    if (Number(w) >= SISI_DIMINTA && Number(h) >= SISI_DIMINTA) return url;
    return url.replace(cocok, `${awalan}:${SISI_DIMINTA}:${SISI_DIMINTA}`);
  }
  return url;
}
