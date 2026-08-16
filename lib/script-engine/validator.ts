// Validator skrip L-01..L-16 (FSD F-02.3).
// Mode "strict": semua aturan keras (dipakai saat generate & QC-07 pra-render).
// Mode "light": hanya L-10/L-11 yang keras (edit pengguna, FSD BR-03.2); sisanya jadi warning.

import { COMPETITOR_BRANDS } from "../config/hooks";
import { formatHargaNatural } from "./templates";
import { misplacedEmphasisTags, stripDeliveryTags, unknownDeliveryTags } from "./delivery-tags";

export interface ScriptToValidate {
  hook_family: string;
  register: string;
  segments: { role: string; text: string; tts_text?: string }[];
  productName: string;
  priceIdr: number;
  /** Hanya aktif bila pemanggil punya sinyal template price-led yang nyata. */
  requirePriceMention?: boolean;
  /** Harga normal sebelum diskon (add-on promo) — angkanya ikut jadi data produk
   * yang sah untuk L-14 ("dari 120 ribu jadi 85 ribu"). */
  promoPriceBeforeIdr?: number | null;
  /** Tier kualitas — memengaruhi L-05 (batas kata) & L-17 (kurung instruksi). Default silent_caption. */
  qualityTier?: "silent_caption" | "high_quality" | "super_hq";
  /** Durasi video — L-05 (batas kata) skala proporsional dari basis 15 dtk. Default 15. */
  durationSec?: number;
  /** Genre naskah. "tvc" mengaktifkan aturan T-01..T-03 dan MEMATIKAN L-01/L-03/L-04.
   *
   * Kenapa ini ada (vonis Brian 2026-08-16: "tvc concept salah semua"):
   * L-03 mewajibkan penutup menyebut "keranjang" TANPA SYARAT, dan L-01/L-04
   * mewajibkan partikel gaul + filler. Tiga aturan itu benar untuk konten
   * afiliasi, tapi untuk TVC justru MELARANG naskahnya terdengar seperti TVC —
   * penutup yang benar menurut playbook produksi ("Koleksi baru dari Rana")
   * pasti ditolak. Akarnya struktural, bukan pilihan kata: visualnya sudah
   * sinematik 6 beat sementara naskahnya dipaksa jadi iklan keranjang.
   *
   * Default undefined = perilaku lama persis, jadi pemanggil non-TVC aman. */
  format?: "hands_only" | "vo_broll" | "talking_head" | "tvc" | "ads";
  /** Jatah kata template (total seluruh video). Kalau ada, L-05 memakai ini.
   *
   * WAJIB ada. Komentar L-05 di bawah sudah memperingatkan bahwa batas di sini
   * dan target di templates.ts harus sinkron — dan saya melanggarnya sendiri
   * (2026-08-11): target diturunkan ke 22 kata untuk empat template tanpa VO,
   * tapi batas L-05 dibiarkan 32-48. Akibatnya SETIAP varian keempat template
   * itu ditolak validator dan tidak ada satu pun skrip yang bisa dibuat. */
  wordBudget?: number;
}

export type ValidationMode = "strict" | "light";

export interface RuleIssue {
  rule: string;
  message_id: string;
  segment?: string;
}

export interface ValidationResult {
  passed: boolean;
  errors: RuleIssue[];
  warnings: RuleIssue[];
  checked_at: string;
}

const PARTICLES = new Set(["deh", "sih", "dong", "ya", "loh", "kok", "nah", "tuh"]);
const FILLER_TOKENS = new Set(["nah", "sumpah", "eh", "btw"]);
const FILLER_PHRASES = ["jadi gini"];

/** Dua negasi yang saling menumpuk, mis. "nggak pernah nggak siap" (T-03).
 *
 * Sengaja hanya mengizinkan NOL ATAU SATU kata sisipan, dan sisipannya wajib
 * huruf semua. Dua batasan itu yang memisahkan cacat dari retorika: "nggak
 * perlu ribet, nggak perlu mahal" adalah kalimat berpasangan yang sah dan
 * tertolak di sini karena ada koma dan dua kata di antaranya. */
const NEGASI = "nggak|ngga|gak|ga|tidak|tak|bukan|belum|jangan";
const DOUBLE_NEGATION_REGEX = new RegExp(`\\b(?:${NEGASI})\\b(?:\\s+[a-zA-Z]+)?\\s+\\b(?:${NEGASI})\\b`, "i");

