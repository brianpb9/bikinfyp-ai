// Validator skrip L-01..L-16 (FSD F-02.3).
// Mode "strict": semua aturan keras (dipakai saat generate & QC-07 pra-render).
// Mode "light": hanya L-10/L-11 yang keras (edit pengguna, FSD BR-03.2); sisanya jadi warning.

import { COMPETITOR_BRANDS } from "../config/hooks";
import { formatHargaNatural } from "./templates";

export interface ScriptToValidate {
  hook_family: string;
  register: string;
  segments: { role: string; text: string }[];
  productName: string;
  priceIdr: number;
  /** Tier kualitas — memengaruhi L-05 (batas kata) & L-17 (kurung instruksi). Default silent_caption. */
  qualityTier?: "silent_caption" | "high_quality" | "super_hq";
  /** Durasi video — L-05 (batas kata) skala proporsional dari basis 15 dtk. Default 15. */
  durationSec?: number;
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

  const fullText = script.segments.map((s) => s.text).join(" ");
  const lower = fullText.toLowerCase();
  const toks = tokens(fullText);
  const hookSeg = script.segments.find((s) => s.role === "hook");
  const demoSeg = script.segments.find((s) => s.role === "demo");
  const ctaSeg = script.segments.find((s) => s.role === "cta");
  const hookDemo = [hookSeg?.text ?? "", demoSeg?.text ?? ""].join(" ");

  // L-01: >=2 partikel
  const particleCount = toks.filter((t) => PARTICLES.has(t)).length;
  if (particleCount < 2)
    push(false, { rule: "L-01", message_id: "Skripnya masih kaku — tambahin kata kayak 'deh', 'sih', atau 'dong' biar kayak orang ngobrol." });

  // L-02: harga eksplisit di hook atau demo
  if (!PRICE_REGEX.test(hookDemo))
    push(false, { rule: "L-02", message_id: "Harganya belum disebut di awal video — pembeli butuh dengar angkanya (mis. '85 ribu').", segment: "demo" });

  // L-03: CTA menyebut "keranjang" — "kuning" cuma untuk TikTok Shop (istilah
  // branding TikTok), Shopee/Tokopedia/manual pakai "keranjang" polos (lihat
  // cartLabelForUrl di script-engine/index.ts). Cek generik biar berlaku di
  // kedua kasus tanpa validator perlu tau platform-nya.
  if (!ctaSeg || !ctaSeg.text.toLowerCase().includes("keranjang"))
    push(false, { rule: "L-03", message_id: "Ajakan penutup harus menyebut 'keranjang' biar pembeli tau harus klik di mana.", segment: "cta" });

  // L-04: >=1 filler lisan
  const hasFiller =
    toks.some((t) => FILLER_TOKENS.has(t)) || FILLER_PHRASES.some((p) => lower.includes(p));
  if (!hasFiller)
    push(false, { rule: "L-04", message_id: "Belum ada jeda lisan ('nah', 'jadi gini', 'sumpah') — tanpa itu kedengeran kayak robot." });

  // L-05: panjang total — tergantung tier (aturan bahasa hasil uji nyata 31 Jul):
  // silent_caption 32-48 kata (teks dibaca, bukan diucapkan);
  // tier bersuara 10-22 kata (audio embedded ~20 kata/15 dtk, dirakit 2 shot).
  // Basis 15 dtk; durasi lain skala proporsional (durationSec/15).
  const tier = script.qualityTier ?? "silent_caption";
  const durationScale = (script.durationSec ?? 15) / 15;
  const wc = wordCount(fullText);
  const [baseMinWc, baseMaxWc] = tier === "silent_caption" ? [32, 48] : [10, 22];
  const minWc = Math.round(baseMinWc * durationScale);
  const maxWc = Math.round(baseMaxWc * durationScale);
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

  // L-14: angka/klaim yang tidak ada di data produk
  const pricePhrase = formatHargaNatural(script.priceIdr);
  const allowedDigits = new Set(tokens(pricePhrase).filter((t) => /^\d+$/.test(t)));
  allowedDigits.add(String(script.priceIdr));
  const badDigit = toks.find((t) => /^\d+$/.test(t) && !allowedDigits.has(t));
  if (badDigit)
    push(false, { rule: "L-14", message_id: `Ada angka "${badDigit}" yang tidak ada di data produk — klaim harus sesuai data yang kamu kasih.` });

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

  return { passed: errors.length === 0, errors, warnings, checked_at: new Date().toISOString() };
}
