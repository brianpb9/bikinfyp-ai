// Validator skrip L-01..L-16 (FSD F-02.3).
// Mode "strict": semua aturan keras (dipakai saat generate & QC-07 pra-render).
// Mode "light": hanya L-10/L-11 yang keras (edit pengguna, FSD BR-03.2); sisanya jadi warning.

import { memakaiPerangkat } from "./hook-devices";
import { periksaPemicu, ringkasPemicu } from "../media/pemicu-filter";
import { COMPETITOR_BRANDS } from "../config/hooks";
import { formatHargaNatural } from "./templates";
import { misplacedEmphasisTags, stripDeliveryTags, unknownDeliveryTags } from "./delivery-tags";

export interface ScriptToValidate {
  hook_family: string;
  register: string;
  segments: {
    role: string;
    text: string;
    tts_text?: string;
    /** Arahan visual. Diperiksa L-21 — di sinilah kata pemicu penyaring hidup,
     *  bukan di dialog. */
    visual_direction?: string;
    /** Keadaan awal frame (tulisan LLM), ikut diperiksa L-21. */
    start_state?: string;
  }[];
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
  /** Genre naskah untuk iklan berbayar. "ads" MEMATIKAN L-03 dan mengaktifkan
   *  A-01/A-02.
   *
   * Terpisah dari `format` dengan sengaja. `format` itu cara merekam
   * (hands_only, talking_head), dan katalog memakai nilai "ads" di sana untuk
   * gaya anti-produksi — sementara ads-unboxing-pov berformat talking_head
   * tapi genre-nya tetap Ads. Menyatukan keduanya berarti satu dari dua
   * template Ads selalu salah dinilai.
   *
   * Kenapa ada (reviewer ronde 4, Strong Reject "Ads"): CTA resmi Ads adalah
   * "Detailnya ada di bawah ya" — dan L-03 menolaknya karena tidak menyebut
   * keranjang. Jadi setiap naskah Ads yang BENAR ditolak gerbang, dan yang
   * lolos justru yang salah genre. */
  contentType?: "affiliate" | "ads";
  /** Label keranjang yang WAJIB disebut CTA — "keranjang kuning" (TikTok) atau
   *  "keranjang" (Shopee/Tokopedia/manual). Kosong = "keranjang". */
  cartLabel?: string;
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


/**
 * Jendela kata yang berlaku untuk satu naskah — SATU sumber, dipakai validator
 * DAN penulis LLM.
 *
 * Kenapa diekspor. Prompt LLM versi pertama menyebut batasnya sendiri
 * ("<= 1.5 x detik") padahal aturan sebenarnya 25-30 kata per 15 detik. LLM
 * lalu ditolak L-05 oleh aturan yang tidak pernah diberitahukan kepadanya —
 * dan naskahnya sampai ke pengguna dalam keadaan tidak bisa disetujui.
 * Menyalin angkanya ke prompt akan mengulang cacat yang sama begitu angkanya
 * berubah, jadi promptnya memanggil fungsi ini.
 *
 * Jatah template memakai toleransi yang sama dengan templates.ts (+/-15%) dan
 * TIDAK diskalakan durasi — batasnya beban baca, bukan kecepatan bicara.
 * BATAS BAWAH menyerap panjang NAMA PRODUK; batas atas tidak.
 *
 * Nama produk ikut diucapkan, jadi ia menggeser total kata — tapi panjangnya
 * ditentukan pengguna, bukan penulis naskah. Terukur 16 Agu 2026: dengan
 * jendela lama, 10 dari 33 template gagal total tergantung panjang nama, dan
 * 33 dari 36 kegagalan itu karena naskah KEKURANGAN 1-4 kata. Brian tidak bisa
 * membuat video sama sekali untuk produknya, sementara pesan errornya justru
 * menyuruh MEMENDEKKAN nama — yang mengurangi kata lagi.
 *
 * Asimetrisnya disengaja dan berdasar bukti:
 *   - kelebihan kata = VO terpotong / terdengar diburu (r19, cacat terukur)
 *   - kekurangan kata = ekor hening sedikit; 1-4 kata ~ 0,5-2 detik
 * Jadi batas atas TETAP ketat, batas bawah diberi kelonggaran sebesar nama
 * produknya (maksimal 6 kata, sepanjang nama terpanjang yang wajar).
 */
export function jendelaKata(script: {
  qualityTier?: string | null;
  durationSec?: number | null;
  wordBudget?: number | null;
  productName?: string | null;
}): { minWc: number; maxWc: number } {
  const tier = script.qualityTier ?? "silent_caption";
  const durationScale = (script.durationSec ?? 15) / 15;
  // BATAS BRIAN: 1,5 kata per detik (temuan reviewer A3). 15 dtk -> 22 kata.
  //
  // Angka lama [25,30] lahir dari kalibrasi Gemini TTS (~1,93 kata/detik) dan
  // memang menghasilkan naskah 24/26/26 kata = 1,60-1,73 kata/detik — semuanya
  // di atas batas. Yang dipakai sekarang batasnya, bukan kecepatan TTS-nya.
  //
  // Batas bawah ikut turun supaya jendelanya tidak terbalik. 16 dipilih, bukan
  // 20: dengan kelonggaran nama produk sampai 6 kata, batas bawah efektif bisa
  // menyentuh 10 — dan naskah 10 kata untuk 15 detik memang terlalu sepi.
  const [baseMinWc, baseMaxWc] = tier === "silent_caption" ? [32, 48] : [16, 22];
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
  return { minWc, maxWc };
}

export const PARTICLES = new Set(["deh", "sih", "dong", "ya", "loh", "kok", "nah", "tuh"]);
export const FILLER_TOKENS = new Set(["nah", "sumpah", "eh", "btw"]);
export const FILLER_PHRASES = ["jadi gini"];

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

export const GUE_TOKENS = new Set(["gue", "gua", "gw"]);
export const AKU_TOKENS = new Set(["aku"]);
export const LO_TOKENS = new Set(["lo", "lu", "elu"]);
export const KAMU_TOKENS = new Set(["kamu", "kau", "anda"]);

const PRICE_REGEX = /\d+([.,]\d+)?\s*(ribu|rb|ribuan|juta|jt)\b/i;
const PRICE_MENTION_REGEX = /(\d+(?:[.,]\d+)?)\s*(ribu|rb|ribuan|juta|jt)\b/gi;

function spokenPriceAmount(priceIdr: number): number | null {
  const match = formatHargaNatural(priceIdr).match(PRICE_REGEX);
  if (!match) return null;
  const number = Number(match[0].match(/\d+(?:[.,]\d+)?/)?.[0].replace(",", "."));
  const multiplier = /juta|jt/i.test(match[0]) ? 1_000_000 : 1_000;
  return Number.isFinite(number) ? Math.round(number * multiplier) : null;
}

/**
 * Harga yang DITULIS DENGAN KATA — "sembilan puluh sembilan ribu" = 99000.
 *
 * Kenapa ada (reviewer ronde 4, Strong Reject "truth"): L-14 hanya memindai
 * DIGIT, sementara prompt penulis justru menyuruh menulis harga sebagai kata
 * untuk naskah bersuara ("price ... — write it as words if spoken"). Jadi
 * jalur yang kita perintahkan sendiri adalah jalur yang tidak diperiksa:
 * produk seharga Rp85.000 bisa mengatakan "sembilan puluh sembilan ribu" dan
 * lolos gerbang kebenaran tanpa satu pun peringatan.
 *
 * Hanya rangkaian yang DIAKHIRI satuan (ribu/juta) yang dihitung. "dua kali
 * sehari" atau "tiga puluh detik" bukan harga dan tidak ikut terjaring.
 */
const KATA_SATUAN: Record<string, number> = {
  nol: 0, satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
  enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
};

export function hargaTerbilang(text: string): { frasa: string; nilai: number }[] {
  const kata = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hasil: { frasa: string; nilai: number }[] = [];
  let kelompok = 0;      // ratusan/puluhan yang sudah ditutup
  let tertunda = 0;      // satuan yang belum ditutup
  let total = 0;         // AKUMULASI satu rangkaian: "satu juta dua ratus ribu"
  let pengaliTerakhir = Infinity; // satuan hanya boleh MENGECIL dalam satu rangkaian
  let mulai = -1;
  let punyaAngka = false;
  const reset = () => { kelompok = 0; tertunda = 0; total = 0; pengaliTerakhir = Infinity; mulai = -1; punyaAngka = false; };
  /** Tutup rangkaian: sisa kelompok tanpa satuan ikut sebagai sisa nominal. */
  const tutup = (sampai: number) => {
    if (total > 0) {
      const sisa = kelompok + tertunda;
      hasil.push({ frasa: kata.slice(mulai, sampai).join(" "), nilai: Math.round(total + sisa) });
    }
    reset();
  };
  for (let i = 0; i < kata.length; i++) {
    const w = kata[i];
    const tandai = () => { if (mulai < 0) mulai = i; punyaAngka = true; };
    if (w in KATA_SATUAN) { tandai(); tertunda = KATA_SATUAN[w]; continue; }
    if (w === "sepuluh") { tandai(); tertunda = 10; continue; }
    if (w === "sebelas") { tandai(); tertunda = 11; continue; }
    if (w === "belas") { tandai(); tertunda = 10 + tertunda; continue; }
    if (w === "puluh") { tandai(); kelompok += tertunda * 10; tertunda = 0; continue; }
    // "dua setengah juta" = 2.500.000. Bentuk ini dipakai orang Indonesia
    // sehari-hari dan sebelumnya tidak terbaca sama sekali — jadi klaim harga
    // dalam bentuk itu lewat gerbang kebenaran tanpa diperiksa.
    if (w === "setengah") { tandai(); tertunda += 0.5; continue; }
    if (w === "ratus" || w === "seratus") {
      tandai();
      kelompok += (w === "seratus" ? 1 : tertunda || 1) * 100;
      tertunda = 0;
      continue;
    }
    if (w === "ribu" || w === "seribu" || w === "juta" || w === "sejuta") {
      const seSendiri = w.startsWith("se");
      // "85 ribu" angkanya DIGIT, dan jalur digit sudah memeriksanya. Satuan
      // yang berdiri tanpa kata bilangan di depannya bukan harga terbilang.
      if (!punyaAngka && !seSendiri) { tutup(i); continue; }
      const pengali = w.includes("juta") ? 1_000_000 : 1_000;
      // Satuan yang MEMBESAR berarti rangkaian baru ("dua ribu... lima juta").
      if (pengali >= pengaliTerakhir) tutup(i);
      tandai();
      const nominal = seSendiri ? 1 : (kelompok + tertunda) || 1;
      total += nominal * pengali;
      pengaliTerakhir = pengali;
      kelompok = 0;
      tertunda = 0;
      continue;
    }
    tutup(i);
  }
  tutup(kata.length);
  return hasil;
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

/**
 * Aturan yang KERAS DI SEMUA MODE — termasuk "light".
 *
 * "light" ada untuk alasan yang sah: saat pengguna menyunting naskahnya
 * sendiri, aturan gaya tidak boleh memblokir (FSD BR-03.2). Tapi mode itu
 * dipakai juga di tiga gerbang yang menentukan apakah sesuatu DIRENDER dan
 * DIBAYAR — approve, submit job, dan confirm Enterprise — dan di situ
 * "peringatan" berarti naskah yang gagal tetap berangkat.
 *
 * Reproduksi reviewer 18 Agu, dan saya reproduksi ulang: tiga keluaran
 * fallback berstatus degraded, strictPassed=false karena L-05, tapi
 * lightPassed=true — jadi ketiganya bisa disetujui lalu dirender. Klaim
 * "tidak boleh dirender" tidak pernah ditegakkan.
 *
 * Yang masuk daftar ini adalah aturan yang menentukan apakah keluarannya SAH,
 * bukan apakah keluarannya bagus:
 *   L-03  CTA menyebut keranjang — tanpa ini videonya tidak bisa menjual.
 *   L-05  jendela kata — kelebihan kata memotong VO di tengah kalimat.
 *   L-10/L-11  overclaim & klaim medis — risiko hukum.
 *   L-19  hook tanpa perangkat retoris.
 *   L-21  kata yang memicu penyaring penyedia.
 *   T-01..T-03  genre TVC — lihat catatan di bawah.
 *   A-01/A-02  genre Ads — lihat catatan di bawah.
 *
 * Aturan gaya (partikel, filler, register) TETAP lunak di light: itu memang
 * wilayah selera penggunanya.
 */
export const SELALU_KERAS = new Set([
  "L-03", "L-05", "L-10", "L-11", "L-13", "L-14", "L-19", "L-21",
  "T-01", "T-02", "T-03", "A-01", "A-02",
]);

/**
 * T-01..T-03 dan A-01/A-02 ditambahkan 18 Agu (reviewer ronde 4, Strong
 * Reject "Enterprise admission").
 *
 * Ketiga aturan TVC memakai push(false), jadi di light ketiganya cuma
 * peringatan — dan SELURUH jalur Enterprise memvalidasi dengan light. Yang
 * direproduksi reviewer: TVC yang melanggar T-01, T-02, DAN T-03 sekaligus
 * tetap menghasilkan passed:true, job QUEUED, dan hold Rp24.000.
 *
 * Ketiganya aturan GENRE, bukan gaya. Penutup tanpa nama merek berarti iklan
 * yang berakhir tanpa pernah menyebut siapa yang beriklan; "keranjang" di
 * dalam TVC berarti genre-nya berubah jadi live-selling. Keduanya bukan
 * wilayah selera pengguna, jadi tempatnya di sini.
 */

/**
 * L-13 dan L-14 ditambahkan 18 Agu (reviewer: "compliance/truth", Strong
 * Reject).
 *
 * Keduanya aturan FAKTA, bukan gaya: L-13 urgensi palsu ("stok terakhir" yang
 * tidak berdasar data), L-14 angka/harga yang tidak ada sumbernya. Selama
 * keduanya cuma peringatan di light, naskah yang menyebut stok palsu atau
 * harga karangan tetap bisa disetujui lalu dirender — dan itu bukan soal
 * selera penggunanya, itu soal apakah videonya jujur.
 */

/**
 * QC-07 — filter kata terlarang pada TEKS FINAL, berdiri sendiri.
 *
 * DIPISAH dari validateScript() (reviewer 18 Agu, temuan P0 regresi).
 *
 * QC-07 hanya pernah berarti satu hal: ulangi L-10/L-11 pada teks yang
 * benar-benar keluar (SF-03). Pemanggilnya di lib/media/qc.ts memakai
 * validateScript(..., "light") sebagai PROKSI dari "cuma L-10/L-11 yang
 * keras" — proksi yang benar sampai SELALU_KERAS dipasang, lalu berhenti
 * benar dalam satu commit.
 *
 * Akibatnya deterministik dan mahal: teks final diratakan jadi SATU segmen
 * berperan "hook", jadi tidak pernah ada segmen CTA, jadi L-03 selalu gagal —
 * dan QC-07 berjalan SETELAH provider video dibayar. Setiap render akan gagal
 * lalu direfund, dengan ongkos providernya sudah keluar.
 *
 * Proksi diganti pemeriksa langsung. Sekarang QC-07 tidak bisa lagi ikut
 * berubah kalau daftar aturan struktur naskah berubah — karena ia memang
 * bukan pemeriksa struktur naskah.
 */
export function periksaKataTerlarang(teksFinal: string): RuleIssue[] {
  const lower = teksFinal.toLowerCase();
  const toks = tokens(teksFinal);
  const issues: RuleIssue[] = [];
  const overTok = toks.find((t) => OVERCLAIM_TOKENS.has(t));
  const overPhrase = OVERCLAIM_PHRASES.find((p) => lower.includes(p));
  if (overTok || overPhrase)
    issues.push({ rule: "L-10", message_id: `Ada kata overclaim ("${overTok ?? overPhrase}") — kata kayak 'pasti'/'dijamin'/'terbaik' bisa bikin kena teguran TikTok.` });
  const medTok = toks.find((t) => MEDICAL_TOKENS.has(t));
  const medPhrase = MEDICAL_PHRASES.find((p) => lower.includes(p));
  if (medTok || medPhrase)
    issues.push({ rule: "L-11", message_id: `Ada klaim kesehatan ("${medTok ?? medPhrase}") — klaim medis dilarang keras di platform.` });
  return issues;
}

export function validateScript(script: ScriptToValidate, mode: ValidationMode): ValidationResult {
  const errors: RuleIssue[] = [];
  const warnings: RuleIssue[] = [];
  // alwaysHard: dipertahankan untuk pemanggil lama; SELALU_KERAS yang
  // sebenarnya memutuskan, supaya daftarnya berada di SATU tempat dan tidak
  // perlu diingat ulang di tiap push().
  const push = (alwaysHard: boolean, issue: RuleIssue) => {
    if (mode === "strict" || alwaysHard || SELALU_KERAS.has(issue.rule)) errors.push(issue);
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
  // Ads = iklan berbayar untuk jasa/app/SaaS. Tidak ada keranjang yang bisa
  // diklik, jadi L-03 tidak berlaku dan penutupnya punya aturan sendiri.
  const isAds = !isTvc && script.contentType === "ads";

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
  // Yang diwajibkan LABEL PENUHNYA, bukan kata "keranjang" saja (temuan
  // reviewer: tiga CTA nyata cuma berkata "cek keranjang", tidak satu pun
  // memakai "keranjang kuning"). Labelnya sendiri tetap mengikuti platform —
  // "keranjang kuning" itu branding TikTok, dan menyuruh pembeli Shopee
  // mencari keranjang kuning adalah menyuruhnya mencari sesuatu yang tidak ada.
  const labelKeranjang = (script.cartLabel ?? "keranjang").toLowerCase();
  if (!isTvc && !isAds && (!ctaSeg || !ctaSeg.text.toLowerCase().includes(labelKeranjang)))
    push(false, { rule: "L-03", message_id: `Ajakan penutup harus menyebut "${labelKeranjang}" biar pembeli tau harus klik di mana.`, segment: "cta" });

  if (isAds) {
    const penutup = stripDeliveryTags(ctaSeg?.text ?? "").toLowerCase();

    // A-01: penutup Ads mengarahkan ke bawah/bio/profil. Copy resminya
    // "Detailnya ada di bawah ya" — yang diwajibkan ARAHNYA, bukan kalimatnya
    // persis, supaya naskah yang disunting pengguna tidak diblokir karena
    // memilih kata lain untuk maksud yang sama.
    if (!/di bawah|dibawah|di bio|link di|profil/.test(penutup))
      push(false, {
        rule: "A-01",
        message_id: 'Penutup iklan harus mengarahkan ke bawah/bio (mis. "Detailnya ada di bawah ya") — tanpa itu penonton tidak tahu harus ke mana.',
        segment: "cta",
      });

    // A-02: alasan yang sama dengan T-02. Iklan jasa/app tidak punya keranjang;
    // menyebutnya membuat penonton mencari sesuatu yang tidak ada.
    if (/keranjang/i.test(fullText))
      push(false, {
        rule: "A-02",
        message_id: "Iklan jasa/app tidak boleh menyebut 'keranjang' — tidak ada keranjang yang bisa diklik di iklan ini.",
        segment: "cta",
      });
  }

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
  const { minWc, maxWc } = jendelaKata(script);
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
  // Angka DI DALAM NAMA PRODUK bukan klaim — tapi izinnya melekat pada
  // KEMUNCULAN namanya, bukan pada angkanya di mana pun.
  //
  // Versi pertama memasukkan angka nama produk ke daftar izin global, jadi
  // produk bernama "SPF Serum 50" membuat "diskon 50 persen" ikut lolos
  // (reviewer ronde 5). Sekarang angka itu hanya dimaafkan bila bertetangga
  // dengan kata lain dari nama produknya — "SPF 50" lolos, "diskon 50 persen"
  // tidak.
  const kataNama = new Set(tokens(script.productName).filter((t) => t.length >= 3 && !/^\d+$/.test(t)));
  const angkaNama = new Set(tokens(script.productName).filter((t) => /^\d+$/.test(t)));
  const dekatNama = (i: number) =>
    nonPriceTokens.slice(Math.max(0, i - 2), i + 3).some((t) => kataNama.has(t));
  const badDigit = nonPriceTokens.find(
    (t, i) => /^\d+$/.test(t) && !allowedDigits.has(t) && !(angkaNama.has(t) && dekatNama(i))
  );
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
  // Harga yang ditulis dengan KATA — jalur yang justru kita perintahkan
  // sendiri ke penulis LLM, dan satu-satunya jalur yang belum diperiksa.
  const salahTerbilang = hargaTerbilang(fullText).find((h) => !allowedPriceAmounts.has(h.nilai));
  if (salahTerbilang) {
    push(false, {
      rule: "L-14",
      message_id: `Harga "${salahTerbilang.frasa}" (${salahTerbilang.nilai}) tidak cocok dengan harga produk yang diberikan.`,
    });
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

  // L-19: hook sebaiknya memakai perangkat retoris yang bisa dikenali.
  //
  // PERINGATAN, BUKAN ERROR — dan itu keputusan berdasar ukuran, bukan
  // kehati-hatian. PATCH 5 memintanya jadi aturan keras. Diukur dulu terhadap
  // katalog template (17 Agu): hanya 108 dari 132 hook varian yang dikenali
  // POLA_PERANGKAT. Menjadikannya error akan:
  //
  //   1. menolak 24 varian template — dan template adalah JALUR CADANGAN saat
  //      penulis LLM mati, jadi cadangannya sendiri jadi tidak sah; dan
  //   2. menolak hook yang sebenarnya bagus. Contoh yang gagal: "Eh, sesuatu
  //      baru saja menembus dinding belakang". Perangkatnya nyata (kejutan),
  //      daftar polanya yang belum mengenalinya.
  //
  // Yang salah di situ pengukurnya, bukan hooknya — dan aturan keras yang
  // berdiri di atas pengukur yang belum lengkap akan membuang karya bagus.
  // Jadi ia dilaporkan supaya terlihat dan bisa dihitung, sampai POLA_PERANGKAT
  // menutupi kejutan/anomali dan template yang tersisa diperbaiki. Setelah itu
  // menaikkannya jadi aturan keras tinggal memindahkannya ke push().
  //
  // Ditulis LANGSUNG ke warnings, bukan lewat push(): argumen push() berarti
  // "keras bahkan di mode light", dan di mode strict SEMUANYA jadi error. Jadi
  // push(false, ...) tetap menjatuhkan naskah di strict — persis kebalikan dari
  // yang dimaksud, dan tesnya yang menangkapnya.
  if (!isTvc && hookSeg && !memakaiPerangkat(stripDeliveryTags(hookSeg.text))) {
    push(false, {
      rule: "L-19",
      message_id: "Hook belum memakai perangkat retoris yang dikenali — pakai pertanyaan, negasi, sebut harga, atau pengakuan pribadi.",
      segment: "hook",
    });
  }

  // L-21: kata yang memicu penyaring konten penyedia.
  //
  // PERINGATAN, bukan error, dan alasannya sama dengan L-19: penyaringnya
  // menghukum kosakata, bukan maksud — dan sebagian kosakata itu memang milik
  // produknya. Iklan sabun tanpa kata "mandi" hampir mustahil ditulis, jadi
  // melarangnya keras akan mematikan satu kategori penuh, pola kesalahan yang
  // sudah dua kali kena di repo ini.
  //
  // Yang diperiksa arah VISUAL dan keadaan awal, bukan dialog: penolakan 18 Agu
  // datang dari prompt video, dan dialognya sendiri tidak pernah dikirim ke
  // penyaring itu.
  for (const segment of script.segments) {
    const bahan = [segment.visual_direction ?? "", segment.start_state ?? ""].join(" ").trim();
    if (!bahan) continue;
    const temuan = periksaPemicu(bahan, { namaProduk: script.productName });
    if (!temuan.length) continue;
    // Negasi tentang orang dilaporkan terpisah: ia bukan cuma risiko penyaring,
    // ia juga membuat model MEMUNCULKAN yang dinegasikan.
    const negasi = temuan.filter((t) => t.jenis === "negasi-orang");
    const kosakata = temuan.filter((t) => t.jenis === "kosakata");
    if (negasi.length) {
      push(false, {
        rule: "L-21",
        message_id: `Negasi tentang orang di arahan visual — tulis positifnya: ${ringkasPemicu(negasi)}`,
        segment: segment.role,
      });
    }
    if (kosakata.length) {
      push(false, {
        rule: "L-21",
        message_id: `Kata ini sering memicu penyaring konten penyedia: ${ringkasPemicu(kosakata)}`,
        segment: segment.role,
      });
    }
  }

  return { passed: errors.length === 0, errors, warnings, checked_at: new Date().toISOString() };
}