const OVERCLAIM_TOKENS = new Set(["pasti", "pastiin", "dijamin", "jamin", "terbaik", "terampuh"]);
const OVERCLAIM_PHRASES = ["100%", "paling bagus", "nomor 1", "nomor satu", "no 1", "no. 1", "paling ampuh", "terbaik di dunia"];
const MEDICAL_TOKENS = new Set([
  "menyembuhkan", "mengobati", "obat", "penyakit", "klinis", "dokter",
  "antibiotik", "hormon", "farmasi",
]);
const MEDICAL_PHRASES = [
  "menghilangkan penyakit", "aman untuk ibu hamil", "ibu hamil", "resep dokter",
  "terbukti klinis", "aman untuk busui",
];
const FORMAL_PHRASES = [
  "dapatkan produk ini", "dapatkan sekarang", "segera miliki", "miliki sekarang",
  "pesan sekarang", "beli sekarang", "hubungi kami", "jangan lewatkan",
  "promo terbatas", "tawaran terbatas", "segera dapatkan",
];
const FAKE_URGENCY_PHRASES = [
  "stok terakhir", "dijamin habis", "habis hari ini", "cuma hari ini",
  "tinggal hari ini", "stok tinggal",
];
const NEGATIVE_WORDS = new Set(["jelek", "buruk", "sampah", "payah", "gagal", "zonk"]);

const GUE_TOKENS = new Set(["gue", "gua", "gw"]);
const AKU_TOKENS = new Set(["aku"]);
const LO_TOKENS = new Set(["lo", "lu", "elu"]);
const KAMU_TOKENS = new Set(["kamu", "kau", "anda"]);

const PRICE_REGEX = /\d+([.,]\d+)?\s*(ribu|rb|ribuan|juta|jt)\b/i;
const PRICE_MENTION_REGEX = /(\d+(?:[.,]\d+)?)\s*(ribu|rb|ribuan|juta|jt)\b/gi;

function spokenPriceAmount(priceIdr: number): number | null {
  const match = formatHargaNatural(priceIdr).match(PRICE_REGEX);
  if (!match) return null;
  const number = Number(match[0].match(/\d+(?:[.,]\d+)?/)?.[0].replace(",", "."));
  const multiplier = /juta|jt/i.test(match[0]) ? 1_000_000 : 1_000;
  return Number.isFinite(number) ? Math.round(number * multiplier) : null;
}

export const PRICE_REQUIRED_TEMPLATE_IDS = ["diskon-gede", "promo-terbatas"] as const;

export function templateRequiresPriceMention(templateId: string | null | undefined): boolean {
  return Boolean(templateId && (PRICE_REQUIRED_TEMPLATE_IDS as readonly string[]).includes(templateId));
}

/** TVC dikenali dari awalan id-nya.
 *
 * Konvensi penamaan memang rapuh, jadi tidak dibiarkan sebagai kesepakatan
 * lisan: tests/tvc-genre.test.ts membandingkan hasil fungsi ini dengan field
 * `format` di katalog template. Menambah TVC tanpa awalan "tvc-" — atau
 * memberi awalan itu ke template yang bukan TVC — gagal di CI, bukan lolos
 * diam-diam sampai ke penonton. */
