// Taksonomi hook H1..H16 (FSD F-02.2) + pemetaan kategori → keluarga prioritas.
// Pemetaan adalah KONFIGURASI (aturan F-02.2 #2): dapat diubah tanpa mengubah logika mesin.

export type HookCode =
  | "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7" | "H8"
  | "H9" | "H10" | "H11" | "H12" | "H13" | "H14" | "H15" | "H16";

export interface HookFamily {
  code: HookCode;
  name: string;
  /** true bila produk BOLEH disebut di hook (pengecualian L-06: H4/H11) */
  productInHookAllowed: boolean;
}

export const HOOK_FAMILIES: HookFamily[] = [
  { code: "H1", name: "Harga/value shock", productInHookAllowed: false },
  { code: "H2", name: "Problem-agitation", productInHookAllowed: false },
  { code: "H3", name: "Testimoni personal", productInHookAllowed: false },
  { code: "H4", name: "Social proof/sold out", productInHookAllowed: true },
  { code: "H5", name: "Peringatan/negatif", productInHookAllowed: false },
  { code: "H6", name: "Curiosity gap", productInHookAllowed: false },
  { code: "H7", name: "Insider stat", productInHookAllowed: false },
  { code: "H8", name: "Call-out audiens", productInHookAllowed: false },
  { code: "H9", name: "Perbandingan", productInHookAllowed: false },
  { code: "H10", name: "FOMO/urgensi jujur", productInHookAllowed: false },
  { code: "H11", name: "Transformasi", productInHookAllowed: true },
  { code: "H12", name: "Manfaat/praktis", productInHookAllowed: false },
  { code: "H13", name: "Identitas", productInHookAllowed: false },
  { code: "H14", name: "Rahasia/spill", productInHookAllowed: false },
  { code: "H15", name: "Pertanyaan/relate", productInHookAllowed: false },
  { code: "H16", name: "Storytime/penyesalan", productInHookAllowed: false },
];

export const HOOK_BY_CODE = Object.fromEntries(HOOK_FAMILIES.map((h) => [h.code, h])) as Record<
  HookCode,
  HookFamily
>;

/** Level hook pilihan user (S3): normal = prioritas kategori berbasis evidensi;
 * berani/gila = keluarga hook agresif. gila JUGA mengubah visual shot 1
 * (pattern-interrupt product-safe di shot-planner).
 *
 * JUJUR SOAL EVIDENSI (ckpt9-n316): shock cuma +0.08 (lemah), challenge malah
 * negatif — "makin gila makin menang" TIDAK didukung data saat ini. Level ini
 * fitur EKSPERIMEN (dilabeli begitu di UI, jangan dijanjikan "lebih FYP");
 * hasilnya justru jadi data eksperimen buat model (brief §4). */
export type HookLevel = "normal" | "berani" | "gila";

/** Prioritas keluarga untuk level berani/gila: shock/peringatan/FOMO dulu,
 * lalu pertanyaan agresif — tetap dari 16 keluarga tervalidasi (teks tetap
 * lolos L-10..L-13; tidak ada template baru). */
export const BOLD_HOOK_PRIORITY: HookCode[] = ["H1", "H5", "H10", "H9", "H2", "H4"];

/** Urutan prioritas keluarga hook per kategori produk (ambil 3 teratas yang layak).
 *
 * Re-rank 2026-08-06 berbasis koefisien MODEL FYP 1.0 ckpt9-n316 (n=316, video
 * jualan TikTok ID ber-GMV; korelasional, bukan kausal): hook berbentuk
 * PERTANYAAN paling kuat (+0.15 hook_type=question, +0.21 transcript_has_question
 * → H2/H4/H9/H13/H15), transformasi/before_after positif (+0.13 → H11), shock
 * ringan positif (+0.08 → H1), storytime negatif (-0.11 → H16 turun ke ekor).
 * Anggota per kategori TIDAK diubah (fit kategori tetap keputusan produk) —
 * hanya urutannya. Koefisien global, belum per-kategori (n belum cukup) —
 * re-rank ulang saat checkpoint per-kategori tersedia. */
