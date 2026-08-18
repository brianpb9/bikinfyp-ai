/**
 * KONTEKS ADMISI KANONIK — satu tempat yang menyusun input validator untuk
 * setiap gerbang yang menentukan render dan uang.
 *
 * KENAPA ADA (reviewer 18 Agu, temuan P0).
 *
 * Tiga gerbang memvalidasi naskah yang sama dengan konteks yang berbeda-beda,
 * dan masing-masing melewatkan hal yang berbeda:
 *
 *   approve retail       tanpa durationSec, tanpa cartLabel
 *   submit job retail    tanpa durationSec, tanpa cartLabel
 *   confirm Enterprise   tanpa format, tanpa durationSec
 *
 * Akibatnya dua arah sekaligus, dan keduanya nyata:
 *
 *   MELOLOSKAN — naskah 30 detik berisi 18 kata lolos, karena tanpa
 *   durationSec validator memakai basis 15 detik. CTA TikTok yang cuma
 *   berkata "keranjang" lolos, karena tanpa cartLabel yang diperiksa hanya
 *   kata generiknya.
 *
 *   MENOLAK — TVC yang sah ditolak L-03/L-19, karena tanpa format aturan
 *   T-01..T-03 tidak pernah dijalankan dan aturan lisan afiliasi justru
 *   dipaksakan ke naskah yang memang bukan afiliasi.
 *
 * Selama tiap pemanggil menyusun konteksnya sendiri, perbedaan seperti ini
 * akan lahir lagi setiap kali ada gerbang baru. Jadi penyusunannya dipindah ke
 * sini, dan pemanggil hanya menyerahkan apa yang memang mereka punya.
 */
import { cartLabelForUrl } from "./index";
import { isTvcTemplate, templateRequiresPriceMention, validateScript, type ValidationResult } from "./validator";
import type { SegmentDraft } from "./templates";

export interface SumberAdmisi {
  segments: SegmentDraft[];
  hookFamily: string;
  register: string;
  productName: string;
  productPriceIdr: number;
  /** URL sumber produk — MENENTUKAN label keranjang yang wajib disebut CTA. */
  productSourceUrl?: string | null;
  promoPriceBeforeIdr?: number | null;
  qualityTier?: string | null;
  /** Kosong = diturunkan dari segmen. Lihat durasiDariSegmen(). */
  durationSec?: number | null;
  format?: string | null;
  templateId?: string | null;
  wordBudget?: number | null;
}

/**
 * Durasi dari SEGMEN, bukan dari tebakan 15 detik.
 *
 * Tabel scripts tidak menyimpan durasi, tapi segmennya menyimpan timecode —
 * dan `end` segmen terakhir memang durasinya. Ini yang membuat naskah 30 detik
 * berhenti dinilai dengan jendela kata 15 detik.
 */
export function durasiDariSegmen(segments: SegmentDraft[]): number {
  const akhir = Math.max(0, ...segments.map((s) => Number(s.end) || 0));
  // Dibulatkan ke durasi yang memang dijual; nilai aneh jatuh ke 15 seperti
  // perilaku lama, bukan ke angka karangan.
  for (const d of [15, 30, 45]) if (Math.abs(akhir - d) <= 2) return d;
  return akhir > 0 ? Math.round(akhir) : 15;
}

/** Susun input validator yang LENGKAP dari data yang tersedia. */
export function konteksAdmisi(sumber: SumberAdmisi) {
  const durationSec = sumber.durationSec ?? durasiDariSegmen(sumber.segments);
  const format = sumber.format ?? (isTvcTemplate(sumber.templateId) ? "tvc" : undefined);
  return {
    hook_family: sumber.hookFamily,
    register: sumber.register,
    segments: sumber.segments,
    productName: sumber.productName,
    priceIdr: sumber.productPriceIdr,
    promoPriceBeforeIdr: sumber.promoPriceBeforeIdr ?? null,
    qualityTier: (sumber.qualityTier ?? "silent_caption") as "silent_caption" | "high_quality" | "super_hq",
    durationSec,
    // Label keranjang mengikuti platform — "keranjang kuning" itu branding
    // TikTok, dan menyuruh pembeli Shopee mencarinya adalah menyuruhnya
    // mencari sesuatu yang tidak ada.
    cartLabel: cartLabelForUrl(sumber.productSourceUrl),
    ...(format ? { format: format as "hands_only" | "vo_broll" | "talking_head" | "tvc" | "ads" } : {}),
    requirePriceMention: templateRequiresPriceMention(sumber.templateId),
    ...(sumber.wordBudget ? { wordBudget: sumber.wordBudget } : {}),
  };
}

/**
 * Gerbang admisi: dipanggil SEBELUM job dibuat dan sebelum kredit ditahan.
 *
 * Memakai mode "light" dengan sengaja — bukan karena lebih longgar, tapi
 * karena aturan yang menentukan SAH-tidaknya sudah keras di kedua mode
 * (SELALU_KERAS di validator). Yang tetap lunak hanyalah aturan gaya, dan
 * naskah yang sudah disunting pengguna memang tidak boleh diblokir karena
 * selera.
 */
export function periksaAdmisi(sumber: SumberAdmisi): ValidationResult {
  return validateScript(konteksAdmisi(sumber) as never, "light");
}
