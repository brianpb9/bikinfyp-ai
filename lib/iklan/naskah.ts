/**
 * PENULIS NASKAH IKLAN SINEMATIK — 30–36 detik, ≥8 shot, busur cerita, lockup.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA MODUL SENDIRI, BUKAN MEMPERLUAS lib/script-engine
 * ────────────────────────────────────────────────────────────────────────────
 * Mesin naskah lama dibangun untuk video afiliasi 15 detik: HOOK/BODY/CTA,
 * 3–6 segmen 4–6 detik, CTA wajib frasa keranjang. Standar yang Brian tetapkan
 * 14 Sep 2026 (knowledge/rules/REFERENSI-IKLAN-SINEMATIK-v1.md) menuntut hal
 * yang bertentangan dengan hampir setiap aturan itu: shot 2–4 detik, delapan
 * atau lebih, tanpa frasa keranjang, dengan lockup. Memaksakan keduanya dalam
 * satu skema berarti setiap aturan butuh cabang per format — dan afiliasi
 * sengaja TIDAK diubah (keputusan 1A).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ATURAN YANG BISA DIHITUNG DIPERIKSA KODE, BUKAN DIPERCAYAKAN KE MODEL
 * ────────────────────────────────────────────────────────────────────────────
 * Skema keluaran hanya menjamin BENTUK. Jumlah shot, total durasi, frasa
 * terlarang, nama produk di hook — semuanya diperiksa periksaNaskah(), dan
 * pelanggarannya dikirim balik ke model sebagai perbaikan, maksimal dua kali.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config";

export const MODEL_NASKAH_IKLAN = "claude-opus-5";

export const SkemaShotIklan = z.object({
  beat: z.enum(["HOOK", "KONTEKS", "REVEAL", "NILAI", "BUKTI", "LOCKUP"]),
  durasi: z.number().describe("Detik. 2–4 untuk shot biasa, 3–5 untuk LOCKUP."),
  ukuran: z.enum(["wide", "medium", "close_up", "macro", "insert"]),
  kamera: z.string().describe("English. One camera move, e.g. 'slow push-in', 'static tripod', 'handheld follow from behind', 'slow orbit left'."),
  visual_en: z.string().describe("English. The FIRST FRAME as a photograph: subject, action pose, setting, composition, light. 25–60 words. No text, no logos except the product's own label."),
  gerak_en: z.string().describe("English. What moves during the shot (one or two motions). 8–25 words."),
  pemeran: z.array(z.string()).describe("Ids from `pemeran` that appear in this shot. Empty if none."),
  produk: z.enum(["tidak_tampil", "dipakai", "jelas", "pahlawan"]).describe("tidak_tampil = product absent; dipakai = in use, not the focus; jelas = clearly visible focus; pahlawan = hero packshot."),
  vo: z.string().describe("Bahasa Indonesia. One voice-over sentence spoken starting in this shot, or empty string."),
  teks_layar: z.string().describe("Bahasa Indonesia. Short on-screen text for this shot (≤5 words), or empty string."),
});

export const SkemaNaskahIklan = z.object({
  merek: z.string().describe("Brand name as it should appear on the end card. Take it from the product data; never invent one."),
  nama_produk_pendek: z.string().describe("Short product name for the end card, ≤4 words."),
  ide_besar: z.string().describe("Bahasa Indonesia. The single big idea of the film in one sentence."),
  alasan_hook: z.string().describe("Bahasa Indonesia. Why the first 3 seconds make a stranger keep watching."),
  tagline: z.string().describe("Bahasa Indonesia. End-card tagline, ≤6 words."),
  gaya_visual_en: z.string().describe("English. One locked look for every shot: palette, light quality, lens/depth of field, grade, time of day. 20–45 words."),
  suara_en: z.string().describe("English. Voice-over direction for the TTS narrator: gender, age, warmth, pace."),
  pemeran: z.array(z.object({
    id: z.string(),
    deskripsi_en: z.string().describe("English. Fixed appearance used verbatim in every shot: age, ethnicity (Indonesian), hair, clothing with colours. 15–35 words."),
  })),
  shots: z.array(SkemaShotIklan),
});

export type ShotIklan = z.infer<typeof SkemaShotIklan>;
export type NaskahIklan = z.infer<typeof SkemaNaskahIklan>;

export interface ProdukIklan {
  nama: string;
  merek?: string | null;
  kategori?: string | null;
  deskripsi?: string | null;
  klaim?: string | null;
  /** Ringkasan visual dari foto produk, bila sudah ada. */
  visual?: string | null;
  /** Kontak untuk lockup (WA/situs/IG). Kosong = tidak ditampilkan. */
  kontak?: string | null;
}

/* ── aturan yang diukur dari tiga referensi ─────────────────────────────── */

export const BATAS = {
  shotMin: 9,
  shotMaks: 14,
  totalMin: 29,
  totalMaks: 35,
  shotDetikMin: 1.5,
  shotDetikMaks: 4.5,
  lockupMin: 3,
  lockupMaks: 5.5,
  kataVoPerKalimatMaks: 14,
  kalimatVoMin: 5,
  kataVoTotalMaks: 78,
} as const;

