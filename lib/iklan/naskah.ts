/**
 * PENULIS NASKAH IKLAN SINEMATIK — 29–33 detik, ≥9 shot, busur cerita, bukti, lockup.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA MODUL SENDIRI, BUKAN MEMPERLUAS lib/script-engine
 * ────────────────────────────────────────────────────────────────────────────
 * Mesin naskah lama dibangun untuk video afiliasi 15 detik: HOOK/BODY/CTA,
 * 3–6 segmen 4–6 detik, CTA wajib frasa keranjang. Standar yang Brian tetapkan
 * 14 Sep 2026 (knowledge/rules/REFERENSI-IKLAN-SINEMATIK-v1.md) menuntut hal
 * yang bertentangan dengan hampir setiap aturan itu. Afiliasi sengaja TIDAK
 * diubah (keputusan 1A).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ATURAN YANG BISA DIHITUNG DIPERIKSA KODE, BUKAN DIPERCAYAKAN KE MODEL
 * ────────────────────────────────────────────────────────────────────────────
 * Skema keluaran hanya menjamin BENTUK. Jumlah shot, durasi, ruang kata VO,
 * frasa terlarang, nama produk di hook, adegan bukti — diperiksa
 * periksaNaskah(), dan pelanggarannya dikirim balik ke model, maksimal dua kali.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUTARAN 2 — dari review independen render uji Faza (4/10, Reject)
 * ────────────────────────────────────────────────────────────────────────────
 * Creative director dan product director, terpisah, sepakat pada hal yang sama:
 *   - hook 4,5 dtk berupa makro gelap tanpa manusia dan tanpa teks
 *   - TIDAK ADA adegan yang memperlihatkan produk bekerja: semprotan ke lampu,
 *     mesin bersih karena disiram air
 *   - mesin/motor berganti model antar shot; label kecil jadi huruf acak
 *   - VO menarasikan gambar alih-alih menjual manfaat
 *   - properti yang diserahkan (helm) tidak dipakai; pengendara tanpa helm
 *   - teks layar hampir tidak ada; tanpa ajakan dan tanpa tempat membeli
 * Aturan di bawah menjawab masing-masing, dan yang bisa dihitung diperiksa kode.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config";

export const MODEL_NASKAH_IKLAN = "claude-opus-5";

export const SkemaShotIklan = z.object({
  beat: z.enum(["HOOK", "KONTEKS", "REVEAL", "BUKTI", "NILAI", "MAKNA", "LOCKUP"]),
  durasi: z.number().describe("Seconds. HOOK 1.5–2.5. Other shots 2–3.5 (max 4). LOCKUP 3–4.5."),
  ukuran: z.enum(["wide", "medium", "close_up", "macro", "insert"]),
  kamera: z.string().describe("English. One camera move, e.g. 'slow push-in', 'static tripod', 'handheld follow from behind', 'slow orbit left'."),
  visual_en: z.string().describe("English. The FIRST FRAME as a photograph: subject, pose, setting, composition, light. 25–60 words. No text or logos except the product's own label."),
  gerak_en: z.string().describe("English. What moves during the shot (one or two motions), staying in the same place and moment. 8–25 words."),
  aset: z.array(z.string()).describe("Ids from `aset` (recurring people AND recurring props/vehicles/places) visible in this shot."),
  produk: z.enum(["tidak_tampil", "dipakai", "asli", "pahlawan"]).describe("tidak_tampil = absent; dipakai = in the hand or in use, recognisable by shape and colour but its lettering is never readable; asli = the REVEAL hero moment built from the seller's REAL product photo composited onto this shot's empty background (describe only the setting); pahlawan = LOCKUP only."),
  transformasi_en: z.string().describe("English. ONLY for the single BUKTI shot: the AFTER state of the exact same frame (same camera, same objects), e.g. 'the same engine fins now clean, bright silver metal, no grime'. Empty string for every other shot."),
  vo: z.string().describe("Bahasa Indonesia. One voice-over sentence starting in this shot, or empty string."),
  teks_layar: z.string().describe("Bahasa Indonesia on-screen text, or empty. Format 'UTAMA|pendukung': a 1–3 word KEY PHRASE, optionally '|' and 2–5 supporting words. E.g. 'DILAP TAK HILANG', 'CUKUP SEMPROT|kerak luruh sendiri', 'MOBILITAS|untuk berbagai jenis usaha'."),
});

export const SkemaAset = z.object({
  id: z.string(),
  jenis: z.enum(["pemeran", "properti"]),
  deskripsi_en: z.string().describe("English. Fixed appearance used verbatim in every shot. People: age, Indonesian, hair, clothing with colours. Props/vehicles: exact model type, colour, condition, distinguishing details. 15–40 words."),
});

export const SkemaNaskahIklan = z.object({
  merek: z.string().describe("Brand name for the end card, from the product data; never invented."),
  klaim_sumber: z.array(z.string()).describe("Bahasa Indonesia. Every benefit or claim that is LITERALLY present in the seller's description or printed on the product label in the photo. These are the ONLY claims the film may make."),
  lafal: z.array(z.object({ tulisan: z.string(), ucapan: z.string() })).describe("How the Indonesian narrator should pronounce foreign brand/product words used in the VO, e.g. {tulisan: 'Degreaser', ucapan: 'di-gri-ser'}. Empty if none."),
  nama_produk_pendek: z.string().describe("Short product name for the end card, ≤4 words."),
  ide_besar: z.string().describe("Bahasa Indonesia. The single big idea of the film in one sentence."),
  alasan_hook: z.string().describe("Bahasa Indonesia. Why the first 2 seconds stop a stranger scrolling with the sound off."),
  tagline: z.string().describe("Bahasa Indonesia. End-card tagline, ≤6 words: natural, meaningful, memorable; states the promise. No forced rhymes, no empty wordplay."),
  ajakan: z.string().describe("Bahasa Indonesia. One end-card call to action, ≤8 words, using only the purchase channel given in the product data (e.g. 'Tersedia di TikTok Shop dan Shopee'); if no channel is given, 'Cari: <nama produk pendek>'. If a price is given, start with it, e.g. 'Rp24.900 · Cari: Faza Engine Degreaser'."),
  gaya_visual_en: z.string().describe("English. One locked look for every shot: palette, light quality, exposure, lens/depth of field, grade, ONE time of day. 20–45 words."),
  suara_en: z.string().describe("English. Voice-over direction for the TTS narrator: gender, age, warmth."),
  aset: z.array(SkemaAset).describe("Every recurring person and every recurring prop/vehicle/engine/place that appears in more than one shot."),
  shots: z.array(SkemaShotIklan),
});

export type ShotIklan = z.infer<typeof SkemaShotIklan>;
export type NaskahIklan = z.infer<typeof SkemaNaskahIklan>;
export type AsetIklan = z.infer<typeof SkemaAset>;

export interface ProdukIklan {
  nama: string;
  merek?: string | null;
  kategori?: string | null;
  deskripsi?: string | null;
  klaim?: string | null;
  /** Ringkasan visual dari foto produk, bila sudah ada. */
  visual?: string | null;
  /** Harga jual dari penjual, bila ada — ditampilkan di ajakan. */
  harga_idr?: number | null;
  /** Tempat membeli (mis. "TikTok Shop, Shopee"). Kosong = ajakan berupa "Cari: ...". */
  kanal?: string | null;
  /** Kontak untuk lockup (WA/situs/IG). Kosong = tidak ditampilkan. */
  kontak?: string | null;
}

