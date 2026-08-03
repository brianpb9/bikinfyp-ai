// Bank kategori kreator (PRD F-05a / §6.4a) — data TERKURASI dari STANDAR_KECANTIKAN_ID.md,
// bukan digenerate ulang tiap request. Bahasa deskriptif kategori; DILARANG meng-clone
// wajah figur publik (BR-05a.3) — nama figur di dokumen sumber hanya acuan tipologi.
//
// Untuk MVP hands-only, kategori dipakai untuk gaya tangan/kulit & wardrobe prompt,
// BUKAN wajah. Format talking_head belum dirilis.

import { MANDATORY_NEGATIVE_PROMPT } from "./config/compliance";

export type CreatorStatus = "active" | "disabled" | "pending";

export interface CreatorCategory {
  id: string;
  name: string;
  status: CreatorStatus;
  testScore: number | null; // skor uji rasa 30 Jul 2026
  suitableFor: string[];
  /** Prompt seed terkurasi (bahasa deskriptif kategori). */
  promptSeed: string;
  /** Prompt khusus hands-only: tangan/kulit/wardrobe. */
  handsPrompt: string;
  negativePrompt: string;
}

const NEG = `${MANDATORY_NEGATIVE_PROMPT}, no watermark, no face distortion, no extra fingers, no plastic skin`;

