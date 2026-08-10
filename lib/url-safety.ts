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

// Anti-SSRF untuk fetch website BEBAS (F-ENT-01 M7, analisa bisnis brand) —
// beda dari validateMarketplaceUrl: TIDAK ada whitelist domain (website
// brand apa saja boleh), tapi justru karena itu proteksi IP/internal harus
// lebih ketat. Resolve DNS dan cek SEMUA IP hasilnya (bukan cuma hostname
// literal) — menutup celah DNS rebinding (hostname publik saat dicek,
// tapi resolve ke IP privat saat fetch beneran terjadi).
import dns from "node:dns";

function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this network"
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
  return false;
}

export async function validateGeneralWebUrl(raw: string): Promise<{ ok: boolean; reason?: string; hostname?: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL tidak valid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "skema tidak diizinkan" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "host internal ditolak" };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateOrReservedIp(host)) {
    return { ok: false, reason: "IP privat/internal ditolak" };
  }
  try {
    const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (addrs.length === 0) return { ok: false, reason: "domain tidak bisa di-resolve" };
    if (addrs.some((a) => isPrivateOrReservedIp(a.address))) {
      return { ok: false, reason: "domain resolve ke IP privat/internal" };
    }
  } catch {
    return { ok: false, reason: "domain tidak bisa di-resolve" };
  }
  return { ok: true, hostname: host };
}