/* ── aturan yang diukur ─────────────────────────────────────────────────── */

export const BATAS = {
  shotMin: 9,
  shotMaks: 14,
  totalMin: 29,
  totalMaks: 33,
  hookMin: 1.5,
  hookMaks: 2.5,
  shotDetikMin: 1.5,
  shotDetikMaks: 4,
  lockupMin: 3,
  lockupMaks: 4.5,
  buktiMin: 3,
  kataVoPerKalimatMaks: 11,
  kalimatVoMin: 5,
  kataVoTotalMaks: 60,
  /** Kata per detik narator TTS kita — diukur pada render uji Faza v2 (2,07). Narator Blueprint 2,3–2,5. */
  kataPerDetik: 2.1,
  /** Produk harus sudah terlihat sebelum detik ini (product director: penonton yang pergi di detik 9 tidak pernah tahu produknya). */
  produkPalingLambat: 8,
  /** Bagian shot non-lockup yang wajib bertulisan — iklan ditonton tanpa suara. */
  porsiTeksMin: 0.5,
  kataAjakanMaks: 8,
} as const;

/**
 * KLAIM YANG TIDAK BOLEH MUNCUL TANPA BUKTI DARI PENJUAL.
 *
 * Render uji Faza v3, dua reviewer terpisah: "bertahun-tahun", "cukup semprot,
 * kerak luruh sendiri", "standar bengkel" — tak satu pun ada di deskripsi
 * penjual maupun di label. Iklan yang menjanjikan hasil yang tidak bisa
 * dibuktikan penjual adalah risiko UU Perlindungan Konsumen, bukan soal gaya.
 * Pola di sini menangkap yang bisa ditangkap regex; sisanya diaudit model
 * (auditKlaim) terhadap klaim_sumber.
 */
