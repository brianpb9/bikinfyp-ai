// Penyusun caption + hashtag + saran jam posting (FSD F-02 langkah 6, F-09).

import {
  BASE_HASHTAGS, CATEGORY_NICHE_HASHTAGS, CATEGORY_POST_TIME, type HookCode,
} from "../config/hooks";
import type { RegisterSpec } from "./registers";
import { formatHargaOverlay } from "./templates";
import { formatPromoDateShort, type ActivePromo } from "../promo";

// Pembuka caption per KELUARGA HOOK (2026-08-11).
//
// Sebelumnya semua varian memakai satu kalimat pembuka yang sama, jadi brand
// yang memesan 6 video mendapat 6 caption IDENTIK walau skrip videonya
// benar-benar berbeda — persis merusak alasan mereka membeli banyak variasi.
// Ketahuan saat verifikasi M8: hook H2/H15/H4 menghasilkan hook & demo yang
// beda, tapi caption-nya sama huruf per huruf.
//
// PENTING: `proof` dari CATEGORY_PROOF selalu FRASA BENDA bertalian ganti
// ("teksturnya", "bahannya", "rasanya") — bukan klausa lengkap. Jadi tiap
// pembuka WAJIB menutupnya dengan predikat sendiri, kalau tidak kalimatnya
// menggantung ("...yang kemarin banyak dicari itu — teksturnya."). Versi
// pertama perbaikan ini sempat kena persis jebakan itu.
//
// Tiap pembuka mengikuti SUDUT hook-nya, bukan sekadar kata acak — caption
// dan videonya harus terasa satu napas. Semua tetap patuh aturan konten kita:
// tanpa angka yang tidak ada di data produk, tanpa klaim medis, tanpa janji
// hasil. Angka promo tetap hanya lewat promoLine di bawah (satu-satunya
// tempat angka spesifik diizinkan di caption).
// Kata kerja pemakaian per kategori: "aku pakai keripik tiap hari" salah
// bahasa. Kecil tapi langsung kelihatan, dan F&B kategori besar di TikTok
// Shop. Default "pakai" benar untuk mayoritas kategori lain.
const CATEGORY_VERB: Record<string, string> = {
  food: "makan",
  kitchen: "pakai",
  default: "pakai",
};

const CAPTION_OPENER: Record<HookCode, (produk: string, proof: string, me: string, verb: string) => string> = {
  H1: (p, proof, me, verb) => `Jujur kaget pas tau ${p} harganya segini, ${proof} nggak main-main buat ${me}.`,
  H2: (p, proof, me, verb) => `Capek sama masalah yang itu-itu terus? ${p} bikin ${me} berhenti nyari — ${proof} beneran niat.`,
  H3: (p, proof, me, verb) => `${p} ini ${me} ${verb} sendiri tiap hari, dan ${proof} kerasa banget bedanya.`,
  H4: (p, proof, _me, _verb) => `${p} yang kemarin banyak dicari itu, ${proof} emang beda.`,
  H5: (p, proof, me, verb) => `Sebelum ambil yang lain, ${me} saranin lihat ${p} dulu — ${proof} nggak main-main.`,
  H6: (p, proof, me, verb) => `Ada satu hal dari ${p} yang baru ${me} sadar belakangan: ${proof} ternyata sebagus itu.`,
  H7: (p, proof, _me, _verb) => `Yang jarang dibahas soal ${p}: ${proof} jauh di atas ekspektasi awal.`,
  H8: (p, proof, _me, _verb) => `Buat yang lagi nyari ${p}, coba lihat ini dulu — ${proof} beneran niat.`,
  H9: (p, proof, me, verb) => `Udah coba beberapa, dan ${p} yang akhirnya ${me} ${verb} terus: ${proof} paling kerasa.`,
  H10: (p, proof, _me, _verb) => `Lagi gampang dapetnya, ${p} — ${proof} sebagus itu.`,
  H11: (p, proof, me, verb) => `Bedanya baru kerasa setelah ${me} rutin ${verb} ${p}, ${proof} berubah banget.`,
  H12: (p, proof, me, verb) => `Yang paling kepakai sehari-hari versi ${me}: ${p}, ${proof} nggak mengecewakan.`,
  H13: (p, proof, _me, _verb) => `Kalau kamu tipe yang males ribet milih, ${p} aman — ${proof} udah jelas.`,
  H14: (p, proof, me, verb) => `${me.charAt(0).toUpperCase()}${me.slice(1)} spill ya: ${p}, ${proof} beneran niat.`,
  H15: (p, proof, me, verb) => `Sering ditanya ${me} ${verb} apa? Ini jawabannya — ${p}, ${proof} juara.`,
  H16: (p, proof, me, verb) => `Kenapa nggak dari dulu ${me} ${verb} ${p}, ${proof} sebagus ini.`,
};
// Penutup juga digilir — kalau CTA-nya seragam, caption tetap terasa kembar
// walau pembukanya beda. Frasa "keranjang kuning" WAJIB dipertahankan persis:
// applyCartLabel() di index.ts menggantinya jadi "keranjang" untuk toko
// non-TikTok lewat pencocokan teks itu.
const CAPTION_CTA: ((me: string) => string)[] = [
  (me) => `Yang nanya terus, linknya udah ${me} taruh ya. Cus cek keranjang kuning sebelum kehabisan!`,
  () => `Linknya ada di keranjang kuning ya, tinggal ketuk.`,
  (me) => `Udah ${me} taruh di keranjang kuning — cek sebelum kehabisan.`,
  () => `Buat yang mau, langsung cek keranjang kuning aja.`,
];

