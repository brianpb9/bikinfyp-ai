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
  const allowed = WHITELIST_DOMAINS.some((d) => host === d || host.endsWith("." + d)) || isControlledStagingProductUrl(raw);
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
import net from "node:net";

const CONTROLLED_STAGING_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
const CONTROLLED_STAGING_ORIGIN = "https://racun-ai-staging-web.onrender.com";
const CONTROLLED_STAGING_PRODUCT_PATH = "/api/staging-fixtures/e2/product";
const CONTROLLED_STAGING_REDIRECT_PATH = "/api/staging-fixtures/e2/redirect-private";
const CONTROLLED_STAGING_IMAGE_PATH = "/staging-fixtures/e2-product.svg";

export function controlledStagingFixtureEnabled(): boolean {
  return process.env.RENDER_SERVICE_ID === CONTROLLED_STAGING_SERVICE_ID;
}

export function isControlledStagingProductUrl(raw: string): boolean {
  if (!controlledStagingFixtureEnabled()) return false;
  try {
    const url = new URL(raw);
    return url.origin === CONTROLLED_STAGING_ORIGIN &&
      (url.pathname === CONTROLLED_STAGING_PRODUCT_PATH || url.pathname === CONTROLLED_STAGING_REDIRECT_PATH) &&
      !url.search && !url.hash;
  } catch { return false; }
}

export function isControlledStagingImageUrl(raw: string): boolean {
  if (!controlledStagingFixtureEnabled()) return false;
  try {
    const url = new URL(raw);
    return url.origin === CONTROLLED_STAGING_ORIGIN && url.pathname === CONTROLLED_STAGING_IMAGE_PATH && !url.search && !url.hash;
  } catch { return false; }
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a,b,c,d]=ip.split(".").map(Number);
    if ([a,b,c,d].some((x)=>x<0||x>255)) return true;
    return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||
      (a===192&&(b===0||b===168||(b===88&&c===99)||(b===0&&c===2)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||
      (a===203&&b===0&&c===113)||a>=224;
  }
  if (net.isIP(ip) !== 6 || ip.includes("%")) return true;
  const lower=ip.toLowerCase();
  const dotted=lower.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let normalized=lower;
  if(dotted){const octets=dotted[2].split(".").map(Number);if(octets.some(x=>x>255))return true;normalized=`${dotted[1]}${((octets[0]<<8)|octets[1]).toString(16)}:${((octets[2]<<8)|octets[3]).toString(16)}`}
  const halves=normalized.split("::");if(halves.length>2)return true;
  const left=halves[0]?halves[0].split(":"):[],right=halves[1]?halves[1].split(":"):[],fill=8-left.length-right.length;
  if(fill<(halves.length===2?1:0))return true;const words=[...left,...Array(fill).fill("0"),...right].map(x=>Number.parseInt(x||"0",16));if(words.length!==8||words.some(x=>!Number.isFinite(x)||x>0xffff))return true;
  if(words.slice(0,5).every(x=>x===0)&&words[5]===0xffff){const mapped=`${words[6]>>8}.${words[6]&255}.${words[7]>>8}.${words[7]&255}`;return isPrivateOrReservedIp(mapped)}
  // Only global unicast 2000::/3 is eligible. Reject documentation/special
  // 2001::/23 and 6to4, which can encode a non-global IPv4 destination.
  if((words[0]&0xe000)!==0x2000)return true;
  if(words[0]===0x2001&&words[1]<0x0200)return true;
  if(words[0]===0x2001&&words[1]===0x0db8)return true;
  if(words[0]===0x2002)return true;
  if(words[0]===0x3fff&&(words[1]&0xf000)===0)return true; // documentation-only 3fff::/20
  return false;
}

export type ResolvedPublicUrl = { ok: true; url: URL; addresses: dns.LookupAddress[] } | { ok: false; reason: string };
export async function resolvePublicFetchUrl(raw:string,lookup:typeof dns.promises.lookup=dns.promises.lookup):Promise<ResolvedPublicUrl>{
  let url:URL;try{url=new URL(raw)}catch{return{ok:false,reason:"URL tidak valid"}};
  if(!["http:","https:"].includes(url.protocol))return{ok:false,reason:"skema tidak diizinkan"};
  if(url.username||url.password)return{ok:false,reason:"userinfo ditolak"};
  const host=url.hostname.toLowerCase();if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal"))return{ok:false,reason:"host internal ditolak"};
  if(net.isIP(host)&&isPrivateOrReservedIp(host))return{ok:false,reason:"IP/host internal ditolak"};
  try{const addresses=await lookup(host,{all:true,verbatim:true}) as dns.LookupAddress[];if(!addresses.length)return{ok:false,reason:"domain tidak bisa di-resolve"};if(addresses.some(a=>isPrivateOrReservedIp(a.address)))return{ok:false,reason:"domain resolve ke IP privat/internal"};return{ok:true,url,addresses}}catch{return{ok:false,reason:"domain tidak bisa di-resolve"}}
}

/** Resolve before every outbound marketplace hop. Redirect targets are checked
 * again by the caller, so a controlled staging URL cannot redirect outside the
 * exact first-party path and marketplace redirects cannot reach private space. */
export async function validateMarketplaceFetchUrl(
  raw: string,
  lookup: typeof dns.promises.lookup = dns.promises.lookup
): Promise<ResolvedPublicUrl> {
  const syntactic = validateMarketplaceUrl(raw);
  if (!syntactic.ok) return {ok:false,reason:syntactic.reason??"url ditolak"};
  return resolvePublicFetchUrl(raw,lookup);
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