export const KLAIM_BERISIKO: { pola: RegExp; alasan: string }[] = [
  { pola: /\b(dijamin|garansi|pasti|100\s*%|permanen|selamanya)\b/i, alasan: "janji mutlak" },
  { pola: /\b(terbaik|paling|nomor\s*1|no\.?\s*1|juara|nomor satu)\b/i, alasan: "superlatif" },
  { pola: /\b(bertahun-tahun|sekejap|instan|detik saja|dalam \d+)\b/i, alasan: "janji waktu/lama" },
  { pola: /\b(standar bengkel|ala bengkel|profesional|dokter|ahli|direkomendasikan|teruji klinis|bpom)\b/i, alasan: "otoritas/endorsemen" },
  { pola: /\btanpa\s+(perlu\s+)?(bongkar|dilap|digosok|disikat|dibilas|usaha)\b/i, alasan: "menghapus langkah pemakaian" },
  { pola: /\b(luruh|hilang|bersih)\s+sendiri\b/i, alasan: "hasil tanpa usaha" },
];

/** Frasa yang membuat tiga video produksi 14 Sep 2026 terdengar identik. Tidak berlaku di LOCKUP. */
export const FRASA_TERLARANG = [
  "eh", "sumpah", "guys", "gue", "lo ", "cek keranjang", "keranjang kuning", "checkout", "link di bawah",
  "wajib punya", "racun", "gak nyesel", "worth it", "no debat",
];