/** Frasa yang membuat tiga video produksi 14 Sep 2026 terdengar identik. */
export const FRASA_TERLARANG = [
  "eh", "sumpah", "guys", "gue", "lo ", "cek keranjang", "keranjang kuning", "checkout", "link di bawah",
  "wajib punya", "racun", "gak nyesel", "worth it", "no debat",
];

const PANDUAN = `You are the creative director and scriptwriter of a top Indonesian commercial studio.
You write 30–35 second vertical (9:16) cinematic product films for Indonesian audiences.
Each film is rendered shot by shot: every shot becomes one AI-generated still keyframe animated
into a short clip, then cut together with a voice-over, music, on-screen text and an end card.

THE QUALITY BAR — three reference films the client approved. Match or beat them:

1. EIGER backpack (30s, 9 shots, emotional brand story). A village schoolgirl looks toward the window,
   waiting. VO: "Tidak semua perjalanan tentang seberapa jauh." A woman walks a dirt road past rice
   terraces, Eiger backpack seen from behind. Close-up of boots on gravel. She arrives at the school.
   The teacher enters, the girl lights up. Insert: hands pull a bird book out of the backpack. VO: "Tapi
   apa yang kita bawa?" Close-up of the girl's eyes. VO: "Dan untuk siapa?" Teacher and pupils read the
   book together. Packshot: backpack on the classroom desk, scene blurred behind, serif tagline.
   VO: "Eiger, untuk langkah yang berarti." — The product is never praised. It lives inside the story.

2. BLUEPRINT mPOS (36s, ~22 shots, product ad). A bazaar seller drowning in cables, printer, scanner,
   laptop; text "OPERASIONAL RIBET" then "REVENUE SERET". VO: "Saat ruang usaha terbatas, operasional
   menjadi rumit." QR payment succeeds, receipt prints: "Kini saatnya beralih ke cara yang lebih praktis."
   Studio reveal of the device. Phone, scanner and printer float and merge into one device: "Semua yang
   Anda butuhkan hadir dalam satu perangkat." Fast montage: café, food truck, boutique, minimarket, text
   "MOBILITAS untuk berbagai jenis usaha". One-word benefit cards: RINGKAS · PRAKTIS · SIAP DIGUNAKAN ·
   KAPAN SAJA. Proof: dark map of Indonesia with glowing pins: "29 service center di seluruh Nusantara."
   End card: product, logo, tagline, contact line.

3. HALUAN DIGITAL NETWORK (32s, 11 shots, company profile). A hand places a cream jar on stone in dramatic
   light: "Brand Anda memiliki sebuah cerita." Moodboard. A hijab creator talks to camera holding the jar.
   Swatch on the back of a hand. Busy agency office, editor cutting the creator video. Product boxed and
   shipped. Different brands: headphones, a cook presenting food, a woman in a bathroom. Night Earth with
   Indonesia glowing: logo + "Your brand's growth engine in Indonesia."

WHAT THEY SHARE — your film must do all of it:
- HOOK (first shot, 0–3s): one image that already tells a story — an emotion, a recognisable pain, or a
  premium object in cinematic light — plus at most one short VO line that names a pain or flips an
  expectation. Never open with the product name, a greeting, a logo, or a question like "Pernah nggak…".
- A visible CHANGE OF STATE across the film (waiting → joy, chaos → calm, dull → alive). Not a feature list.
- The product appears inside the story (being used, carried, worn) before it becomes the hero.
- Benefits are SHOWN as actions in different real Indonesian contexts, one benefit per shot.
- PROOF or MEANING near the end: a real number from the product data, scale, or an emotional payoff.
  Never invent numbers, awards, certifications, prices or guarantees that are not in the product data.
- LOCKUP (last shot, 3–5s): the product as hero, calm and premium, room left for the brand name and tagline.
- Shot variety: mix wide, medium, close-up, macro and insert. Never two consecutive shots with the same size.
- Voice-over: 5–9 short sentences in warm, polished Bahasa Indonesia (baku tapi hangat, like a TV commercial
  narrator). No slang, no "Eh", "Sumpah", "Guys", "gue/lo", no marketplace talk ("keranjang", "checkout",
  "link"). Leave vo empty on shots where the picture should breathe.
- On-screen text: short, meaningful, never repeating the VO word for word. Leave empty on most emotional shots.

MAKING IT RENDERABLE — the images come from an image model and the motion from a video model:
- visual_en describes a single photograph of the FIRST frame: concrete subject, pose, setting, composition,
  light. Real Indonesian people and places (warung, pasar, kos, kantor, bengkel, jalan kampung, KRL, etc.)
  when they fit the product.
- Keep each shot physically simple: one clear action, at most two people in focus, hands doing one thing.
  Avoid crowds interacting, readable screens, written signs, maps with labels, and text inside the image.
- The product must look exactly like the product photo. Do not change its colour, shape or label.
  If the product is small, use close_up/macro/insert shots for its moments.
- gerak_en is the motion only: what moves and how the camera moves. Slow, controlled, cinematic.
- Durations: 2–4 seconds per shot (LOCKUP 3–5). Total 30–35 seconds. 9–14 shots.
- pemeran: 0–2 recurring characters with fixed appearance, reused verbatim.

Pick the film type that fits the product best: an emotional story (like Eiger), a problem-to-solution
product film (like Blueprint), or a scale/versatility film (like Haluan). Write for this product, not a
template — the three films above show the bar, not the plot.`;