export const CREATOR_CATEGORIES: CreatorCategory[] = [
  {
    id: "hijaber",
    name: "Hijaber",
    status: "active", // satu-satunya kategori penuh di v0.1 (skor uji 9/10)
    testScore: 9,
    suitableFor: ["muslim_fashion", "fashion", "beauty", "home", "kids"],
    promptSeed:
      "Indonesian hijabi beauty influencer, modern soft hijab framing the face, luminous medium warm skin (sawo matang), soft glam modest makeup, defined brows, warm smile, clean UGC portrait, pastel background",
    handsPrompt:
      "close-up of a young Indonesian hijabi woman's hands with warm medium skin tone, soft pastel hijab sleeve visible at wrist, modest neat nails, holding the product naturally over a clean Indonesian home table, phone camera look, natural daylight",
    negativePrompt: NEG,
  },
  {
    id: "lokal",
    name: "Lokal / Pribumi",
    status: "active",
    testScore: 7,
    suitableFor: ["default", "home", "food", "beauty"],
    promptSeed:
      "native Indonesian woman, warm medium brown skin (sawo matang), soft full oval face, expressive dark eyes, gentle rounded nose tip, natural full lips, thick dark hair, friendly warm presence, everyday beauty, natural daylight",
    handsPrompt:
      "close-up of a native Indonesian woman's hands with warm sawo matang skin tone, casual sleeve, natural nails, holding the product naturally, Indonesian home background, phone camera look",
    negativePrompt: NEG,
  },
  {
    id: "chindo",
    name: "Chindo",
    status: "active",
    testScore: 8,
    suitableFor: ["beauty"],
    promptSeed:
      "Chinese-Indonesian woman, fair warm ivory skin, soft V-shaped face, almond eyes, delicate nose bridge, glossy straight black hair, K-beauty inspired natural makeup, youthful influencer look, phone selfie lighting",
    handsPrompt:
      "close-up of a Chinese-Indonesian woman's hands with fair warm ivory skin tone, minimal pastel sleeve, neat glossy nails, holding a skincare product, bright clean background, phone camera look",
    negativePrompt: NEG,
  },
  {
    id: "genz",
    name: "Gen-Z",
    status: "active",
    testScore: 7,
    suitableFor: ["gadget", "fashion", "food"],
    promptSeed:
      "Indonesian Gen-Z girl, youthful baby face, dewy skin, soft lip tint, trendy dark hair with soft bangs, playful expression, TikTok selfie angle, natural phone camera, candid",
    handsPrompt:
      "close-up of an Indonesian Gen-Z woman's hands with light-medium warm skin, trendy rings, playful casual sleeve, holding the product in a bedroom with string lights, phone camera look",
    negativePrompt: NEG,
  },
  {
    id: "ibu",
    // Skor uji lama 5/10. Root cause ditemukan 2026-08-03 lewat render nyata
    // BytePlus langsung (bukan tebakan): "bright Indonesian kitchen" dan
    // "simple wedding ring" TIDAK PERNAH benar-benar muncul di output —
    // model selalu jatuh ke background studio putih polos, kehilangan
    // identitas "ibu rumah tangga" sama sekali (itulah kenapa terasa generik).
    // handsPrompt di bawah sudah direvisi (kata benda konkret: meja dapur,
    // ubin, jendela — bukan "kitchen" abstrak) dan TERBUKTI merender kitchen
    // yang benar-benar terlihat pada uji ulang. Diaktifkan atas keputusan
    // Brian (2026-08-03) berdasarkan bukti render itu — bukan metodologi uji
    // formal ulang seperti kategori lain; testScore lama dipertahankan apa
    // adanya sebagai jejak, bukan skor baru yang diklaim.
    name: "Ibu-ibu / Bunda",
    status: "active",
    testScore: 5,
    suitableFor: ["home", "kitchen", "kids"],
    promptSeed:
      "Indonesian mom influencer, early 30s, polished natural makeup, healthy glowing skin, mature soft features, elegant casual style, warm motherly expression, lifestyle UGC photo",
    handsPrompt:
      "close-up of an Indonesian mother's hands with warm medium skin tone, wearing a soft floral home-dress sleeve, " +
      "resting on a wooden kitchen counter with blurred kitchen tiles and a warm morning window light visible behind, " +
      "holding the product naturally, phone camera look",
    negativePrompt: NEG,
  },
  {
    id: "daerah",
    // Belum pernah diuji sebelumnya (testScore null). Render pertama
    // (2026-08-03) pakai handsPrompt lama: sama seperti "ibu", background
    // "warm home lighting" tidak pernah muncul, tetap studio putih polos;
    // "batik-pattern sleeve" juga terlihat lebih seperti motif pelangi
    // generik, bukan batik asli. handsPrompt di bawah sudah direvisi (motif
    // parang, warna coklat-krem, meja kayu + tikar rotan konkret) — uji
    // ulang menunjukkan background & motif batik jauh lebih otentik di salah
    // satu dari 2 sampel (sampel lain kena label produk yang buram, wajar —
    // variasi generate-ke-generate, bukan regresi dari prompt). status/
    // testScore tetap "pending"/null — belum ada metodologi uji formal yang
    // dijalankan, cuma diagnosis + perbaikan awal.
    name: "Daerah (Jawa/Sunda/Batak/dll)",
    status: "pending",
    testScore: null,
    suitableFor: ["default", "food"],
    promptSeed:
      "Javanese Indonesian features, soft refined facial harmony, warm medium skin, gentle expression",
    handsPrompt:
      "close-up of an Indonesian woman's hands with warm medium skin tone, wearing a traditional brown-and-cream " +
      "batik-pattern sleeve with classic parang motif, resting on a wooden home table with a woven rattan placemat " +
      "and warm afternoon window light visible behind, holding the product naturally",
    negativePrompt: NEG,
  },
  {
    id: "pria",
    name: "Pria (Lokal urban)",
    status: "active",
    // Bahasa deskriptif terkurasi dari From Grok/02_MAN/03_Lokal_Pribumi/NOTES.md
    // (studi tipologi kategori — BUKAN clone wajah figur publik, BR-05a.3).
    testScore: 7,
    suitableFor: ["gadget", "food", "default"],
    promptSeed:
      "native Indonesian man, light-to-medium brown skin (sawo matang), soft oval to gently square face, dark almond eyes, natural thick brows, short black hair neat casual style, friendly approachable everyday look, natural light",
    handsPrompt:
      "close-up of an Indonesian man's hands with light-to-medium brown skin tone (sawo matang), casual t-shirt or hoodie sleeve, natural unpolished nails, holding the product in a relatable everyday Indonesian home/desk setting, phone camera look, natural daylight",
    negativePrompt: NEG,
  },
];

export function getCreatorCategory(id: string): CreatorCategory | undefined {
  return CREATOR_CATEGORIES.find((c) => c.id === id);
}

export function assertCategoryUsable(id: string): CreatorCategory {
  const cat = getCreatorCategory(id);
  if (!cat) throw new Error(`Kategori kreator tidak dikenal: ${id}`);
  if (cat.status !== "active")
    throw new Error(
      cat.status === "pending"
        ? `Kategori "${cat.name}" belum diuji kualitasnya — belum dirilis.`
        : `Kategori "${cat.name}" dinonaktifkan (skor uji ${cat.testScore}/10, di bawah ambang 7/10).`
    );
  return cat;
}