const PANDUAN = `You are the creative director and scriptwriter of a top Indonesian commercial studio.
You write 29–33 second vertical (9:16) cinematic product films that run as paid social ads (TikTok, Instagram,
Shopee video) for Indonesian sellers. Most viewers watch with the SOUND OFF and decide in two seconds.
Each film is rendered shot by shot: every shot becomes one AI-generated still keyframe animated into a short clip,
then cut together with a voice-over, music, on-screen text and an end card that uses the seller's REAL product photo.

THE QUALITY BAR — three reference films the client approved. Match or beat them:

1. EIGER backpack (30s, 9 shots, emotional brand story). A village schoolgirl looks toward the window, waiting.
   VO: "Tidak semua perjalanan tentang seberapa jauh." A woman walks a dirt road past rice terraces, Eiger backpack
   from behind. Boots on gravel. She arrives at the school; the girl lights up. Insert: hands pull a bird book out of
   the backpack. VO: "Tapi apa yang kita bawa?" The girl's eyes. VO: "Dan untuk siapa?" Teacher and pupils read the book
   together. Packshot + tagline. VO: "Eiger, untuk langkah yang berarti." — The product lives inside the story; the
   waiting set up in shot 1 pays off at the end.

2. BLUEPRINT mPOS (36s, ~22 shots, product ad). A bazaar seller drowning in cables, printer, scanner, laptop, frustrated
   face; text "OPERASIONAL RIBET" then "REVENUE SERET". VO: "Saat ruang usaha terbatas, operasional menjadi rumit."
   QR payment succeeds, receipt prints: "Kini saatnya beralih ke cara yang lebih praktis." Studio reveal of the device.
   Phone, scanner and printer merge into one device: "Semua yang Anda butuhkan hadir dalam satu perangkat." Montage:
   café, food truck, boutique, minimarket, text "MOBILITAS untuk berbagai jenis usaha". Word cards RINGKAS · PRAKTIS ·
   SIAP DIGUNAKAN · KAPAN SAJA. Proof: "29 service center di seluruh Nusantara." End card: product, logo, tagline, contacts.

3. HALUAN DIGITAL NETWORK (32s, 11 shots, company profile). A hand places a cream jar on stone in dramatic light:
   "Brand Anda memiliki sebuah cerita." A hijab creator talks to camera holding the jar. Swatch on the back of a hand.
   Agency office, editor cutting the video. Product boxed and shipped. Different brands. Logo + tagline over Indonesia at night.

WHAT YOUR FILM MUST DO:
- HOOK (shot 1, 1.5–2.5s): the problem up close and unmistakable in frame 0 (e.g. an engine visibly caked in black grime
  while a rag fails on it), with a face or body language that MATCHES the pain (never smiling at a problem), brightly
  framed, WITH a big on-screen KEY PHRASE naming the pain (e.g. "DILAP TAK HILANG"). At most one short VO line.
  Never the product name, a greeting, a logo, or "Pernah nggak…".
- The PRODUCT's REVEAL (produk = asli) happens before second 8: a calm hero moment where the seller's REAL product photo
  is composited onto the shot — describe only an uncluttered setting from the film's world with an empty centre and
  lighting that suits a product. It is the only shot where the label is readable.
- In every other shot the product is AI-drawn and its lettering always garbles, so it may only appear as "dipakai":
  in hand or in use, recognisable by shape and colour, with the label turned away, small, or out of focus. Never ask for a
  readable label outside the REVEAL and LOCKUP. Keep its real size relative to hands.
- Exactly ONE BUKTI shot (3–4s, produk = dipakai): the product visibly doing its job in one continuous locked frame —
  spray landing on the grime, shirt keeping its shape after washing, sound filling the room — and set transformasi_en to the
  AFTER state of the very same frame. The BEFORE state must show the problem unmistakably (e.g. heavy black oily grime
  covering the surface); the AFTER state is realistically improved, never unrealistically brand-new. The edit dissolves
  from before to after and labels it "Ilustrasi". It must show the PRODUCT causing the change, not water, a rag or a hand.
- CLAIMS: first list in klaim_sumber every benefit literally present in the seller's description or printed on the label.
  The VO, on-screen text and pictures may ONLY promise those. No absolute promises (dijamin, pasti, 100%, permanen),
  superlatives (terbaik, paling, nomor 1), durations (bertahun-tahun, instan), authority or endorsement (standar bengkel,
  profesional, ahli, direkomendasikan) or effortless results (luruh sendiri, tanpa dilap) unless literally in klaim_sumber.
- NILAI shots: 2–4 benefits from klaim_sumber SHOWN as actions in different real contexts, one per shot, each ending on a
  visible result.
- MAKNA: an emotional payoff, or turn the label's own slogan into a closing image. Anything set up earlier (a waiting
  child, a helmet handed over) must be used or paid off. Never invent numbers, awards, certifications, prices or guarantees.
- NO DEAD SHOTS: every shot except LOCKUP carries VO or on-screen text and a clear purpose.
- LOCKUP (last shot, 3–4.5s): calm premium surface/background from the SAME world, light and time of day as the film
  (not a different location). The seller's real product photo is composited on top later, so describe the setting only
  and keep the lower-middle of the frame empty and uncluttered. Its VO names the brand and invites the viewer to find or
  buy it (using the channel/price data when given).
- VOICE-OVER SELLS, IT DOES NOT NARRATE. Never describe what the picture already shows ("semprotkan merata…",
  "dilap berulang kali…"). Say the tension, the benefit or the meaning. 5–8 short sentences, warm polished Bahasa
  Indonesia (baku tapi hangat). No slang, no "Eh", "Sumpah", "Guys", "gue/lo". Marketplace talk ("keranjang",
  "checkout", "link") only in the LOCKUP line.
- ON-SCREEN TEXT carries the film with the sound off: at least half of the shots have teks_layar. KEY PHRASE in capitals,
  1–3 words, optionally "|" plus 2–5 supporting words. Benefits, tensions, proofs — never a bare spec ("250 ml") and
  never repeating the VO word for word.
- Tagline: natural, meaningful Indonesian that states the promise (like "Untuk langkah yang berarti"). No forced rhymes.
- ajakan: one calm call to action for the end card using only the channel given in the product data.
- SAFETY AND TRUST: riders wear helmets, drivers seatbelts; no unsafe, illegal or unhygienic acts; no disparaging
  competitors; no health or medical claims beyond the product data; no other brands' logos or badges on cars, clothes or
  packaging.
- lafal: give the narrator a phonetic spelling for any foreign brand or product word in the VO.

MAKING IT RENDERABLE — images come from an image model, motion from a video model:
- visual_en describes a single photograph of the FIRST frame: concrete subject, pose, setting, composition, light.
  Real everyday Indonesian people, homes, streets, warung, kos, kantor, bengkel — and the everyday objects the target buyer
  actually owns (e.g. a common automatic scooter rather than a vintage café racer), without brand logos.
- EXPOSURE: bright, clean, readable on a phone in daylight. Choose ONE time of day for the whole film and keep it to the
  end card. Avoid predominantly dark, low-key or night looks unless the product demands it.
- CONSISTENCY: every person AND every prop/vehicle/engine/room seen in more than one shot is listed in \`aset\` with a
  precise fixed description and referenced by id in each shot where it appears. The same engine must stay the same engine.
- Keep each shot physically simple: one clear action, at most two people in focus, hands doing one thing. No crowds,
  readable screens, written signs, labelled maps, or text inside the image. Liquids come from their real source.
- The product must look exactly like the product photo; when it matters, show it big (close_up/insert) with the label facing camera.
- gerak_en: slow, controlled motion that stays in the same place and moment for the whole shot.
- Durations: HOOK 1.5–2.5s; others 2–3.5s (never above 4); BUKTI 3–4s; LOCKUP 3–4.5s. Total 29–33s. 9–14 shots.
- Voice-over timing: the narrator speaks 2.1 words per second. A VO sentence starting in shot i must fit before the next VO
  sentence starts: words ≤ 2.1 × (sum of durations from shot i up to the next shot with VO − 0.5).
- Never two consecutive shots with the same size; use at least three sizes.

Pick the film type that fits the product best: an emotional story (like Eiger), a problem-to-solution product film
(like Blueprint), or a scale/versatility film (like Haluan). Write for this product, not a template.`;