function blokProduk(p: ProdukIklan): string {
  const baris = [
    `Nama produk (dari penjual): ${p.nama}`,
    p.merek ? `Merek: ${p.merek}` : "",
    p.kategori ? `Kategori: ${p.kategori}` : "",
    p.deskripsi ? `Deskripsi: ${p.deskripsi}` : "",
    p.klaim ? `Klaim yang boleh dipakai: ${p.klaim}` : "Klaim yang boleh dipakai: hanya yang tertulis di deskripsi di atas.",
    p.visual ? `Tampilan produk (dari foto): ${p.visual}` : "",
    p.kontak ? `Kontak untuk end card: ${p.kontak}` : "",
  ];
  return baris.filter(Boolean).join("\n");
}

/* ── pemeriksaan ────────────────────────────────────────────────────────── */

const kata = (s: string) => s.trim().split(/\s+/).filter(Boolean);

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
  if (s.at(-1)?.beat !== "LOCKUP") galat.push("Shot terakhir wajib beat LOCKUP.");
  if (s.filter((x) => x.beat === "LOCKUP").length !== 1) galat.push("Wajib tepat satu shot LOCKUP.");
  const lockup = s.at(-1);
  if (lockup && (lockup.produk !== "pahlawan")) galat.push("Shot LOCKUP wajib produk = pahlawan.");
  s.forEach((x, i) => {
    const maks = x.beat === "LOCKUP" ? BATAS.lockupMaks : BATAS.shotDetikMaks;
    const min = x.beat === "LOCKUP" ? BATAS.lockupMin : BATAS.shotDetikMin;
    if (x.durasi < min || x.durasi > maks) galat.push(`Shot ${i + 1}: durasi ${x.durasi} detik; wajib ${min}–${maks}.`);
    if (i > 0 && s[i - 1].ukuran === x.ukuran) galat.push(`Shot ${i}–${i + 1}: ukuran shot sama berurutan (${x.ukuran}).`);
    if (kata(x.vo).length > BATAS.kataVoPerKalimatMaks) galat.push(`Shot ${i + 1}: VO ${kata(x.vo).length} kata; maksimal ${BATAS.kataVoPerKalimatMaks}.`);
    if (kata(x.teks_layar).length > 5) galat.push(`Shot ${i + 1}: teks layar lebih dari 5 kata.`);
    for (const id of x.pemeran) {
      if (!n.pemeran.some((p) => p.id === id)) galat.push(`Shot ${i + 1}: pemeran "${id}" tidak didefinisikan.`);
    }
  });
  const ukuranBerbeda = new Set(s.map((x) => x.ukuran)).size;
  if (ukuranBerbeda < 3) galat.push(`Hanya ${ukuranBerbeda} ukuran shot berbeda; minimal 3.`);
  const kalimatVo = s.filter((x) => x.vo.trim()).length;
  if (kalimatVo < BATAS.kalimatVoMin) galat.push(`Hanya ${kalimatVo} kalimat VO; minimal ${BATAS.kalimatVoMin}.`);
  const kataVo = s.reduce((t, x) => t + kata(x.vo).length, 0);
  if (kataVo > BATAS.kataVoTotalMaks) galat.push(`VO total ${kataVo} kata; maksimal ${BATAS.kataVoTotalMaks} agar tidak terburu-buru.`);
  if (n.pemeran.length > 2) galat.push("Maksimal 2 pemeran berulang.");
  if (kata(n.tagline).length > 6) galat.push("Tagline lebih dari 6 kata.");

  const semuaTeks = s.map((x) => `${x.vo} ${x.teks_layar}`).join(" ").toLowerCase();
  for (const f of FRASA_TERLARANG) {
    const pola = new RegExp(`(^|[^a-z])${f.trim().replace(/\s+/g, "\\s+")}([^a-z]|$)`, "i");
    if (pola.test(semuaTeks)) galat.push(`Frasa terlarang dipakai: "${f.trim()}".`);
  }
  const hook = `${s[0]?.vo ?? ""} ${s[0]?.teks_layar ?? ""}`.toLowerCase();
  for (const t of tokenNama(p, n)) {
    if (hook.includes(t)) galat.push(`Hook menyebut nama produk/merek ("${t}").`);
  }
  return galat;
}

/* ── pemanggilan model ─────────────────────────────────────────────────── */

export class NaskahIklanGagal extends Error {}

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
    if (galatTerakhir.length === 0) return { naskah, percobaan, usage };

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
