// Anti-SSRF (NF-SEC08): whitelist domain marketplace, tolak IP/internal/skema aneh.

// shp.ee: domain resmi Shopee untuk short-link dari tombol "Bagikan" di app —
// bukan subdomain shopee.co.id, jadi harus didaftarkan terpisah.
export const WHITELIST_DOMAINS = ["tiktok.com", "shopee.co.id", "tokopedia.com", "shp.ee"];

export function validateMarketplaceUrl(raw: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL tidak valid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, reason: "skema tidak diizinkan" };
  const host = url.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "localhost" || host.endsWith(".internal"))
    return { ok: false, reason: "IP/host internal ditolak" };
  const allowed = WHITELIST_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  if (!allowed) return { ok: false, reason: "domain di luar whitelist" };
  return { ok: true };
}