export function isTvcTemplate(templateId: string | null | undefined): boolean {
  return Boolean(templateId?.startsWith("tvc-"));
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9%]+/g) ?? [];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function validateScript(script: ScriptToValidate, mode: ValidationMode): ValidationResult {
  const errors: RuleIssue[] = [];
  const warnings: RuleIssue[] = [];
  // alwaysHard=true hanya untuk L-10/L-11: keras bahkan saat edit pengguna (BR-03.2).
  const push = (alwaysHard: boolean, issue: RuleIssue) => {
    if (mode === "strict" || alwaysHard) errors.push(issue);
    else warnings.push(issue);
  };

  const fullText = script.segments.map((s) => stripDeliveryTags(s.text)).join(" ");
  const lower = fullText.toLowerCase();
  const toks = tokens(fullText);
  const hookSeg = script.segments.find((s) => s.role === "hook");
  const demoSeg = script.segments.find((s) => s.role === "demo");
  const ctaSeg = script.segments.find((s) => s.role === "cta");
  const hookDemo = [hookSeg?.text ?? "", demoSeg?.text ?? ""].join(" ");

  // TVC adalah genre lain, bukan varian gaya. Iklan televisi tidak menyebut
  // keranjang, tidak menawar dengan partikel gaul, dan wajib ditutup nama
  // merek. Aturan lisan L-01/L-03/L-04 dimatikan dan diganti T-01..T-03.
  const isTvc = script.format === "tvc";

  // L-01: >=2 partikel
  const particleCount = toks.filter((t) => PARTICLES.has(t)).length;
  if (!isTvc && particleCount < 2)
    push(false, { rule: "L-01", message_id: "Skripnya masih kaku — tambahin kata kayak 'deh', 'sih', atau 'dong' biar kayak orang ngobrol." });

  // L-02 bukan aturan global. Hanya template price-led/promo yang memberi
  // sinyal eksplisit boleh mewajibkan harga; template lain justru perlu ruang
  // untuk hook masalah, rasa penasaran, bukti, atau cerita tanpa boilerplate.
  if (script.requirePriceMention && !PRICE_REGEX.test(hookDemo))
    push(false, { rule: "L-02", message_id: "Harganya belum disebut di awal video — pembeli butuh dengar angkanya (mis. '85 ribu').", segment: "demo" });

  // L-03: CTA menyebut "keranjang" — "kuning" cuma untuk TikTok Shop (istilah
  // branding TikTok), Shopee/Tokopedia/manual pakai "keranjang" polos (lihat
  // cartLabelForUrl di script-engine/index.ts). Cek generik biar berlaku di
  // kedua kasus tanpa validator perlu tau platform-nya.
  if (!isTvc && (!ctaSeg || !ctaSeg.text.toLowerCase().includes("keranjang")))
    push(false, { rule: "L-03", message_id: "Ajakan penutup harus menyebut 'keranjang' biar pembeli tau harus klik di mana.", segment: "cta" });

  // L-04: >=1 filler lisan
  const hasFiller =
    toks.some((t) => FILLER_TOKENS.has(t)) || FILLER_PHRASES.some((p) => lower.includes(p));
  if (!isTvc && !hasFiller)
    push(false, { rule: "L-04", message_id: "Belum ada jeda lisan ('nah', 'jadi gini', 'sumpah') — tanpa itu kedengeran kayak robot." });

  if (isTvc) {
    const penutup = stripDeliveryTags(ctaSeg?.text ?? "");

    // T-01: penutup wajib menyebut nama produk/merek (playbook TVC aturan D4).
    // Kesalahan nyata yang melahirkan aturan ini: TVC Mom & Baby selesai tanpa
    // announcer penutup, jadi iklannya berakhir tanpa pernah menyebut nama
    // produk sama sekali.
    const merek = script.productName.trim().toLowerCase();
    if (!merek || !penutup.toLowerCase().includes(merek))
      push(false, {
        rule: "T-01",
        message_id: `Penutup TVC wajib menyebut nama produknya ("${script.productName}") — tanpa itu iklan berakhir tanpa pernah menyebut merek.`,
        segment: "cta",
      });

    // T-02: TVC bukan konten afiliasi. Menyebut keranjang mengubah genrenya
    // kembali jadi live-selling, yang justru cacat yang sedang diperbaiki.
    if (/keranjang/i.test(fullText))
      push(false, {
        rule: "T-02",
        message_id: "TVC tidak boleh menyebut 'keranjang' — itu bahasa konten afiliasi, bukan iklan merek.",
        segment: "cta",
      });

    // T-03: dua negasi. Playbook aturan D1 — kalimat "tapi nggak pernah nggak
    // siap" ditolak klien dengan kata-kata "ga jelas itu apa".
    for (const seg of script.segments) {
      const bersih = stripDeliveryTags(seg.text);
      if (DOUBLE_NEGATION_REGEX.test(bersih)) {
        push(false, {
          rule: "T-03",
          message_id: "Ada kalimat dengan dua negasi — nyatakan langsung keunggulannya, jangan lewat sangkalan berlapis.",
          segment: seg.role,
        });
        break;
      }
    }
  }

  // L-05: panjang total — tergantung tier. silent_caption 32-48 kata (teks
  // dibaca, bukan diucapkan). Tier bersuara: r13 (Brian 2026-08-07, VO
  // Gemini TTS berhenti detik 20 dari video 30 detik) — [10,22] lama
  // dikalibrasi utk audio embedded LAMA (~1,07 kata/dtk); Gemini TTS terukur
  // ~1,93 kata/dtk nyata, dinaikkan ke 20-34 kata/15dtk (~1,8 kata/dtk) SUPAYA
  // KONSISTEN dgn target di templates.ts (WAJIB sinkron — kalau tidak, skrip
  // yang lolos target template bisa ditolak validator, atau sebaliknya).
  // Basis 15 dtk; durasi lain skala proporsional (durationSec/15).
  //
  // r19 (Brian 2026-08-09, "sound dan video tidak match, sound kecepatan" —
  // lihat komentar sama di templates.ts): [20,34] terbukti bisa ngisi cuma
  // ~10,4dtk dari slot 15dtk (batas bawah) atau meluber ~17,6dtk (batas
  // atas). Dipersempit ke [25,30] (~1,93 kata/dtk asli) — WAJIB tetap sinkron
  // dgn templates.ts.
  const tier = script.qualityTier ?? "silent_caption";
  const durationScale = (script.durationSec ?? 15) / 15;
  const wc = wordCount(fullText);
  // Batas atas SEMPAT saya turunkan ke 27 untuk melawan "suara kecepatan",
  // lalu dikembalikan. Pengukuran yang mendasarinya terlalu sempit: saya cuma
  // memeriksa template 15 detik dan cuma menanyakan "apakah tersisa satu
  // varian", padahal katalog menuntut SELURUH 132 varian lolos dan durasi
  // 30/45 detik ikut terskala dari angka ini. Enam tes jatuh.
  //
  // Yang diperbaiki akhirnya varian yang memang duduk di 29-30 kata (2,00
  // kata/detik) — dipendekkan satu per satu di template-copy.ts, bukan
  // aturannya yang dilonggarkan.
  const [baseMinWc, baseMaxWc] = tier === "silent_caption" ? [32, 48] : [25, 30];
  // Jatah template memakai toleransi yang sama dengan templates.ts (+/-15%)
  // dan TIDAK diskalakan durasi — batasnya beban baca, bukan kecepatan bicara.
  // BATAS BAWAH menyerap panjang NAMA PRODUK; batas atas tidak.
  //
  // Nama produk ikut diucapkan, jadi ia menggeser total kata — tapi panjangnya
  // ditentukan pengguna, bukan penulis naskah. Terukur 16 Agu 2026: dengan
  // jendela lama, 10 dari 33 template gagal total tergantung panjang nama, dan
  // 33 dari 36 kegagalan itu karena naskah KEKURANGAN 1-4 kata. Brian tidak
  // bisa membuat video sama sekali untuk produknya, sementara pesan errornya
  // justru menyuruh MEMENDEKKAN nama — yang mengurangi kata lagi.
  //
  // Asimetrisnya disengaja dan berdasar bukti:
  //   - kelebihan kata = VO terpotong / terdengar diburu (r19, cacat terukur)
  //   - kekurangan kata = ekor hening sedikit; 1-4 kata ~ 0,5-2 detik
  // Jadi batas atas TETAP ketat, batas bawah diberi kelonggaran sebesar nama
  // produknya (maksimal 6 kata, sepanjang nama terpanjang yang wajar).
  const kelonggaranNama = Math.min(6, wordCount(script.productName ?? ""));
  const minWc = Math.max(
    1,
    (script.wordBudget
      ? Math.round(script.wordBudget * 0.85)
      : Math.round(baseMinWc * durationScale)) - kelonggaranNama
  );
  const maxWc = script.wordBudget
    ? Math.round(script.wordBudget * 1.15)
    : Math.round(baseMaxWc * durationScale);
  if (wc < minWc || wc > maxWc)
    push(false, {
      rule: "L-05",
      message_id:
        tier === "silent_caption"
          ? `Panjang skrip ${wc} kata — untuk video ${script.durationSec ?? 15} detik harus ${minWc}–${maxWc} kata.`
          : `Panjang skrip ${wc} kata — untuk video bersuara ${script.durationSec ?? 15} detik maksimal ~${maxWc} kata (${minWc}–${maxWc}).`,
    });

  // L-06: produk tidak disebut di hook (kecuali H4/H11)
  const exempt = ["H4", "H11"].includes(script.hook_family);
  if (hookSeg && !exempt) {
    const hookLower = hookSeg.text.toLowerCase();
    const name = script.productName.toLowerCase().trim();
    const nameTokens = tokens(script.productName);
    const longest = nameTokens.reduce((a, b) => (b.length > a.length ? b : a), "");
    if ((name.length >= 3 && hookLower.includes(name)) || (longest.length >= 4 && tokens(hookSeg.text).includes(longest)))
      push(false, { rule: "L-06", message_id: "Nama produk jangan disebut di 3 detik pertama — bikin penasaran dulu.", segment: "hook" });
  }

  // L-10: overclaim absolut (KERAS di semua mode)
  const overTok = toks.find((t) => OVERCLAIM_TOKENS.has(t));
  const overPhrase = OVERCLAIM_PHRASES.find((p) => lower.includes(p));
  if (overTok || overPhrase)
    push(true, { rule: "L-10", message_id: `Ada kata overclaim ("${overTok ?? overPhrase}") — kata kayak 'pasti'/'dijamin'/'terbaik' bisa bikin kena teguran TikTok.` });

  // L-11: klaim medis/kesehatan (KERAS di semua mode)
  const medTok = toks.find((t) => MEDICAL_TOKENS.has(t));
  const medPhrase = MEDICAL_PHRASES.find((p) => lower.includes(p));
  if (medTok || medPhrase)
    push(true, { rule: "L-11", message_id: `Ada klaim kesehatan ("${medTok ?? medPhrase}") — klaim medis dilarang keras di platform.` });

  // L-12: bahasa iklan formal
  const formal = FORMAL_PHRASES.find((p) => lower.includes(p));
  if (formal)
    push(false, { rule: "L-12", message_id: `Kalimat "${formal}" kedengeran kayak iklan TV — pakai bahasa ngobrol aja.` });

  // L-13: urgensi palsu
  const urgency = FAKE_URGENCY_PHRASES.find((p) => lower.includes(p));
  if (urgency)
    push(false, { rule: "L-13", message_id: `Urgensi palsu ("${urgency}") dilarang — pakai urgensi jujur yang bisa dibuktikan.` });

  // L-14: angka/klaim yang tidak ada di data produk (harga jual + harga normal promo)
  const pricePhrase = formatHargaNatural(script.priceIdr);
  const allowedDigits = new Set(tokens(pricePhrase).filter((t) => /^\d+$/.test(t)));
  allowedDigits.add(String(script.priceIdr));
  if (script.promoPriceBeforeIdr) {
    for (const t of tokens(formatHargaNatural(script.promoPriceBeforeIdr))) if (/^\d+$/.test(t)) allowedDigits.add(t);
    allowedDigits.add(String(script.promoPriceBeforeIdr));
  }
  // Angka di dalam frasa harga diperiksa utuh (nominal + unit) di bawah.
  // Jangan pecah "24,62 ribu" menjadi token 24 dan 62 lalu menolaknya
  // sebelum pemeriksaan harga semantik sempat berjalan.
  const nonPriceTokens = tokens(fullText.replace(PRICE_MENTION_REGEX, " "));
  const badDigit = nonPriceTokens.find((t) => /^\d+$/.test(t) && !allowedDigits.has(t));
  if (badDigit)
    push(false, { rule: "L-14", message_id: `Ada angka "${badDigit}" yang tidak ada di data produk — klaim harus sesuai data yang kamu kasih.` });
  const sourcePriceAmounts = [script.priceIdr, script.promoPriceBeforeIdr]
    .filter((value): value is number => Boolean(value));
  // Copy lisan sengaja memakai formatHargaNatural (mis. Rp24.620 ->
  // "25 ribu"). Terima nilai eksak ATAU hasil pembulatan formatter resmi;
  // tanpa ini generator dan validator saling bertentangan dan memblokir flow.
  const allowedPriceAmounts = new Set(sourcePriceAmounts);
  for (const amount of sourcePriceAmounts) {
    const spoken = spokenPriceAmount(amount);
    if (spoken !== null) allowedPriceAmounts.add(spoken);
  }
  const wrongPrice = [...fullText.matchAll(PRICE_MENTION_REGEX)].find((match) => {
    const number = Number(match[1].replace(",", "."));
    const multiplier = /juta|jt/i.test(match[2]) ? 1_000_000 : 1_000;
    return !allowedPriceAmounts.has(Math.round(number * multiplier));
  });
  if (wrongPrice) {
    push(false, { rule: "L-14", message_id: `Harga "${wrongPrice[0]}" tidak cocok dengan harga produk yang diberikan.` });
  }

  // L-15: merek pesaing yang direndahkan
  for (const brand of COMPETITOR_BRANDS) {
    if (!lower.includes(brand)) continue;
    const segWithBrand = script.segments.find((s) => s.text.toLowerCase().includes(brand));
    const segToks = tokens(segWithBrand?.text ?? "");
    if (segToks.some((t) => NEGATIVE_WORDS.has(t)))
      push(false, { rule: "L-15", message_id: `Merek lain ("${brand}") disebut sambil dijelekkan — ini berisiko dilaporkan.` });
    else
      warnings.push({ rule: "L-15", message_id: `Merek lain ("${brand}") disebut — sebaiknya dihapus biar aman.` });
    break;
  }

  // L-16: konsistensi register (kata ganti tidak boleh campur)
  const hasGue = toks.some((t) => GUE_TOKENS.has(t));
  const hasAku = toks.some((t) => AKU_TOKENS.has(t));
  const hasLo = toks.some((t) => LO_TOKENS.has(t));
  const hasKamu = toks.some((t) => KAMU_TOKENS.has(t));
  if ((hasGue && hasAku) || (hasLo && hasKamu))
    push(false, { rule: "L-16", message_id: "Kata gantinya campur (gue/aku atau lo/kamu) — pilih satu gaya biar konsisten." });
  else if (script.register === "genz" && (hasAku || hasKamu))
    push(false, { rule: "L-16", message_id: "Register Gen-Z harus pakai gue/lo, bukan aku/kamu." });
  else if (script.register !== "genz" && (hasGue || hasLo))
    push(false, { rule: "L-16", message_id: `Register ${script.register} harus pakai aku/kamu, bukan gue/lo.` });

  // L-17 (tier bersuara): tanda kurung instruksi DILARANG di dalam teks ucapan —
  // jeda dramatis harus jadi instruksi di LUAR tanda kutip dialog (aturan uji 31 Jul).
  if (tier !== "silent_caption") {
    const withParens = script.segments.find((s) => /[()]/.test(s.text));
    if (withParens)
      push(true, {
        rule: "L-17",
        message_id:
          "Ada tanda kurung di teks ucapan — untuk video bersuara, instruksi jeda ditulis di luar dialog, bukan di dalam kurung.",
        segment: withParens.role,
      });
  }

  // L-18: cue pembawaan hanya boleh berada di tts_text, memakai whitelist.
  // `text` harus selalu dialog bersih karena dipakai UI, caption, QC, dan
  // prompt video/provider non-Gemini.
  for (const segment of script.segments) {
    const tagsInText = segment.text.match(/\[[^\[\]\n]+\]/g) ?? [];
    const unknown = unknownDeliveryTags(segment.tts_text ?? "");
    const misplacedEmphasis = misplacedEmphasisTags(segment.tts_text ?? "");
    if (tagsInText.length || unknown.length || misplacedEmphasis.length) {
      push(true, {
        rule: "L-18",
        message_id: tagsInText.length
          ? `Penanda pembawaan ${tagsInText.join(", ")} bocor ke teks ucapan bersih.`
          : unknown.length
            ? `Penanda pembawaan tidak dikenal: ${unknown.join(", ")}.`
            : `Cue emphasis harus berada di awal baris: ${misplacedEmphasis.join(", ")}.`,
        segment: segment.role,
      });
      continue;
    }
    if (segment.tts_text && stripDeliveryTags(segment.tts_text) !== segment.text.trim()) {
      push(true, {
        rule: "L-18",
        message_id: "Teks VO bertag tidak sama dengan teks bersih setelah penandanya dihapus.",
        segment: segment.role,
      });
    }
  }

  return { passed: errors.length === 0, errors, warnings, checked_at: new Date().toISOString() };
}
