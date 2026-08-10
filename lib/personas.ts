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
  /**
   * Gaya PEMBAWAAN saat bicara ke kamera (2026-08-07, permintaan Brian:
   * tiap kategori harus terasa beda) — energi, gestur, ritme. Dipakai
   * shot-planner untuk format talking_head.
   */
  deliveryPrompt: string;
  /** Voice Gemini TTS terkunci per avatar (2026-08-07: TTS = suara resmi semua video). */
  voiceName: string;
  /** Arahan gaya bicara untuk TTS (bahasa Indonesia, jeda natural). */
  voiceStyle: string;
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
    deliveryPrompt:
      "graceful calm delivery, soft gentle hand gestures, serene warm smile, unhurried elegant pace",
    voiceName: "Aoede",
    voiceStyle:
      "Ucapkan sebagai perempuan muda Indonesia yang kalem, hangat dan anggun, seperti cerita ke teman dekat, ada jeda natural antar kalimat, tidak buru-buru, tidak seperti iklan:",
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
    deliveryPrompt:
      "warm neighborly delivery like chatting with a close friend, easy genuine laugh, relaxed pace",
    voiceName: "Kore",
    voiceStyle:
      "Ucapkan sebagai perempuan Indonesia yang ramah dan membumi, seperti ngobrol santai dengan tetangga akrab, ada jeda natural, tidak buru-buru:",
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
    deliveryPrompt:
      "polished beauty-influencer delivery, light confident energy, playful expressive eyes, snappy but smooth pace",
    voiceName: "Zephyr",
    voiceStyle:
      "Ucapkan sebagai beauty influencer muda Indonesia yang percaya diri dan halus, santai tapi meyakinkan, ada jeda natural, tidak buru-buru:",
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
    deliveryPrompt:
      "high-energy playful delivery, quick expressive reactions, animated hand gestures, fast fun TikTok pace",
    voiceName: "Leda",
    voiceStyle:
      "Ucapkan sebagai cewek Gen-Z Indonesia yang ceria dan ekspresif, santai seperti ngobrol ke bestie, ada jeda natural, tidak buru-buru:",
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
    deliveryPrompt:
      "reassuring motherly delivery, practical no-nonsense warmth, nodding while explaining, moderate calm pace",
    voiceName: "Sulafat",
    voiceStyle:
      "Ucapkan sebagai ibu muda Indonesia yang hangat dan menenangkan, praktis dan meyakinkan, ada jeda natural, tidak buru-buru:",
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
    deliveryPrompt:
      "humble down-to-earth delivery, shy genuine smile, polite unhurried gestures",
    voiceName: "Kore",
    voiceStyle:
      "Ucapkan sebagai perempuan Indonesia yang santun dan membumi, pelan dan ramah, ada jeda natural:",
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
    deliveryPrompt:
      "laid-back confident delivery, minimal casual gestures, slight grin, steady relaxed pace",
    voiceName: "Charon",
    voiceStyle:
      "Ucapkan sebagai cowok muda Indonesia yang santai dan percaya diri, seperti rekomendasi ke teman, ada jeda natural, tidak buru-buru:",
    negativePrompt: NEG,
  },
  // Male roster (2026-08-11, Brian: bank cewek ada 5, cowok cuma 1 — nggak
  // seimbang). Ditambah 5 persona pria baru pakai foto yang sudah dikirim
  // Brian sendiri (public/avatars/*.png), paralel ke 5 kategori perempuan
  // (Gen-Z/Bapak.../senior/profesional/lokal). BELUM lewat uji rasa formal
  // (testScore null) tapi diaktifkan langsung atas permintaan eksplisit
  // Brian hari ini — sama seperti precedent "ibu" (2026-08-03).
  {
    id: "genzpria",
    name: "Fajar (Gen-Z)",
    status: "active",
    testScore: null,
    suitableFor: ["gadget", "fashion", "food"],
    promptSeed:
      "young Indonesian Gen-Z man, light-to-medium warm skin, soft rounded youthful face, textured casual dark hair, relaxed everyday streetwear style, friendly approachable expression, natural phone camera look",
    handsPrompt:
      "close-up of a young Indonesian Gen-Z man's hands with light-medium warm skin, casual sleeve, trendy watch, holding the product in a bedroom/dorm setting with string lights, phone camera look",
    deliveryPrompt:
      "high-energy playful delivery, quick expressive reactions, animated casual gestures, fast fun TikTok pace",
    voiceName: "Puck",
    voiceStyle:
      "Ucapkan sebagai cowok Gen-Z Indonesia yang santai dan enerjik, kayak ngobrol ke temen nongkrong, ada jeda natural, tidak buru-buru:",
    negativePrompt: NEG,
  },
  {
    id: "bapak",
    name: "Pak Danu (Bapak)",
    status: "active",
    testScore: null,
    suitableFor: ["home", "gadget", "default"],
    promptSeed:
      "Indonesian father figure, early-to-mid 40s, warm mature features, light stubble, calm reassuring presence, smart-casual style, natural daylight",
    handsPrompt:
      "close-up of an Indonesian father's hands with warm medium skin tone, casual button-shirt sleeve, resting on a wooden home table with warm morning window light behind, holding the product naturally, phone camera look",
    deliveryPrompt:
      "reassuring fatherly delivery, practical no-nonsense warmth, calm confident pace",
    voiceName: "Fenrir",
    voiceStyle:
      "Ucapkan sebagai bapak muda Indonesia yang hangat dan tenang, praktis dan meyakinkan, ada jeda natural, tidak buru-buru:",
    negativePrompt: NEG,
  },
  {
    id: "senior",
    name: "Pak Herman (Senior)",
    status: "active",
    testScore: null,
    suitableFor: ["health", "gadget", "default"],
    promptSeed:
      "Indonesian man in his 50s, distinguished greying-at-temples look, warm trustworthy expression, smart casual style, natural daylight",
    handsPrompt:
      "close-up of an older Indonesian man's hands with medium skin tone, smart casual sleeve, holding the product naturally on a simple wooden table, phone camera look",
    deliveryPrompt:
      "trustworthy senior delivery, unhurried authoritative warmth, steady measured pace",
    voiceName: "Orus",
    voiceStyle:
      "Ucapkan sebagai bapak paruh baya Indonesia yang berwibawa dan hangat, tenang dan meyakinkan, ada jeda natural, tidak buru-buru:",
    negativePrompt: NEG,
  },
  {
    id: "profesional",
    name: "Bimo (Profesional)",
    status: "active",
    testScore: null,
    suitableFor: ["gadget", "default", "beauty"],
    promptSeed:
      "young Indonesian professional man, neat short hair, clean-shaven, smart formal style (blazer/dress shirt), confident polished presence, studio-clean phone camera look",
    handsPrompt:
      "close-up of a young Indonesian professional man's hands with medium skin tone, smart shirt sleeve, holding the product on a clean office desk, phone camera look",
    deliveryPrompt:
      "polished confident delivery, articulate measured gestures, professional steady pace",
    voiceName: "Enceladus",
    voiceStyle:
      "Ucapkan sebagai profesional muda Indonesia yang percaya diri dan rapi, jelas dan meyakinkan, ada jeda natural, tidak buru-buru:",
    negativePrompt: NEG,
  },
  {
    id: "lokalpria",
    name: "Yoga (Lokal)",
    status: "active",
    testScore: null,
    suitableFor: ["default", "home", "food"],
    promptSeed:
      "native Indonesian man, warm medium brown skin (sawo matang), light stubble, approachable everyday features, casual style, natural daylight",
    handsPrompt:
      "close-up of a native Indonesian man's hands with warm sawo matang skin tone, casual sleeve, holding the product naturally in an everyday Indonesian home setting, phone camera look",
    deliveryPrompt:
      "warm neighborly delivery like chatting with a close friend, easy genuine laugh, relaxed pace",
    voiceName: "Iapetus",
    voiceStyle:
      "Ucapkan sebagai cowok Indonesia yang ramah dan membumi, santai kayak ngobrol sama temen deket, ada jeda natural, tidak buru-buru:",
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
