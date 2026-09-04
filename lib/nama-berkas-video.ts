/**
 * Nama berkas untuk video yang diunduh.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA ADA
 * ────────────────────────────────────────────────────────────────────────────
 * Catatan Brian 4 Sep 2026: "nama generated video anda selalu racun-video.mp4,
 * sesuaikan dengan nama product yang digenerate supaya unik."
 *
 * Nama itu dipaku di dua halaman, dan akibatnya nyata: kreator yang membuat
 * sepuluh video menemukan sepuluh berkas bernama sama di folder unduhan —
 * "racun-video (3).mp4" — dan harus membuka satu per satu untuk tahu mana yang
 * mana. Nama juga masih menyebut "racun", nama lama proyek ini.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA NAMA PRODUK **DAN** POTONGAN ID
 * ────────────────────────────────────────────────────────────────────────────
 * Nama produk saja tidak cukup unik: satu produk lazim dibuatkan beberapa
 * video, dan namanya akan bentrok lagi. Potongan id job menjaminnya berbeda
 * tanpa membuat namanya panjang.
 *
 * Judul marketplace bisa 24 kata penuh kata kunci, jadi dipotong pendek —
 * nama berkas 200 karakter tidak menolong siapa pun.
 */

/** Panjang maksimal bagian nama produk. Cukup untuk dikenali, tidak melelahkan. */
const MAKS_NAMA = 40;

export function namaBerkasVideo(namaProduk: string | null | undefined, jobId: string): string {
  const bersih = (namaProduk ?? "")
    .normalize("NFKD")
    // Tanda baca jadi pemisah, bukan dibuang: "K1812-C" tetap terbaca sebagai
    // dua bagian, sementara membuangnya menempelkannya jadi "K1812C".
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .slice(0, MAKS_NAMA)
    .replace(/-+$/, "")
    .toLowerCase();
  const potonganId = jobId.replace(/[^\w]/g, "").slice(0, 8) || "video";
  return `${bersih || "video"}-${potonganId}.mp4`;
}
