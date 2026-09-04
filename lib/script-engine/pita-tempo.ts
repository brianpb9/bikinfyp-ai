/**
 * PITA TEMPO — berapa kata yang PANTAS untuk sebuah durasi, per genre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA ATURAN LAMA (1,5 kata/detik untuk semua) DIGANTI
 * ────────────────────────────────────────────────────────────────────────────
 * Aturan lama: total dialog ≤1,5 kata/detik — 15 detik ≤22 kata. Satu angka
 * untuk semua genre, semua durasi. Ia ditegakkan di tiga tempat sekaligus:
 * jendelaKata(), standard-10.md, dan MASTER-UGC-*.md, dan ketiganya
 * disuntikkan ke prompt penulis.
 *
 * DIUKUR 4 Sep 2026, tiga render Grok 15 detik dengan adegan identik, hanya
 * dialog dan arahan bicara yang berbeda. Sunyi diukur dengan
 * `silencedetect=noise=-30dB:d=0.25`:
 *
 *   A  17 kata (1,13 k/dtk) + "unhurried pace with natural pauses"
 *      -> 8,48 dtk sunyi dari 15,04  = 56% VIDEONYA DIAM
 *   B  49 kata (3,27 k/dtk) + arahan yang sama
 *      -> 2,85 dtk sunyi             = 19%
 *   C  49 kata (3,27 k/dtk) + arahan aktif tanpa kata pembeku
 *      -> 0,40 dtk sunyi             =  3%
 *
 * Jadi batas 22 kata bukan menjaga mutu; ia MEMPRODUKSI video yang diam lebih
 * dari separuh durasinya. Mekanismenya deterministik, bukan untung-untungan:
 * model memuat naskah ke dalam durasi, jadi kata yang terlalu sedikit
 * meninggalkan ruang kosong yang tidak diisi apa pun.
 *
 * Itu sebabnya satu sampel per varian cukup di sini — yang diukur akibat
 * langsung dari jumlah kata, bukan lemparan dadu model. (Untuk ukuran yang
 * memang berisik seperti QC-03, satu sampel TIDAK cukup; lihat
 * uji-keandalan-grok.ts yang memakai enam.)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SUMBER ANGKA
 * ────────────────────────────────────────────────────────────────────────────
 * Tabel di bawah disalin dari LAYER2-AIUGC-ID.md §5.1 (v2.1, 4 Sep 2026),
 * yang menyusunnya dari ±60 render dan dua kali koreksi telinga founder.
 *
 * Yang TIDAK disalin: pemetaan genre di bawahnya. Dokumen itu ditulis untuk
 * pipeline lain (Grok langsung, seed Gemini); pemetaan ke contentType/format
 * milik kita adalah keputusan kita sendiri, dan dasarnya render di atas —
 * bukan asumsi.
 */

/** Genre tempo, sebagaimana LAYER2 §5.1 membaginya. */
export type GenreTempo = "haul" | "cerita" | "affiliate" | "ads_tenang";

/** Batas kata per detik [min, maks], per genre, per pita durasi. */
const PITA: Record<GenreTempo, { sampai7: [number, number]; sampai20: [number, number]; lebih: [number, number] }> = {
  // BATAS BAWAH haul 8-20 dtk adalah 2,2 — ANGKA KAMI, bukan 3,1 milik dokumen.
  //
  // Diukur 4 Sep 2026, render keempat: 34 kata (2,27 k/dtk) dengan arahan aktif
  // menyisakan 2,64 dtk sunyi dari 15,04 — 18%, setara 49 kata dengan arahan
  // lama (19%). Jadi 3,1 akan menolak naskah yang hasilnya terukur sehat.
  //
  // Batas bawah yang terlalu tinggi bukan kesalahan tak berbiaya: penulis
  // ditolak berulang kali lalu menyerah, dan hari ini kami sudah membayar
  // persis kegagalan itu dari arah sebaliknya. Batas atas tetap milik dokumen
  // (4,2) — di sanalah 3% sunyi terukur, dan tidak ada alasan menguranginya.
  haul: { sampai7: [4.4, 5.5], sampai20: [2.2, 4.2], lebih: [2.2, 4.0] },
  cerita: { sampai7: [3.0, 4.2], sampai20: [1.7, 2.9], lebih: [1.5, 2.7] },
  affiliate: { sampai7: [2.0, 3.2], sampai20: [0.7, 1.9], lebih: [0.7, 1.9] },
  ads_tenang: { sampai7: [0.3, 1.6], sampai20: [0.3, 1.5], lebih: [0.3, 1.5] },
};

/**
 * Genre tempo dari jenis konten dan format kita.
 *
 * KEPUTUSAN YANG PERLU DIJELASKAN: konten afiliasi kita dipetakan ke **haul**,
 * bukan ke pita "affiliate".
 *
 * Pita "affiliate" dokumen (0,7-1,9 k/dtk) untuk 15 detik berarti 11-29 kata —
 * praktis sama dengan batas lama kita, dan render A membuktikan jumlah segitu
 * meninggalkan 56% video dalam keadaan diam. Memindahkan aturan tanpa
 * memperbaiki cacatnya bukan perbaikan.
 *
 * Yang kita produksi memang berbentuk haul: hook di depan, produk dibuka dan
 * ditunjukkan, satu belokan kecil, penutup mengajak. Varian C — yang duduk di
 * pita haul dengan arahan aktif — yang menghasilkan 3% sunyi, dan itu satu-
 * satunya konfigurasi yang benar-benar kami ukur bersih.
 *
 * Ads dan TVC TETAP di pita tenang: di sana ruang sunyi memang bagian dari
 * bentuknya (beat visual, tekanan yang naik), bukan kelalaian.
 */
export function genreTempo(input: { contentType?: string | null; format?: string | null }): GenreTempo {
  if (input.format === "tvc") return "ads_tenang";
  if (input.contentType === "ads") return "ads_tenang";
  return "haul";
}

/** Batas kata/detik untuk durasi & genre tertentu. */
export function batasKataPerDetik(durasiDetik: number, genre: GenreTempo): [number, number] {
  const p = PITA[genre];
  if (durasiDetik <= 7) return p.sampai7;
  if (durasiDetik <= 20) return p.sampai20;
  return p.lebih;
}

/**
 * Jendela kata TOTAL untuk satu naskah.
 *
 * Dibulatkan ke dalam (min ke atas, maks ke bawah) supaya jendelanya tidak
 * pernah lebih longgar daripada pitanya. Jendela yang melar karena pembulatan
 * adalah cara aturan menghilang pelan-pelan.
 */
export function jendelaDariPita(durasiDetik: number, genre: GenreTempo): { minWc: number; maxWc: number } {
  const [min, maks] = batasKataPerDetik(durasiDetik, genre);
  return { minWc: Math.ceil(min * durasiDetik), maxWc: Math.floor(maks * durasiDetik) };
}
