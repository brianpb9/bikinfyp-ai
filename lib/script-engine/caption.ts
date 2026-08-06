// Penyusun caption + hashtag + saran jam posting (FSD F-02 langkah 6, F-09).

import {
  BASE_HASHTAGS, CATEGORY_NICHE_HASHTAGS, CATEGORY_POST_TIME,
} from "../config/hooks";
import type { RegisterSpec } from "./registers";
import { formatHargaOverlay } from "./templates";
import { formatPromoDateShort, type ActivePromo } from "../promo";

export function buildCaption(opts: {
  produk: string;
  proof: string;
  reg: RegisterSpec;
  /** Add-on promo (opsional): caption boleh memuat angka spesifik (%, tanggal,
   * stok) — beda dengan teks skrip yang dibatasi L-13/L-14. */
  promo?: ActivePromo | null;
}): string {
  const { produk, proof, reg, promo } = opts;
  // 2-3 kalimat + CTA (F-09). Harga sudah tertempel di video via overlay,
  // caption fokus mengulang bukti + arahkan ke keranjang kuning.
  const promoLine = promo
    ? `⚡ Lagi diskon ${promo.pct}% — dari ${formatHargaOverlay(promo.beforeIdr)} jadi ${formatHargaOverlay(promo.priceIdr)}` +
      `${promo.endsAt ? `, cuma sampai ${formatPromoDateShort(promo.endsAt)}` : ""}` +
      `${promo.stockLeft !== null ? `, stok tinggal ${promo.stockLeft}` : ""}. `
    : "";
  return (
    `${produk} ini lagi ${reg.me} pake terus sih, ${proof} beneran niat. ` +
    promoLine +
    `Yang nanya terus, linknya udah ${reg.me} taruh ya. ` +
    `Cus cek keranjang kuning sebelum kehabisan!`
  );
}

export function buildHashtags(category: string): string[] {
  const niche = CATEGORY_NICHE_HASHTAGS[category] ?? CATEGORY_NICHE_HASHTAGS.default;
  return [...BASE_HASHTAGS, ...niche]; // 8 tag: campuran umum + niche + #racuntiktok
}

export function suggestedPostTime(category: string): string {
  return CATEGORY_POST_TIME[category] ?? CATEGORY_POST_TIME.default;
}

export { formatHargaOverlay };