function blokProduk(p: ProdukIklan): string {
  const baris = [
    `Nama produk (dari penjual): ${p.nama}`,
    p.merek ? `Merek: ${p.merek}` : "",
    p.kategori ? `Kategori: ${p.kategori}` : "",
    p.deskripsi ? `Deskripsi: ${p.deskripsi}` : "",
    p.klaim ? `Klaim yang boleh dipakai: ${p.klaim}` : "Klaim yang boleh dipakai: hanya yang tertulis di deskripsi di atas.",
    p.visual ? `Tampilan produk (dari foto): ${p.visual}` : "",
    p.harga_idr ? `Harga: Rp${p.harga_idr.toLocaleString("id-ID")}` : "Harga: tidak diberikan penjual.",
    p.kanal ? `Tempat membeli: ${p.kanal}` : "Tempat membeli: tidak diberikan penjual.",
    p.kontak ? `Kontak untuk end card: ${p.kontak}` : "",
  ];
  return baris.filter(Boolean).join("\n");
}

/* ── pemeriksaan ────────────────────────────────────────────────────────── */

const kata = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** Teks layar tanpa pemisah "|". */
export const teksPolos = (s: string) => s.replace(/\|/g, " ").trim();

/** Token nama produk/merek yang tidak boleh muncul di hook. */
function tokenNama(p: ProdukIklan, n: NaskahIklan): string[] {
  const sumber = [p.merek ?? "", n.merek, n.nama_produk_pendek].join(" ").toLowerCase();
  return [...new Set(sumber.split(/[^a-z0-9]+/).filter((t) => t.length >= 4))];
}

