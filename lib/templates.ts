// Template kampanye (permintaan Brian 2026-08-11: "mungkin ada templates juga,
// jadi nanti tinggal ganti productnya saja. templatenya sudah kita buat").
//
// Dia benar bahwa bahannya sudah ada — 16 keluarga hook, 3 format, 3 level
// hook, 3 durasi, 7 persona. Yang belum ada adalah PENGEMASANNYA. Selama ini
// brand harus paham arti "H10" atau "Tangan + VO" untuk mendapat hasil bagus;
// template mengubahnya jadi satu pilihan bernama yang sudah terbukti.
//
// Template SENGAJA bukan tabel database. Isinya keputusan kreatif kami, bukan
// data milik brand: ia ikut versi kode, bisa ditinjau lewat diff, dan tidak
// perlu migrasi tiap kali kami menambah satu. Kalau nanti brand boleh menyimpan
// preset sendiri, ITU yang masuk database — bukan yang ini.

export type TemplateKind = "affiliate" | "ads" | "tvc";
export type TemplateFormat = "hands_only" | "talking_head" | "tvc" | "ads";
export type TemplateTier = "high_quality" | "super_hq";
export type TemplateHookLevel = import("./config/hooks").HookLevel;

export interface CampaignTemplate {
  id: string;
  name: string;
  /** Satu kalimat: KAPAN template ini dipakai, bukan apa isinya. */
  when: string;
  kind: TemplateKind;
  format: TemplateFormat;
  durationSec: 15 | 30;
  tier: TemplateTier;
  hookLevel: TemplateHookLevel;
  /** Keluarga hook yang dipaksa. null = biarkan mesin memilih per kategori. */
  hookFamily: string | null;
  /** Jumlah variasi video yang disarankan. */
  count: number;
  /** Kategori produk yang paling cocok — untuk penyaringan di galeri. */
  bestFor: string[];
  /** Klip contoh; null kalau kami belum punya render nyata untuk gaya ini.
   * Lebih baik kosong daripada memasang klip yang salah gaya. */
  preview: string | null;
  accent: "amber" | "rose" | "emerald" | "violet" | "sky" | "zinc";
  /** Rute TVC — hanya untuk kind "tvc". Lihat lib/media/shot-planner.ts. */
  tvcRoute?: "luxury" | "reallife";
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "racun-checkout",
    name: "Racun Checkout",
    when: "Andalan harian. Dorong orang langsung ke keranjang tanpa terasa memaksa.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H10", count: 3,
    bestFor: ["beauty", "food", "kitchen", "fashion"],
    preview: "/previews/format-tangan.mp4", accent: "amber",
  },
  {
    id: "review-jujur",
    name: "Review Jujur",
    when: "Produk yang butuh kepercayaan dulu — skincare, suplemen, alat.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H3", count: 3,
    bestFor: ["beauty", "health", "electronics"],
    preview: "/previews/format-wajah.mp4", accent: "emerald",
  },
  {
    id: "unboxing",
    name: "Unboxing Estetik",
    when: "Kemasannya bagus dan layak dipamerkan. Fokus ke momen buka paket.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H4", count: 4,
    bestFor: ["beauty", "fashion", "electronics", "kitchen"],
    preview: "/previews/format-tangan.mp4", accent: "violet",
  },
  {
    id: "before-after",
    name: "Sebelum vs Sesudah",
    when: "Hasilnya kelihatan mata. Skincare, pembersih, alat rapikan rumah.",
    kind: "affiliate", format: "hands_only", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H11", count: 3,
    bestFor: ["beauty", "kitchen", "health"],
    preview: "/previews/format-tangan.mp4", accent: "sky",
  },
  {
    id: "diskon-gede",
    name: "Diskon Gede",
    when: "Sedang promo betulan. Angka harganya yang jadi bintang.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "high_quality",
    hookLevel: "gila", hookFamily: "H1", count: 4,
    bestFor: ["fashion", "muslim_fashion", "electronics", "food"],
    preview: "/previews/format-tangan.mp4", accent: "rose",
  },
  {
    id: "buat-kamu-yang",
    name: "Buat Kamu Yang...",
    when: "Menyasar satu jenis pembeli dengan tajam, bukan semua orang.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H8", count: 3,
    bestFor: ["muslim_fashion", "fashion", "beauty", "health"],
    preview: "/previews/format-wajah.mp4", accent: "amber",
  },
  {
    id: "spill-rahasia",
    name: "Spill Rahasia",
    when: "Produk yang orang penasaran tapi jarang dibahas terang-terangan.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "gila", hookFamily: "H14", count: 3,
    bestFor: ["beauty", "health", "fashion"],
    preview: "/previews/format-wajah.mp4", accent: "violet",
  },
  {
    id: "kenalin-bisnis",
    name: "Kenalin Bisnismu",
    when: "Buat app, jasa, atau toko yang belum banyak dikenal. Presenter yang menjelaskan.",
    kind: "ads", format: "ads", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H12", count: 3,
    bestFor: ["jasa", "app", "toko"],
    preview: "/previews/format-ads.mp4", accent: "sky",
  },
  {
    id: "promo-terbatas",
    name: "Promo Terbatas",
    when: "Ada penawaran yang benar-benar berbatas waktu. Langsung ke ajakan, tanpa basa-basi.",
    kind: "ads", format: "ads", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H10", count: 4,
    bestFor: ["jasa", "toko", "beauty", "fashion", "food"],
    preview: "/previews/format-ads.mp4", accent: "rose",
  },
  {
    id: "tvc-reallife",
    name: "TVC Sehari Penuh",
    when: "Produk yang harus bertahan seharian — sunscreen, deodoran, makeup tahan lama.",
    kind: "tvc", format: "tvc", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H11", count: 2, tvcRoute: "reallife",
    bestFor: ["beauty", "health", "fashion"],
    preview: "/previews/format-tvc.mp4", accent: "sky",
  },
  {
    id: "tvc-15",
    name: "TVC 15 Detik",
    when: "Materi brand yang rapi: sinematik, terkontrol, ditutup hero shot.",
    kind: "tvc", format: "tvc", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H12", count: 2,
    bestFor: ["beauty", "food", "electronics", "kitchen"],
    preview: "/previews/format-tvc.mp4", accent: "zinc",
  },
  {
    id: "tvc-30",
    name: "TVC 30 Detik",
    when: "Versi panjang: dunia brand, bukti, reaksi, lalu packshot.",
    kind: "tvc", format: "tvc", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H11", count: 2,
    bestFor: ["beauty", "food", "electronics", "kitchen"],
    preview: "/previews/format-tvc.mp4", accent: "zinc",
  },
];

export function getTemplate(id: string | null | undefined): CampaignTemplate | null {
  if (!id) return null;
  return CAMPAIGN_TEMPLATES.find((t) => t.id === id) ?? null;
}
