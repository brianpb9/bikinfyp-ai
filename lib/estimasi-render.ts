/**
 * PROGRES & PERKIRAAN WAKTU RENDER — dari waktu yang benar-benar terukur.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MASALAH YANG DIPECAHKAN
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian 4 Sep 2026: "tambahkan feature progress bar sehingga
 * keliatan progressnya ketika proses generating dan buatkan estimasi waktunya
 * sehingga tidak jelek dari sisi ux".
 *
 * Bar yang ada sebelumnya adalah `w-1/2 animate-pulse`: setengah penuh,
 * berkedip, dan TIDAK PERNAH BERGERAK. Ia terlihat seperti progres tanpa
 * pernah menjadi progres — dan pada render Ultra yang memakan 16 menit, bar
 * yang diam di tengah selama seperempat jam lebih buruk daripada tidak ada bar
 * sama sekali, karena ia menyiratkan sesuatu macet.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ANGKANYA DIUKUR, DAN SAMPELNYA DITULIS APA ADANYA
 * ────────────────────────────────────────────────────────────────────────────
 * Median durasi job READY di produksi, 4 Sep 2026 (created_at -> completed_at):
 *
 *   premium         352 dtk   (n=2)
 *   ultra           962 dtk   (n=1)
 *   super_hq        365 dtk   (n=1)
 *   silent_caption  234 dtk   (n=1)
 *
 * Sampelnya KECIL, dan itu ditulis di sini supaya pembaca berikutnya tahu
 * seberapa jauh angka ini boleh dipercaya. Yang TIDAK dilakukan: mengarang
 * angka yang terlihat meyakinkan. Perkiraan yang meleset masih jauh lebih baik
 * daripada bar diam, asal ia bergerak dan jujur saat kelewat waktu.
 *
 * `standard` belum punya job READY sama sekali di produksi. Angkanya
 * diturunkan dari render uji langsung: klip Grok 15 detik selesai 37-102 dtk,
 * ditambah compositing dan QC yang terukur di tier lain. Ditandai sebagai
 * turunan, bukan pengukuran job utuh.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TIGA ATURAN YANG MEMBUAT BAR INI TIDAK BERBOHONG
 * ────────────────────────────────────────────────────────────────────────────
 * 1. TIDAK PERNAH MUNDUR. Progres yang turun membuat orang mengira ada yang
 *    gagal dan mengulang.
 * 2. TIDAK PERNAH 100% SEBELUM SELESAI. Bar penuh yang masih berputar adalah
 *    cara tercepat kehilangan kepercayaan pada bar berikutnya.
 * 3. KELEWAT WAKTU DIKATAKAN, bukan disembunyikan. Saat melewati perkiraan,
 *    hitungan mundur berhenti dan kalimatnya berubah — bukan membeku di
 *    "1 menit lagi" selama sepuluh menit.
 */

/** Tahap yang dilalui job, berikut bobotnya terhadap keseluruhan. */
export const TAHAP_RENDER = [
  { state: "QUEUED", label: "Antre di studio", bobot: 0.04 },
  { state: "GENERATING_VISUAL", label: "Kreator AI syuting produkmu", bobot: 0.7 },
  { state: "GENERATING_VOICE", label: "Mengisi suara", bobot: 0.02 },
  { state: "COMPOSITING", label: "Editing: caption, harga & musik", bobot: 0.1 },
  { state: "QC_CHECK", label: "Quality check tiap frame", bobot: 0.12 },
  { state: "LABELING", label: "Memasang label konten AI", bobot: 0.02 },
] as const;

/**
 * Perkiraan total detik per paket.
 *
 * Dipakai untuk hitungan mundur DAN untuk kecepatan bar di dalam satu tahap.
 * Tier lama ikut didaftar karena riwayat masih memuatnya.
 */
export const PERKIRAAN_DETIK: Record<string, number> = {
  standard: 180,        // turunan render uji (klip 37-102 dtk + compositing + QC)
  premium: 352,         // terukur, n=2
  ultra: 962,           // terukur, n=1
  high_quality: 360,    // tier lama; median produksi tercemar job macet, dipakai angka premium
  super_hq: 365,        // terukur, n=1
  silent_caption: 234,  // terukur, n=1
};