export function periksaNaskah(n: NaskahIklan, p: ProdukIklan): string[] {
  const galat: string[] = [];
  const s = n.shots;
  if (s.length < BATAS.shotMin || s.length > BATAS.shotMaks) {
    galat.push(`Jumlah shot ${s.length}; wajib ${BATAS.shotMin}–${BATAS.shotMaks}.`);
  }
  const total = s.reduce((t, x) => t + x.durasi, 0);
  if (total < BATAS.totalMin || total > BATAS.totalMaks) {
    galat.push(`Total durasi ${total.toFixed(1)} detik; wajib ${BATAS.totalMin}–${BATAS.totalMaks}.`);
  }
  if (s[0]?.beat !== "HOOK") galat.push("Shot pertama wajib beat HOOK.");
  if (s[0] && !teksPolos(s[0].teks_layar)) galat.push("Shot HOOK wajib punya teks_layar (frasa kunci rasa sakit) — iklan ditonton tanpa suara.");
  if (s.at(-1)?.beat !== "LOCKUP") galat.push("Shot terakhir wajib beat LOCKUP.");
  if (s.filter((x) => x.beat === "LOCKUP").length !== 1) galat.push("Wajib tepat satu shot LOCKUP.");
  const lockup = s.at(-1);
  if (lockup && lockup.produk !== "pahlawan") galat.push("Shot LOCKUP wajib produk = pahlawan.");

  const bukti = s.filter((x) => x.beat === "BUKTI");
  if (bukti.length !== 1) galat.push(`Wajib tepat satu shot BUKTI (ada ${bukti.length}).`);
  const bertransformasi = s.filter((x) => x.transformasi_en.trim());
  if (bertransformasi.length !== 1 || (bukti[0] && !bukti[0].transformasi_en.trim())) {
    galat.push("transformasi_en wajib diisi tepat pada satu shot, yaitu shot BUKTI.");
  }
  if (bukti[0] && bukti[0].produk !== "dipakai") galat.push("Shot BUKTI wajib memperlihatkan produk bekerja (produk = dipakai).");
  const asli = s.filter((x) => x.produk === "asli");
  if (asli.length !== 1 || asli[0].beat !== "REVEAL") galat.push("Wajib tepat satu shot produk = asli, dan itu shot REVEAL.");
  if (lockup && !lockup.vo.trim()) galat.push("VO LOCKUP wajib ada: sebut merek dan ajak mencari/membeli.");
  s.forEach((x, i) => {
    if (x.beat !== "LOCKUP" && !x.vo.trim() && !teksPolos(x.teks_layar)) galat.push(`Shot ${i + 1}: shot kosong tanpa VO dan tanpa teks layar.`);
  });
  const semuaKlaim = s.map((x) => `${x.vo} ${teksPolos(x.teks_layar)}`).join(" ");
  const sumber = `${p.deskripsi ?? ""} ${p.klaim ?? ""} ${n.klaim_sumber.join(" ")}`.toLowerCase();
  for (const k of KLAIM_BERISIKO) {
    const cocok = semuaKlaim.match(k.pola);
    if (cocok && !sumber.includes(cocok[0].toLowerCase())) galat.push(`Klaim berisiko (${k.alasan}): "${cocok[0]}" tidak ada di data penjual.`);
  }

  let t = 0;
  let produkMulai = Infinity;
  s.forEach((x) => { if (x.produk !== "tidak_tampil" && produkMulai === Infinity) produkMulai = t; t += x.durasi; });
  if (produkMulai >= BATAS.produkPalingLambat) {
    galat.push(`Produk baru terlihat di detik ${produkMulai === Infinity ? "—" : produkMulai.toFixed(1)}; wajib sebelum detik ${BATAS.produkPalingLambat}.`);
  }

  s.forEach((x, i) => {
    const [min, maks] = x.beat === "LOCKUP" ? [BATAS.lockupMin, BATAS.lockupMaks]
      : x.beat === "HOOK" ? [BATAS.hookMin, BATAS.hookMaks]
      : x.beat === "BUKTI" ? [BATAS.buktiMin, BATAS.shotDetikMaks]
      : [BATAS.shotDetikMin, BATAS.shotDetikMaks];
    if (x.durasi < min || x.durasi > maks) galat.push(`Shot ${i + 1} (${x.beat}): durasi ${x.durasi} detik; wajib ${min}–${maks}.`);
    if (i > 0 && s[i - 1].ukuran === x.ukuran) galat.push(`Shot ${i}–${i + 1}: ukuran shot sama berurutan (${x.ukuran}).`);
    if (kata(x.vo).length > BATAS.kataVoPerKalimatMaks) galat.push(`Shot ${i + 1}: VO ${kata(x.vo).length} kata; maksimal ${BATAS.kataVoPerKalimatMaks}.`);
    const [utama = "", pendukung = ""] = x.teks_layar.split("|");
    if (kata(utama).length > 3) galat.push(`Shot ${i + 1}: frasa kunci teks layar lebih dari 3 kata.`);
    if (kata(pendukung).length > 5) galat.push(`Shot ${i + 1}: teks pendukung lebih dari 5 kata.`);
    if (/^\s*[\d.,]+\s*(ml|gr?|kg|l|cm|mm|inch|w|watt)?\s*$/i.test(teksPolos(x.teks_layar))) {
      galat.push(`Shot ${i + 1}: teks layar "${x.teks_layar}" hanya spesifikasi — tulis manfaat, ketegangan, atau bukti.`);
    }
    for (const id of x.aset) {
      if (!n.aset.some((a) => a.id === id)) galat.push(`Shot ${i + 1}: aset "${id}" tidak didefinisikan.`);
    }
  });

  const nonLockup = s.filter((x) => x.beat !== "LOCKUP");
  const bertulisan = nonLockup.filter((x) => teksPolos(x.teks_layar)).length;
  if (nonLockup.length && bertulisan / nonLockup.length < BATAS.porsiTeksMin) {
    galat.push(`Hanya ${bertulisan} dari ${nonLockup.length} shot bertulisan; minimal separuh — iklan ditonton tanpa suara.`);
  }

  // Kalimat VO harus muat sebelum kalimat berikutnya mulai, pada tempo narator
  // yang terukur. Render uji pertama tidak memeriksanya: iklan 33 detik keluar
  // 43 detik karena timeline memanjangkan shot demi kalimat yang terlalu panjang.
  const bersuara = s.map((x, i) => (x.vo.trim() ? i : -1)).filter((i) => i >= 0);
  bersuara.forEach((i, u) => {
    const akhir = u + 1 < bersuara.length ? bersuara[u + 1] : s.length;
    const rentang = s.slice(i, akhir).reduce((tt, x) => tt + x.durasi, 0);
    const muat = Math.floor(BATAS.kataPerDetik * Math.max(0, rentang - 0.5));
    const jumlah = kata(s[i].vo).length;
    if (jumlah > muat) {
      galat.push(`Shot ${i + 1}: VO ${jumlah} kata tidak muat dalam ${rentang.toFixed(1)} dtk sebelum VO berikutnya (maks ${muat} kata) — pendekkan kalimat atau beri shot tanpa VO sesudahnya.`);
    }
  });

  const ukuranBerbeda = new Set(s.map((x) => x.ukuran)).size;
  if (ukuranBerbeda < 3) galat.push(`Hanya ${ukuranBerbeda} ukuran shot berbeda; minimal 3.`);
  const kalimatVo = s.filter((x) => x.vo.trim()).length;
  if (kalimatVo < BATAS.kalimatVoMin) galat.push(`Hanya ${kalimatVo} kalimat VO; minimal ${BATAS.kalimatVoMin}.`);
  const kataVo = s.reduce((tt, x) => tt + kata(x.vo).length, 0);
  if (kataVo > BATAS.kataVoTotalMaks) galat.push(`VO total ${kataVo} kata; maksimal ${BATAS.kataVoTotalMaks} agar tidak terburu-buru.`);
  if (n.aset.filter((a) => a.jenis === "pemeran").length > 2) galat.push("Maksimal 2 pemeran berulang.");
  if (kata(n.tagline).length > 6) galat.push("Tagline lebih dari 6 kata.");
  if (!n.ajakan.trim() || kata(n.ajakan).length > BATAS.kataAjakanMaks) galat.push(`ajakan wajib diisi, maksimal ${BATAS.kataAjakanMaks} kata.`);
  if (p.harga_idr && !/rp/i.test(n.ajakan)) galat.push("Harga dari penjual wajib tampil di ajakan.");

  const bukanLockup = s.filter((x) => x.beat !== "LOCKUP").map((x) => `${x.vo} ${teksPolos(x.teks_layar)}`).join(" ").toLowerCase();
  for (const f of FRASA_TERLARANG) {
    const pola = new RegExp(`(^|[^a-z])${f.trim().replace(/\s+/g, "\\s+")}([^a-z]|$)`, "i");
    if (pola.test(bukanLockup)) galat.push(`Frasa terlarang dipakai di luar LOCKUP: "${f.trim()}".`);
  }
  const hook = `${s[0]?.vo ?? ""} ${teksPolos(s[0]?.teks_layar ?? "")}`.toLowerCase();
  for (const tok of tokenNama(p, n)) {
    if (hook.includes(tok)) galat.push(`Hook menyebut nama produk/merek ("${tok}").`);
  }
  return galat;
}

