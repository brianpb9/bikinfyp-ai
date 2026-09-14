/**
 * PENGETAHUAN REALITAS + NEGATIVE PROMPT — supaya model tidak mengarang dunia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA ADA
 * ────────────────────────────────────────────────────────────────────────────
 * Brian, 14 Sep 2026, setelah menonton render uji Faza v3 dan v4: "banyak yang
 * halusinasi seperti alur sepeda motor berjalan, posisi mesin yang di dalam jok
 * motor (tidak natural posisi mesin) dan beberapa adegan lainnya."
 *
 * Terlihat di frame: silinder bersirip motor sport ditanam di dek pijakan
 * skuter matik, mesin melayang di atas roda belakang, motor "berangkat" lalu
 * berakhir di dalam garasi. Penulis naskah dan model gambar sama-sama tidak
 * tahu bagaimana benda itu sebenarnya tersusun — dan tidak ada yang melarang
 * kesalahan yang paling mungkin terjadi.
 *
 * Tiga lapis dipasang dari modul ini:
 *   1. FAKTA per kategori — masuk ke penulis naskah, prompt gambar, prompt gerak,
 *      dan auditor realitas.
 *   2. HINDARI (negative prompt) — global + kategori + per shot dari naskah;
 *      dikirim sebagai `negative_prompt` ke Seedream DAN ditulis eksplisit di
 *      prompt (Grok tidak punya medan negatif).
 *   3. AUDIT REALITAS naskah sebelum satu gambar pun dibayar (naskah.ts).
 *
 * Fakta di sini ditulis dari pengetahuan umum yang bisa diperiksa siapa pun,
 * bukan tebakan gaya. Tambah kategori dengan menambah entri, bukan cabang kode.
 */

export type KategoriRealitas =
  | "otomotif_motor"
  | "otomotif_mobil"
  | "fashion_pakaian"
  | "elektronik_audio"
  | "perawatan_diri"
  | "makanan_minuman"
  | "rumah_tangga"
  | "umum";

export interface PengetahuanRealitas {
  label: string;
  /** Kata kunci pengenal dari nama/kategori/deskripsi produk (huruf kecil). */
  kunci: string[];
  /** Fakta yang WAJIB dihormati penulis naskah dan model gambar/gerak. English. */
  fakta: string[];
  /** Negative prompt khusus kategori. English, frasa pendek. */
  hindari: string[];
}

/** Kesalahan yang muncul di kategori apa pun. */
export const HINDARI_GLOBAL: string[] = [
  "extra fingers", "missing fingers", "fused or twisted hands", "deformed limbs", "duplicated person", "melting face",
  "floating objects", "objects merging into each other", "impossible physics", "liquid appearing from nowhere",
  "wrong real-world scale", "text", "caption", "watermark", "gibberish lettering", "garbled label", "logo of another brand",
  "collage", "split screen", "multiple panels", "letterbox bars", "blurred border", "plastic doll skin", "cartoon", "3D render look",
  "scene changing mid-shot", "teleporting", "sudden new objects",
];

