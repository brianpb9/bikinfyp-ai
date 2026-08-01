// Penyusun caption + hashtag + saran jam posting (FSD F-02 langkah 6, F-09).

import {
  BASE_HASHTAGS, CATEGORY_NICHE_HASHTAGS, CATEGORY_POST_TIME,
} from "../config/hooks";
import type { RegisterSpec } from "./registers";
import { formatHargaOverlay } from "./templates";

export function buildCaption(opts: {
  produk: string;
  proof: string;
  reg: RegisterSpec;
}): string {
  const { produk, proof, reg } = opts;
  // 2-3 kalimat + CTA (F-09). Harga sudah tertempel di video via overlay,
  // caption fokus mengulang bukti + arahkan ke keranjang kuning.
  return (
    `${produk} ini lagi ${reg.me} pake terus sih, ${proof} beneran niat. ` +
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