/* ── pemanggilan model ─────────────────────────────────────────────────── */

export class NaskahIklanGagal extends Error {}

const SkemaAudit = z.object({
  tidak_didukung: z.array(z.object({
    kutipan: z.string().describe("The exact VO or on-screen text fragment"),
    alasan: z.string().describe("Bahasa Indonesia. Why it goes beyond the seller's data"),
  })),
});

/**
 * AUDIT KLAIM oleh model yang TIDAK menulis naskahnya.
 *
 * Regex KLAIM_BERISIKO menangkap kata-kata yang jelas; audit ini menangkap
 * janji yang dirangkai tanpa kata terlarang ("satu botol untuk semua",
 * "berkendara lebih tenang"). Sumber kebenarannya HANYA deskripsi penjual dan
 * teks label di foto — bukan klaim_sumber yang ditulis penulis naskah sendiri.
 */
export async function auditKlaim(n: NaskahIklan, p: ProdukIklan, gambarProduk?: Buffer | null): Promise<{ temuan: { kutipan: string; alasan: string }[]; usage: { input: number; output: number } }> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const isi: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (gambarProduk) isi.push({ type: "image", source: { type: "base64", media_type: mimeGambar(gambarProduk), data: gambarProduk.toString("base64") } });
  isi.push({
    type: "text",
    text: [
      "DATA PENJUAL (satu-satunya sumber klaim yang sah):",
      blokProduk(p),
      gambarProduk ? "Ditambah teks yang benar-benar tercetak pada label di foto terlampir." : "",
      "",
      "KALIMAT IKLAN YANG DIAUDIT:",
      ...n.shots.flatMap((x, i) => [x.vo && `Shot ${i + 1} VO: ${x.vo}`, teksPolos(x.teks_layar) && `Shot ${i + 1} teks: ${teksPolos(x.teks_layar)}`]).filter(Boolean),
      `Tagline: ${n.tagline}`,
      `Ajakan: ${n.ajakan}`,
    ].filter((b) => b !== "").join("\n"),
  });
  const stream = client.beta.messages.stream({
    model: MODEL_NASKAH_IKLAN,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(SkemaAudit) },
    system: "You audit Indonesian advertising copy for Indonesian consumer-protection compliance. List every fragment that promises a benefit, result, "
      + "degree, duration, versatility, authority or feeling that is NOT supported by the seller's data or the label text. Neutral descriptions of the problem, "
      + "the product name, the brand's own printed slogan and plain calls to action are fine. Be strict but do not flag emotional scene-setting that makes no product promise.",
    messages: [{ role: "user", content: isi }],
  });
  const j = await stream.finalMessage();
  const teks = j.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const usage = { input: j.usage.input_tokens + (j.usage.cache_read_input_tokens ?? 0), output: j.usage.output_tokens };
  try {
    return { temuan: SkemaAudit.parse(JSON.parse(teks)).tidak_didukung, usage };
  } catch {
    return { temuan: [], usage };
  }
}