export const REALITAS: Record<KategoriRealitas, PengetahuanRealitas> = {
  otomotif_motor: {
    label: "otomotif — sepeda motor",
    kunci: ["motor", "sepeda motor", "matic", "skuter", "scooter", "mesin motor", "degreaser", "oli", "rantai", "knalpot", "helm", "busi", "karburator", "injeksi", "cvt"],
    fakta: [
      "Pick ONE motorcycle type for the whole film and keep its real anatomy:",
      "AUTOMATIC SCOOTER (the most common in Indonesia, e.g. the everyday 110–160cc matic): the engine and CVT form one swingarm unit at the LOWER REAR of the bike, beside and ahead of the rear wheel, below the body panels. The long CVT cover is on the LEFT side; the cylinder is small and lies almost horizontal pointing forward, mostly hidden under plastic, reachable from below/behind. There is NO engine in the flat footboard, NO engine under the seat opening (under the seat is a plastic storage box), and NO tall finned cylinder visible in the middle of the scooter.",
      "UNDERBONE/MOPED (bebek): a horizontal single cylinder sits low in the middle below the frame, between the rider's feet, partly covered by plastic legshields.",
      "NAKED SPORT/COMMUTER (e.g. 150cc sport): an upright or forward-tilted finned or liquid-cooled cylinder is fully exposed in the MIDDLE of the frame, under the fuel tank, between the rider's knees; chain drive on the left to the rear wheel.",
      "Engine cleaning in real life: engine COLD, bike parked on its centre stand or side stand, degreaser sprayed onto greasy crankcase/cylinder/CVT areas from 15–30 cm, left briefly, loosened grime scrubbed with a small brush, then wiped with a cloth or rinsed with low-pressure water, avoiding electrical connectors and the air intake. Grime on engines is dark brown-black oily crust and dust, mostly on the lower engine.",
      "Riding in real life: the rider sits on the seat with BOTH hands on the handlebar grips, feet on the footboard or footpegs, helmet on and fastened; the motorcycle moves forward in the direction it faces along a road, wheels rotating, the rider leaning only slightly; a parked bike is on its stand with nobody riding it.",
      "Starting a ride: rider walks the bike off the centre stand or sits and starts it, then rolls forward out of the carport onto the street — never reverses into a building or appears inside a different room.",
    ],
    hindari: [
      "engine inside the footboard", "engine under the seat", "finned cylinder in the middle of a scooter", "engine above the rear wheel",
      "engine detached from the motorcycle", "engine held in hands", "motorcycle with two engines", "mixed scooter and sport bike parts",
      "chain drive on a scooter", "motorcycle moving sideways or backwards", "motorcycle floating", "wheels not touching the ground",
      "rider without helmet", "rider with one hand off the handlebar while riding", "rider standing on the seat", "riding inside a house",
      "spraying the seat, tyre or brake disc", "spraying a hot running engine", "water jet on electrical parts", "brand badge of Honda, Yamaha, Suzuki or Kawasaki",
    ],
  },
  otomotif_mobil: {
    label: "otomotif — mobil",
    kunci: ["mobil", "kap mesin", "ruang mesin", "car", "sedan", "mpv", "suv", "wiper", "ban mobil"],
    fakta: [
      "A car engine bay is opened by lifting the bonnet at the FRONT; the bonnet is held by a prop rod or struts. The engine sits under the bonnet with plastic covers, battery, fluid reservoirs and hoses around it.",
      "Engine bay cleaning in real life: engine cold, battery terminals and alternator covered, degreaser sprayed on greasy areas, brushed, wiped or rinsed lightly.",
      "Cars drive forward on roads with a driver seated behind the wheel wearing a seatbelt; parked cars have nobody inside unless shown getting in.",
    ],
    hindari: [
      "engine in the boot", "bonnet opening from the side", "car without wheels touching the ground", "driver without seatbelt",
      "car logo of Toyota, Honda, Daihatsu, Suzuki or Mitsubishi", "engine outside the car", "person inside the engine bay",
    ],
  },
  fashion_pakaian: {
    label: "fashion — pakaian",
    kunci: ["kaos", "t-shirt", "tee", "kemeja", "hoodie", "celana", "jaket", "baju", "hijab", "dress", "outfit", "oversize", "boxy", "cotton", "katun", "sablon"],
    fakta: [
      "A garment keeps its exact colour, fabric weight, cut and printed graphic from the product photo; the print sits where it is on the real garment (usually the chest) and folds naturally with the body.",
      "Real wearers: the garment fits the body size described (e.g. boxy oversize = dropped shoulders, wide straight body, sleeves to the elbow); fabric wrinkles at elbows and waist; people put it on over the head or through arms normally.",
      "Everyday Indonesian contexts: kos room mirror, street, café, campus, motorbike commute (helmet on), weekend hangout; clean, well-lit, no shop mannequins unless stated.",
    ],
    hindari: [
      "print distorted or mirrored", "print changing between shots", "garment changing colour", "extra sleeves", "fabric melting into skin",
      "shirt floating without a body", "logo of another clothing brand", "garment worn inside out", "sweat stains", "transparent fabric",
    ],
  },
  elektronik_audio: {
    label: "elektronik — audio/speaker",
    kunci: ["speaker", "salon", "bluetooth", "karaoke", "mikrofon", "microphone", "headphone", "earphone", "audio", "subwoofer", "amplifier"],
    fakta: [
      "Portable party speakers stand upright on the floor or a table, pulled by their telescopic trolley handle on two wheels; controls and ports are on the top panel or back; a wireless microphone is held in the hand close to the mouth.",
      "Sound is shown through people's reactions, dancing, singing and a light speaker-cone vibration or LED glow — never visible sound waves or lines.",
      "Plugs go into matching sockets; Bluetooth pairing is shown on a phone held normally.",
    ],
    hindari: [
      "visible sound waves", "speaker floating", "cables plugged into nothing", "microphone with a cable when wireless",
      "speaker exploding", "people covering their ears in pain", "logo of another electronics brand", "speaker cone on the wrong side",
    ],
  },
  perawatan_diri: {
    label: "perawatan diri — skincare/kosmetik/sabun",
    kunci: ["serum", "skincare", "krim", "cream", "sabun", "facial", "wajah", "toner", "sunscreen", "lip", "makeup", "shampoo", "parfum", "lotion", "masker"],
    fakta: [
      "Products are applied realistically: a small amount dispensed onto fingertips or palm, spread gently on clean skin; serums are drops, creams are dabs; shampoo lathers on wet hair in the shower.",
      "Skin looks natural with real texture and pores; results are subtle and plausible (fresher, hydrated), never instant dramatic transformations.",
    ],
    hindari: [
      "instant skin transformation", "glowing skin light effects", "plastic doll skin", "product squirting uncontrollably",
      "applying product to eyes or mouth", "medical setting", "before-after with a different person", "logo of another beauty brand",
    ],
  },
  makanan_minuman: {
    label: "makanan & minuman",
    kunci: ["makanan", "minuman", "kopi", "teh", "snack", "keripik", "sambal", "mie", "frozen", "jus", "susu", "kue", "roti", "bumbu"],
    fakta: [
      "Food is prepared, served and eaten realistically: portions fit the plate or cup, steam only from hot food, liquid pours downward from its container into the vessel, people take normal bites or sips.",
      "Packaging is opened by tearing or twisting the real closure shown in the product photo.",
    ],
    hindari: [
      "food floating", "liquid pouring upward", "impossible portion size", "steam from cold drinks", "eating the packaging",
      "raw meat on a plate being eaten", "logo of another food brand", "insects",
    ],
  },
  rumah_tangga: {
    label: "rumah tangga",
    kunci: ["pembersih", "lantai", "cuci", "deterjen", "dapur", "panci", "sapu", "pel", "rak", "wadah", "botol minum", "lampu"],
    fakta: [
      "Household products are used on the surfaces they are made for, in real Indonesian homes: tiled floors, kitchen counters, bathrooms; cleaning shows spraying or pouring, wiping or scrubbing, and a plausible improvement.",
    ],
    hindari: ["dirt vanishing without wiping", "floating mop", "product used on food", "logo of another household brand"],
  },
  umum: {
    label: "umum",
    kunci: [],
    fakta: ["Every object behaves and is used as it is in real life, at its true size, in a plausible everyday Indonesian setting."],
    hindari: [],
  },
};

/** Tebak kategori dari data produk. Beberapa kategori boleh sekaligus (mis. degreaser: motor + mobil). */
export function tebakKategori(teks: string): KategoriRealitas[] {
  const t = teks.toLowerCase();
  const skor = (Object.keys(REALITAS) as KategoriRealitas[])
    .filter((k) => k !== "umum")
    .map((k) => ({ k, n: REALITAS[k].kunci.filter((w) => t.includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return skor.length ? skor.map((x) => x.k) : ["umum"];
}

export function faktaUntuk(kategori: KategoriRealitas[]): string {
  return kategori.map((k) => `${REALITAS[k].label.toUpperCase()}:\n- ${REALITAS[k].fakta.join("\n- ")}`).join("\n\n");
}

/** Negative prompt gabungan, tanpa duplikat, dibatasi supaya prompt tidak membengkak. */
export function negatifUntuk(kategori: KategoriRealitas[], perShot: string[] = [], maks = 70): string[] {
  const semua = [...perShot, ...kategori.flatMap((k) => REALITAS[k].hindari), ...HINDARI_GLOBAL]
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(semua)].slice(0, maks);
}
