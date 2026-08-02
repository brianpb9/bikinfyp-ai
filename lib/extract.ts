// Ekstraksi data produk dari URL marketplace (SF-01) — server-side, anti-SSRF ketat.
// Strategi: (1) Open Graph (og:title/og:image/og:description),
// (2) harga dari JSON-LD Schema.org (offers.price / lowPrice).
// Harga tidak ketemu = biarkan kosong (user isi manual) — TIDAK gagal total.
// Timeout 8 dtk (BR-01.2). Rate limit per-user (pola canRequestOtp).
// Keputusan riset 2026-08: jangan tambahkan Playwright/stealth untuk melewati
// proteksi bot TikTok Shop/Shopee. Itu rapuh dan berisiko melanggar ketentuan
// platform. Impor URL publik tetap best-effort OG/JSON-LD + input manual;
// integrasi yang konsisten harus memakai API partner/OAuth toko seller resmi.

import { validateMarketplaceUrl } from "./url-safety";
import { getDb } from "./db";

export interface ExtractResult {
  extracted: boolean;
  name?: string;
  priceIdr?: number | null;
  categoryGuess?: string;
  imageUrls?: string[];
  reason?: string; // alasan spesifik bila gagal (debug)
  message?: string; // pesan user (Bahasa Indonesia)
}

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const EXTRACT_RATE_LIMIT = 10; // per 15 menit per user

/** Rate limit ekstraksi per user (pola canRequestOtp di lib/otp.ts). */
export function canExtract(userId: string): boolean {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE actor = ? AND action = 'product.extract' AND created_at > ?"
    )
    .get(userId, since) as { n: number };
  return row.n < EXTRACT_RATE_LIMIT;
}

// --- Parser murni (testable dengan fixture HTML) ---

function metaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseOpenGraph(html: string): { title?: string; image?: string; description?: string } {
  return {
    title: metaContent(html, "og:title") ?? metaContent(html, "twitter:title") ?? undefined,
    image: metaContent(html, "og:image") ?? metaContent(html, "twitter:image") ?? undefined,
    description: metaContent(html, "og:description") ?? metaContent(html, "twitter:description") ?? undefined,
  };
}

/** Harga dari berbagai sumber: (1) JSON-LD Schema.org offers, (2) JSON state "price":N,
 * (3) teks Rupiah "Rp115.000". Ambil kandidat pertama yang valid. */
export function parsePriceFromHtml(html: string): number | null {
  const ld = parseJsonLdPrice(html);
  if (ld) return ld;
  const mJson = html.match(/"price":\s*"?([0-9][0-9.]{3,})"?/);
  if (mJson) {
    const n = parseFloat(mJson[1].replace(/\./g, ""));
    if (Number.isFinite(n) && n >= 1000 && n < 1e10) return Math.round(n);
  }
  const mRp = html.match(/Rp\s?([0-9]{1,3}(?:\.[0-9]{3})+)/);
  if (mRp) {
    const n = parseInt(mRp[1].replace(/\./g, ""), 10);
    if (Number.isFinite(n) && n >= 1000 && n < 1e10) return n;
  }
  return null;
}

/** Harga dari JSON-LD Schema.org — beberapa blok script boleh ada; ambil harga valid pertama. */
export function parseJsonLdPrice(html: string): number | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const offers = item?.offers ?? item?.aggregateOffer;
        const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
        for (const o of list) {
          const raw = o?.price ?? o?.lowPrice;
          const n = typeof raw === "string" ? parseFloat(raw.replace(/[^\d.]/g, "")) : Number(raw);
          if (Number.isFinite(n) && n > 0) return Math.round(n);
        }
      }
    } catch {
      /* blok JSON rusak — lanjut blok berikutnya */
    }
  }
  return null;
}

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/serum|skincare|glow|moistur|sunscreen|toner|cream|facial/i, "beauty"],
  [/hijab|mukena|khimar|gamis|jilbab/i, "muslim_fashion"],
  [/baju|kaos|dress|celana|kemeja|jaket|skirt/i, "fashion"],
  [/dapur|panci|wajan|spatula|rice cooker|blender/i, "kitchen"],
  [/rumah|organizer|rak|lemari|lampu|gorden/i, "home"],
  [/hp|gadget|charger|earphone|headset|casing|powerbank|kabel/i, "gadget"],
  [/snack|makanan|cemilan|kopi|teh|susu|madu|sambal/i, "food"],
  [/bayi|anak|popok|diaper|mainan/i, "kids"],
];

export function guessCategory(text: string): string {
  for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return "default";
}

function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** Ambil HTML halaman produk dengan timeout 8 dtk + UA browser. */
export async function fetchProductHtml(url: string): Promise<{ ok: boolean; status: number; html?: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "id-ID,id;q=0.9,en;q=0.8",
      },
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html };
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError" ? "timeout 8 detik" : String(err);
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function extractFromUrl(rawUrl: string): Promise<ExtractResult> {
  const check = validateMarketplaceUrl(rawUrl);
  if (!check.ok) {
    return { extracted: false, reason: `url ditolak: ${check.reason}`, message: "Link-nya bukan dari marketplace yang kami dukung. Isi manual aja ya, cuma 3 kolom kok." };
  }

  const fetched = await fetchProductHtml(rawUrl);
  if (fetched.error) {
    return { extracted: false, reason: `fetch gagal: ${fetched.error}`, message: "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok." };
  }
  if (!fetched.ok) {
    // Bot-block (403/429/503) atau halaman error — laporkan status persisnya
    return {
      extracted: false,
      reason: `HTTP ${fetched.status} dari marketplace (kemungkinan proteksi bot)`,
      message: "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok.",
    };
  }

  const html = fetched.html ?? "";
  const og = parseOpenGraph(html);
  if (!og.title && !og.image) {
    return {
      extracted: false,
      reason: "tidak ada tag Open Graph di halaman (kemungkinan halaman login/anti-bot)",
      message: "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok.",
    };
  }

  const price = parsePriceFromHtml(html);
  const name = og.title?.slice(0, 120) ?? undefined;
  const imageUrls = og.image ? [absolutize(og.image, rawUrl)] : [];
  return {
    extracted: true,
    name,
    priceIdr: price, // null bila tidak ketemu — user isi manual
    categoryGuess: guessCategory(`${name ?? ""} ${og.description ?? ""}`),
    imageUrls,
  };
}