export async function tulisNaskahIklan(p: ProdukIklan, opts: { gambarProduk?: Buffer | null; catatan?: string } = {}): Promise<{ naskah: NaskahIklan; percobaan: number; usage: { input: number; output: number } }> {
  if (!config.anthropicApiKey) throw new NaskahIklanGagal("ANTHROPIC_API_KEY belum diisi.");
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const isiAwal: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (opts.gambarProduk) {
    isiAwal.push({
      type: "image",
      source: { type: "base64", media_type: mimeGambar(opts.gambarProduk), data: opts.gambarProduk.toString("base64") },
    });
  }
  isiAwal.push({
    type: "text",
    text: [
      "Tulis naskah film iklan untuk produk ini.",
      opts.gambarProduk ? "Gambar terlampir adalah foto produk dari penjual — itulah produk yang harus tampil persis sama." : "",
      "",
      blokProduk(p),
      opts.catatan ? `\nCatatan sutradara untuk versi ini:\n${opts.catatan}` : "",
    ].filter((b) => b !== "").join("\n"),
  });

  const pesan: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: isiAwal }];
  const usage = { input: 0, output: 0 };
  let galatTerakhir: string[] = [];

  for (let percobaan = 1; percobaan <= 3; percobaan++) {
    const stream = client.beta.messages.stream({
      model: MODEL_NASKAH_IKLAN,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: betaZodOutputFormat(SkemaNaskahIklan) },
      system: [{ type: "text", text: PANDUAN, cache_control: { type: "ephemeral" } }],
      messages: pesan,
    });
    const jawaban = await stream.finalMessage();
    usage.input += jawaban.usage.input_tokens + (jawaban.usage.cache_read_input_tokens ?? 0) + (jawaban.usage.cache_creation_input_tokens ?? 0);
    usage.output += jawaban.usage.output_tokens;
    if (jawaban.stop_reason === "refusal") throw new NaskahIklanGagal("Model menolak menulis naskah untuk produk ini.");
    if (jawaban.stop_reason === "max_tokens") throw new NaskahIklanGagal("Naskah terpotong (max_tokens).");

    const teks = jawaban.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    let naskah: NaskahIklan;
    try {
      naskah = SkemaNaskahIklan.parse(JSON.parse(teks));
    } catch (err) {
      galatTerakhir = [`Keluaran bukan JSON yang sesuai skema: ${(err as Error).message.slice(0, 300)}`];
      pesan.push({ role: "assistant", content: jawaban.content as Anthropic.Beta.BetaContentBlockParam[] });
      pesan.push({ role: "user", content: `Perbaiki: ${galatTerakhir[0]}` });
      continue;
    }
    galatTerakhir = periksaNaskah(naskah, p);
    if (galatTerakhir.length === 0) {
      const audit = await auditKlaim(naskah, p, opts.gambarProduk);
      usage.input += audit.usage.input;
      usage.output += audit.usage.output;
      galatTerakhir = audit.temuan.map((t) => `Klaim tidak didukung data penjual: "${t.kutipan}" — ${t.alasan}`);
      if (galatTerakhir.length === 0) return { naskah, percobaan, usage };
    }

    console.warn(`[iklan/naskah] percobaan ${percobaan}: ${galatTerakhir.length} pelanggaran — ${galatTerakhir.join(" | ")}`);
    pesan.push({ role: "assistant", content: jawaban.content as Anthropic.Beta.BetaContentBlockParam[] });
    pesan.push({
      role: "user",
      content: `Naskah ini melanggar aturan berikut. Tulis ulang naskah lengkap yang memperbaiki SEMUANYA tanpa menurunkan mutu cerita:\n- ${galatTerakhir.join("\n- ")}`,
    });
  }
  throw new NaskahIklanGagal(`Naskah masih melanggar aturan setelah 3 percobaan: ${galatTerakhir.join(" | ")}`);
}

function mimeGambar(b: Buffer): "image/png" | "image/webp" | "image/jpeg" {
  if (b.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (b.length > 12 && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}