export function buildCaption(opts: {
  produk: string;
  proof: string;
  reg: RegisterSpec;
  /** Keluarga hook varian ini — menentukan sudut pembuka & penutup caption. */
  hookFamily?: HookCode;
  /** Kategori produk — menentukan kata kerja pemakaian (makan vs pakai). */
  kategori?: string;
  /** Add-on promo (opsional): caption boleh memuat angka spesifik (%, tanggal,
   * stok) — beda dengan teks skrip yang dibatasi L-13/L-14. */
  promo?: ActivePromo | null;
}): string {
  const { produk, proof, reg, promo, hookFamily, kategori } = opts;
  const verb = CATEGORY_VERB[kategori ?? "default"] ?? CATEGORY_VERB.default;
  const promoLine = promo
    ? `⚡ Lagi diskon ${promo.pct}% — dari ${formatHargaOverlay(promo.beforeIdr)} jadi ${formatHargaOverlay(promo.priceIdr)}` +
      `${promo.endsAt ? `, cuma sampai ${formatPromoDateShort(promo.endsAt)}` : ""}` +
      `${promo.stockLeft !== null ? `, stok tinggal ${promo.stockLeft}` : ""}. `
    : "";

  // Tanpa hookFamily (pemanggil lama) perilaku persis seperti sebelumnya.
  const opener = hookFamily
    ? CAPTION_OPENER[hookFamily](produk, proof, reg.me, verb)
    : `${produk} ini lagi ${reg.me} pake terus sih, ${proof} beneran niat.`;
  // Deterministik dari nomor hook: varian yang sama selalu menghasilkan
  // caption yang sama (bisa diulang/diaudit), tapi antar varian berbeda.
  const ctaIndex = hookFamily ? (Number(hookFamily.slice(1)) - 1) % CAPTION_CTA.length : 0;

  return `${opener} ${promoLine}${CAPTION_CTA[ctaIndex](reg.me)}`;
}

export function buildHashtags(category: string): string[] {
  const niche = CATEGORY_NICHE_HASHTAGS[category] ?? CATEGORY_NICHE_HASHTAGS.default;
  return [...BASE_HASHTAGS, ...niche]; // 8 tag: campuran umum + niche + #racuntiktok
}

export function suggestedPostTime(category: string): string {
  return CATEGORY_POST_TIME[category] ?? CATEGORY_POST_TIME.default;
}

export { formatHargaOverlay };
