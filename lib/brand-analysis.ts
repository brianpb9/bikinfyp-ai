// Analisa bisnis brand dari website (F-ENT-01 M7, 2026-08-11) — "paste
// link, AI baca, auto-isi profil". Beda dari lib/extract.ts (yang baca
// HALAMAN PRODUK marketplace demi harga/foto): ini baca HOMEPAGE brand apa
// saja demi identitas (nama, jenis usaha, kategori, audiens, elevator
// pitch) — makanya butuh guard SSRF sendiri (validateGeneralWebUrl, bukan
// validateMarketplaceUrl yang whitelist-domain).
import { validateGeneralWebUrl } from "./url-safety";
import { config } from "./config";

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const MODEL = "gemini-flash-latest";

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
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export interface BrandHomepage {
  url: string;
  title: string | null;
  ogDescription: string | null;
  bodyText: string;
}

export async function fetchBrandHomepage(rawUrl: string): Promise<BrandHomepage> {
  const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const safety = await validateGeneralWebUrl(normalized);
  if (!safety.ok) throw new Error(`URL ditolak: ${safety.reason}`);
  const res = await fetch(normalized, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!res.ok) throw new Error(`Website membalas HTTP ${res.status}.`);
  const html = await res.text();
  const title = metaContent(html, "og:title") ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
  const ogDescription = metaContent(html, "og:description") ?? metaContent(html, "description");
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  const bodyText = stripTags(bodyMatch ? bodyMatch[0] : html).slice(0, 4000);
  return { url: normalized, title, ogDescription, bodyText };
}

export interface BrandProfile {
  business_name: string;
  business_type: string;
  category: string;
  audience: string;
  elevator_pitch: string;
}

/** Kirim ringkasan homepage ke Gemini, minta profil bisnis terstruktur. */
export async function analyzeBrandProfile(page: BrandHomepage): Promise<BrandProfile> {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY belum di-set — analisa bisnis tidak bisa jalan.");
  const instruction =
    "You are reading a business website's homepage (title, meta description, and visible text below) to build " +
    "a short business profile for a TikTok Shop content tool. Respond ONLY with a JSON object with these exact " +
    "keys, all string values in Indonesian: business_name (the brand/company name), business_type (one of: " +
    '"Jasa" (services/agency/consultant), "Toko Lokal" (local business, restaurant, salon), "Produk" ' +
    "(e-commerce/manufacturer selling physical products)), category (short: e.g. \"Skincare\", \"Fashion\", " +
    '"Agency Digital Marketing"), audience (who the business sells to, one short phrase), elevator_pitch ' +
    "(2-3 sentences introducing the business, written for a brand's own marketing use, confident and specific, " +
    "not generic). If the page content is too thin to be confident, make a reasonable best guess rather than " +
    "leaving fields empty. Output ONLY the JSON object, no markdown fences, no other text.";
  const prompt = `${instruction}\n\nURL: ${page.url}\nTitle: ${page.title ?? "(tidak ada)"}\nMeta description: ${page.ogDescription ?? "(tidak ada)"}\nIsi halaman:\n${page.bodyText}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${config.geminiApiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  const text = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: respons tanpa hasil analisa.");
  let parsed: Partial<BrandProfile>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini: hasil analisa bukan JSON valid.");
  }
  const required: (keyof BrandProfile)[] = ["business_name", "business_type", "category", "audience", "elevator_pitch"];
  for (const key of required) {
    if (typeof parsed[key] !== "string" || !parsed[key]) throw new Error(`Gemini: field "${key}" hilang dari hasil analisa.`);
  }
  return parsed as BrandProfile;
}
