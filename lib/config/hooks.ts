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

/** Urutan prioritas keluarga hook per kategori produk (ambil 3 teratas yang layak). */
export const CATEGORY_HOOK_PRIORITY: Record<string, HookCode[]> = {
  beauty: ["H3", "H4", "H9", "H14", "H1", "H5", "H16"],
  fashion: ["H4", "H1", "H13", "H8", "H9", "H5", "H10"],
  muslim_fashion: ["H4", "H1", "H13", "H8", "H3", "H10"],
  home: ["H6", "H12", "H2", "H11", "H7", "H1"],
  kitchen: ["H6", "H12", "H2", "H7", "H15"],
  gadget: ["H5", "H7", "H13", "H8", "H1", "H14"],
  food: ["H13", "H15", "H8", "H9", "H16", "H10"],
  kids: ["H2", "H8", "H12", "H15", "H3"],
  default: ["H1", "H2", "H4", "H15", "H16", "H7", "H8"],
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