export const PERKIRAAN_BAWAAN = 360;

export function perkiraanDetik(tier?: string | null): number {
  return PERKIRAAN_DETIK[tier ?? ""] ?? PERKIRAAN_BAWAAN;
}

/** Bobot kumulatif SEBELUM sebuah tahap dimulai. */
function bobotSebelum(state: string): number {
  let total = 0;
  for (const t of TAHAP_RENDER) {
    if (t.state === state) return total;
    total += t.bobot;
  }
  return total;
}

function bobotTahap(state: string): number {
  return TAHAP_RENDER.find((t) => t.state === state)?.bobot ?? 0;
}

export interface Progres {
  /** 0..1 — tidak pernah mundur, tidak pernah 1 sebelum READY. */
  rasio: number;
  /** Detik tersisa menurut perkiraan; null kalau sudah kelewat. */
  sisaDetik: number | null;
  /** True kalau sudah melewati perkiraan. */
  kelewat: boolean;
  label: string;
}

/**
 * Hitung progres.
 *
 * Dua sumbu digabung dengan sengaja:
 * - TAHAP memberi lantai yang benar (QC_CHECK tidak mungkin 20%),
 * - WAKTU membuatnya bergerak halus di dalam tahap yang panjang.
 *
 * Tanpa waktu, bar melompat lalu diam bermenit-menit di GENERATING_VISUAL —
 * tahap yang memakan 70% durasi. Tanpa tahap, bar hanyut lepas dari kenyataan
 * saat render lebih cepat atau lebih lambat dari perkiraan.
 */
export function hitungProgres(input: {
  state: string;
  /** Detik sejak job dibuat. */
  berjalanDetik: number;
  tier?: string | null;
  /** Progres terakhir yang sudah ditampilkan — supaya tidak pernah mundur. */
  sebelumnya?: number;
}): Progres {
  const total = perkiraanDetik(input.tier);
  const tahap = TAHAP_RENDER.find((t) => t.state === input.state);
  const label = tahap?.label ?? "Menyiapkan studio";

  if (input.state === "READY") return { rasio: 1, sisaDetik: 0, kelewat: false, label: "Selesai" };

  const lantai = bobotSebelum(input.state);
  const langit = lantai + bobotTahap(input.state);

  // Di dalam tahap: seberapa jauh waktu berjalan dibanding jatah tahap ini.
  // Dipakai fungsi yang MELAMBAT mendekati akhir jatah, jadi bar tidak pernah
  // menyentuh langit-langit tahapnya lalu diam — ia terus merayap.
  const jatahTahap = Math.max(1, bobotTahap(input.state) * total);
  const lewatTahap = Math.max(0, input.berjalanDetik - lantai * total);
  const majuDalamTahap = 1 - Math.exp(-lewatTahap / jatahTahap);
  const dariTahap = lantai + (langit - lantai) * majuDalamTahap;

  // Batas keras 0,97: bar penuh yang masih berputar menghancurkan kepercayaan
  // pada penantian berikutnya.
  const rasio = Math.min(0.97, Math.max(input.sebelumnya ?? 0, dariTahap));

  const sisa = Math.round(total - input.berjalanDetik);
  return {
    rasio,
    sisaDetik: sisa > 0 ? sisa : null,
    kelewat: sisa <= 0,
    label,
  };
}

/** "3 menit lagi" / "40 detik lagi" — dibulatkan ke atas supaya tidak menjanjikan lebih cepat. */
export function teksSisa(sisaDetik: number | null): string {
  if (sisaDetik === null) return "Sebentar lagi — rendernya lagi lebih lama dari biasanya";
  if (sisaDetik < 60) return `Sekitar ${Math.max(10, Math.ceil(sisaDetik / 10) * 10)} detik lagi`;
  return `Sekitar ${Math.ceil(sisaDetik / 60)} menit lagi`;
}