export const CATEGORY_HOOK_PRIORITY: Record<string, HookCode[]> = {
  beauty: ["H9", "H4", "H3", "H1", "H14", "H5", "H16"],
  fashion: ["H13", "H4", "H9", "H1", "H8", "H5", "H10"],
  muslim_fashion: ["H13", "H4", "H1", "H3", "H8", "H10"],
  home: ["H2", "H11", "H6", "H12", "H7", "H1"],
  kitchen: ["H2", "H15", "H6", "H12", "H7"],
  gadget: ["H13", "H1", "H5", "H7", "H8", "H14"],
  food: ["H15", "H13", "H9", "H8", "H10", "H16"],
  kids: ["H2", "H15", "H8", "H12", "H3"],
  default: ["H2", "H15", "H4", "H1", "H7", "H8", "H16"],
};

/** Kata benda kategori yang dipakai di template (bukan nama produk). */
export const CATEGORY_NOUN: Record<string, string> = {
  beauty: "skincare",
  fashion: "baju",
  muslim_fashion: "hijab",
  home: "barang rumah",
  kitchen: "alat dapur",
  gadget: "gadget",
  food: "cemilan",
  kids: "barang anak",
  default: "barang",
};

/** Keluhan khas per kategori (untuk H2/H3/H5). */
export const CATEGORY_PAIN: Record<string, string> = {
  beauty: "kusamnya",
  fashion: "gerahnya",
  muslim_fashion: "gerahnya",
  home: "berantakannya",
  kitchen: "ribetnya",
  gadget: "lemotnya",
  food: "enegnya",
  kids: "rewelnya",
  default: "zonknya",
};

/** Kata sifat bukti konkret per kategori (untuk segmen demo). */
export const CATEGORY_PROOF: Record<string, string> = {
  beauty: "teksturnya",
  fashion: "bahannya",
  muslim_fashion: "bahannya",
  home: "materialnya",
  kitchen: "materialnya",
  gadget: "build quality-nya",
  food: "rasanya",
  kids: "jahitannya",
  default: "kualitasnya",
};

export const CATEGORY_POST_TIME: Record<string, string> = {
  beauty: "19.00–21.00 WIB",
  fashion: "12.00–13.00 dan 19.00–21.00 WIB",
  muslim_fashion: "04.30–06.00 dan 19.00–21.00 WIB",
  home: "09.00–11.00 WIB",
  kitchen: "09.00–11.00 dan 16.00–18.00 WIB",
  gadget: "20.00–22.00 WIB",
  food: "11.00–13.00 dan 17.00–19.00 WIB",
  kids: "20.00–21.30 WIB",
  default: "19.00–21.00 WIB",
};

export const CATEGORY_NICHE_HASHTAGS: Record<string, string[]> = {
  beauty: ["#skincarelokal", "#racunskincare", "#skincareviral"],
  fashion: ["#ootdhijab", "#racunfashion", "#fashiontiktok"],
  muslim_fashion: ["#ootdhijab", "#hijabstyle", "#racunfashion"],
  home: ["#rumahestetik", "#racunshopee", "#homeliving"],
  kitchen: ["#alatdapur", "#racunshopee", "#dapurcantik"],
  gadget: ["#gadgetviral", "#racunteknologi", "#gadgetmurah"],
  food: ["#jajanviral", "#kulinertiktok", "#racunjajan"],
  kids: ["#baranganak", "#racunbunda", "#ibudananak"],
  default: ["#racunshopee", "#barangviral", "#wajibpunya"],
};

export const BASE_HASHTAGS = ["#fyp", "#racuntiktok", "#tiktokshop", "#keranjangkuning", "#spillproduk"];

/** Merek pesaing yang tidak boleh disebut merendahkan (L-15) — konfigurasi, bisa diperbarui. */
export const COMPETITOR_BRANDS = [
  "wardah", "skintific", "somethinc", "scarlett", "hanasui", "implora",
  "msglow", "ms glow", "erha", "avoskin", "azarine", "glad2glow",
];
