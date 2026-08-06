import { ERR } from "./errors";

// Add-on Promo & Urgency (keputusan Brian 2026-08-06): user boleh mengisi harga
// normal (sebelum diskon), tanggal promo berakhir, dan stok tersisa — SEMUA
// OPSIONAL ("mainan konten", bukan wajib). Prinsip keras:
// - Urgensi hanya dari data yang diisi user (urgensi JUJUR — L-13 melarang yang palsu).
// - Promo kedaluwarsa saat dipakai -> elemen promo di-drop diam-diam, tidak
//   pernah memblokir user (keputusan: "render tanpa bagian promo").
// - Angka % dan tanggal TIDAK masuk teks skrip (L-14 melarang angka di luar
//   data harga) — angka spesifik hidup di overlay & caption; skrip memakai
//   dua harga (sama-sama data produk) + kata waktu relatif tanpa angka.

export interface PromoInput {
  priceIdr: number;
  promoPriceBeforeIdr?: number | null;
  promoEndsAt?: string | null; // ISO date (YYYY-MM-DD) atau ISO datetime
  promoStockLeft?: number | null;
}

export interface ActivePromo {
  beforeIdr: number;
  priceIdr: number;
  /** Persen diskon, dibulatkan — dihitung otomatis, user tidak mengisi %. */
  pct: number;
  endsAt: Date | null;
  stockLeft: number | null;
}

/** Promo aktif hanya bila harga-normal > harga-jual DAN belum kedaluwarsa.
 * Tanggal tanpa jam dianggap berlaku sampai akhir hari itu (23:59 WIB-lokal server). */
export function resolvePromo(input: PromoInput, now: Date = new Date()): ActivePromo | null {
  const before = input.promoPriceBeforeIdr ?? null;
  if (!before || before <= input.priceIdr) return null;
  let endsAt: Date | null = null;
  if (input.promoEndsAt) {
    const raw = String(input.promoEndsAt);
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw);
    if (Number.isNaN(parsed.getTime())) return null; // tanggal rusak = jangan mengarang urgency
    if (parsed.getTime() < now.getTime()) return null; // kedaluwarsa -> drop seluruh promo
    endsAt = parsed;
  }
  const stock = input.promoStockLeft ?? null;
  return {
    beforeIdr: before,
    priceIdr: input.priceIdr,
    pct: Math.round((1 - input.priceIdr / before) * 100),
    endsAt,
    stockLeft: typeof stock === "number" && Number.isFinite(stock) && stock > 0 ? Math.floor(stock) : null,
  };
}

const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Frasa deadline untuk TEKS SKRIP — tanpa angka (L-14) dan tidak menyentuh
 * frasa terlarang L-13 ("cuma hari ini" dst.). null = terlalu jauh, skrip tidak
 * menyebut deadline (overlay/caption tetap menampilkannya). */
export function promoDeadlineSpokenPhrase(endsAt: Date, now: Date = new Date()): string | null {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(endsAt) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return "promonya kelar hari ini";
  if (days === 1) return "promonya cuma sampai besok";
  if (days <= 6) return `promonya cuma sampai ${WEEKDAYS_ID[endsAt.getDay()]} ini`;
  if (days <= 13) return "promonya cuma sampai minggu depan";
  return null;
}

/** "15 Agu" — untuk overlay & caption (angka boleh, bukan teks skrip). */
export function formatPromoDateShort(endsAt: Date): string {
  return `${endsAt.getDate()} ${MONTHS_ID[endsAt.getMonth()]}`;
}

function rupiahShort(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

/** Teks badge overlay promo — DUA BARIS PENDEK (dipisah \n) supaya muat kanvas
 * 720px tanpa terpotong (kasus nyata 2026-08-06: satu baris panjang keluar
 * frame kiri-kanan). Baris 1 harga coret, baris 2 persen + deadline. Renderer
 * PNG (ImageMagick label:) mendukung multiline; compositor memaksa jalur PNG
 * bila teks mengandung \n. */
export function formatPromoOverlayText(promo: ActivePromo): string {
  // ">" ASCII, bukan "→" — glyph panah tidak ada di font Poppins bundel
  // (ter-render sebagai spasi kosong, kasus nyata 2026-08-06).
  const line1 = `${rupiahShort(promo.beforeIdr)} > ${rupiahShort(promo.priceIdr)}`;
  const line2 = `-${promo.pct}%${promo.endsAt ? ` · s.d. ${formatPromoDateShort(promo.endsAt)}` : ""}`;
  return `${line1}\n${line2}`;
}

/** Parse field promo opsional dari body/form API produk.
 * Harga normal invalid ditolak jelas; tanggal rusak ditolak; tanggal LAMPAU
 * dibolehkan masuk (di-drop saat dipakai — keputusan 2026-08-06, tidak memblokir).
 * Konsistensi harga-normal > harga-jual dicek pemanggil (butuh harga final). */
export function parsePromoFields(get: (k: string) => unknown): {
  promoPriceBeforeIdr: number | null;
  promoEndsAt: string | null;
  promoStockLeft: number | null;
} {
  const rawBefore = get("promo_price_before_idr");
  const rawEnds = get("promo_ends_at");
  const rawStock = get("promo_stock_left");
  const beforeNum = rawBefore === undefined || rawBefore === null || rawBefore === "" ? null : Number(String(rawBefore).replace(/[^\d]/g, ""));
  if (beforeNum !== null && (!Number.isFinite(beforeNum) || beforeNum <= 0))
    throw ERR.BAD_REQUEST("Harga normal (sebelum diskon) belum valid — isi angka rupiah ya.", "Invalid promo_price_before_idr.");
  let ends: string | null = null;
  if (rawEnds !== undefined && rawEnds !== null && String(rawEnds).trim() !== "") {
    const s = String(rawEnds).trim();
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59` : s);
    if (Number.isNaN(parsed.getTime()))
      throw ERR.BAD_REQUEST("Tanggal promo berakhir belum valid — pakai format tanggal ya.", "Invalid promo_ends_at.");
    ends = s;
  }
  const stockNum = rawStock === undefined || rawStock === null || rawStock === "" ? null : Number(rawStock);
  const stock = stockNum !== null && Number.isFinite(stockNum) && stockNum > 0 ? Math.floor(stockNum) : null;
  return { promoPriceBeforeIdr: beforeNum, promoEndsAt: ends, promoStockLeft: stock };
}
