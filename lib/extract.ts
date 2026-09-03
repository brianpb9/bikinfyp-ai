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
// Tabel kata kunci pindah ke lib/category-guess.ts agar bisa dipakai komponen
// klien juga (file ini mengimpor getDb, jadi server-only).
import { guessCategory } from "./category-guess";
export { guessCategory };
import { getDb } from "./db";

export interface ExtractResult {
  extracted: boolean;
  name?: string;
  priceIdr?: number | null;
  categoryGuess?: string;
  imageUrls?: string[];
  /** Harga normal (coret) dari state halaman — prefill add-on Promo. */
  originalPriceIdr?: number | null;
  /** Deskripsi tersaring untuk field "deskripsi visual produk" (boleh null). */
  visualDesc?: string | null;
  reason?: string; // alasan spesifik bila gagal (debug)
  message?: string; // pesan user (Bahasa Indonesia)
}

/**
 * User-Agent DESKTOP, dan itu keputusan yang diukur — bukan selera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SHOPEE MENJAWAB BERBEDA UNTUK PONSEL
 * ────────────────────────────────────────────────────────────────────────────
 * Diuji ke link pendek yang sungguhan (id.shp.ee, 3 Sep 2026), empat kombinasi
 * header:
 *
 *   UA ponsel  -> HTTP 200 TANPA pengalihan, isinya halaman depan Shopee
 *   UA desktop -> HTTP 301 ke shopee.co.id/product/817167067/...
 *
 * Header `accept` tidak berpengaruh sama sekali; yang menentukan hanya UA.
 * Dengan UA ponsel, Shopee menganggap perangkatnya bisa membuka aplikasi dan
 * menyajikan halaman pembuka aplikasi — yang tag Open Graph-nya adalah tag
 * halaman depan, bukan produk.
 *
 * Itulah kenapa link Tokopedia berhasil sementara Shopee tidak: pengalihan
 * Tokopedia tidak bergantung UA, Shopee bergantung.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const EXTRACT_RATE_LIMIT = 10; // per 15 menit per user

/**
 * Judul yang menandakan HALAMAN DEPAN marketplace, bukan halaman produk.
 *
 * Sengaja sempit: yang dicocokkan adalah bentuk judul beranda yang stabil,
 * bukan sekadar mengandung nama marketplace — judul produk yang sah hampir
 * selalu berakhiran "| Shopee Indonesia", dan menolak semuanya akan membuang
 * jauh lebih banyak ekstraksi yang benar daripada yang salah.
 */
const JUDUL_BERANDA: RegExp[] = [
  /^Shopee\s+Indonesia\s*\|/i,
  /Situs Belanja Online Terlengkap/i,
  /^Tokopedia\s*[|-]\s*Jual Beli Online/i,
  /^Jual Beli Online Aman dan Nyaman/i,
  /^TikTok\s*[-|]\s*Make Your Day/i,
  /^Belanja Online/i,
];

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
  // PEMINDAIAN "Rp..." ADALAH JALUR TERAKHIR, DAN IA MUDAH SALAH.
  //
  // Halaman produk Shopee tidak memuat harga aslinya di HTML sisi server —
  // harganya digambar di browser. Yang tersisa di HTML hanyalah teks
  // boilerplate: syarat voucher, ambang gratis ongkir, batas cicilan. Pada
  // halaman deterjen 5 liter (3 Sep 2026) SELURUH 13 pola "Rp" berbunyi sama:
  // "Rp1.000.000" — ambang voucher, bukan harga produk.
  //
  // Mengambilnya berarti mengisi kolom harga dengan angka yang salah, PERCAYA
  // DIRI. Harga itu lalu masuk ke hook video: "cuma sejuta!" untuk produk
  // seharga puluhan ribu. Kolom kosong yang diisi orang jauh lebih baik
  // daripada kolom terisi yang salah — apalagi karena harga memang wajib
  // dikonfirmasi pengguna sebelum render.
  //
  // Jadi: nilai yang berulang banyak kali dan SELALU SAMA diperlakukan sebagai
  // boilerplate. Halaman produk sungguhan memang mengulang harganya, tapi
  // biasanya bersama harga lain (coret, cicilan, varian) — keseragaman total
  // di banyak kemunculan justru tanda ia bukan harga produk.
  const semuaRp = [...html.matchAll(/Rp\s?([0-9]{1,3}(?:\.[0-9]{3})+)/g)]
    .map((m) => parseInt(m[1].replace(/\./g, ""), 10))
    .filter((n) => Number.isFinite(n) && n >= 1000 && n < 1e10);
  if (!semuaRp.length) return null;
  const unik = new Set(semuaRp);
  if (unik.size === 1 && semuaRp.length >= 5) return null;
  return semuaRp[0];
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


function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** Ambil HTML halaman produk dengan timeout 8 dtk + UA browser. */
/**
 * Ambil halaman produk, SAMBIL MENCATAT seluruh rantai pengalihan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA PENGALIHANNYA DIIKUTI SENDIRI, BUKAN OLEH fetch
 * ────────────────────────────────────────────────────────────────────────────
 * Dua alasan, dan keduanya ditemukan dari link nyata yang gagal
 * (vt.tokopedia.com, 3 Sep 2026):
 *
 * 1. DATANYA ADA DI URL PENGALIHAN, bukan di halaman tujuan. Link berbagi
 *    TikTok Shop / Tokopedia mengalihkan ke alamat yang membawa parameter
 *    `og_info` berisi JUDUL dan FOTO produk — sementara halaman tujuannya
 *    sendiri menjawab "Security Check" tanpa satu pun tag Open Graph. Dengan
 *    redirect: "follow", alamat perantara itu hilang sebelum sempat dibaca.
 *
 * 2. KEAMANAN. `redirect: "follow"` mengikuti pengalihan ke MANA PUN —
 *    termasuk keluar dari daftar putih marketplace. Sebuah link marketplace
 *    yang sah bisa mengalihkan ke alamat internal, dan seluruh penjagaan
 *    anti-SSRF di validateMarketplaceUrl terlewati begitu saja. Di sini tiap
 *    lompatan divalidasi ulang.
 */
export interface HasilFetchProduk {
  ok: boolean;
  status: number;
  html?: string;
  error?: string;
  /** Seluruh alamat yang dilewati, termasuk yang pertama dan yang terakhir. */
  rantai: string[];
}

const MAKS_LOMPATAN = 5;

export async function fetchProductHtml(url: string): Promise<HasilFetchProduk> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const rantai: string[] = [url];
  try {
    let sekarang = url;
    for (let lompat = 0; lompat <= MAKS_LOMPATAN; lompat++) {
      const res = await fetch(sekarang, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "id-ID,id;q=0.9,en;q=0.8",
        },
      });

      const lokasi = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!lokasi) {
        const html = await res.text();
        return { ok: res.ok, status: res.status, html, rantai };
      }

      const berikut = new URL(lokasi, sekarang).toString();
      // TIAP LOMPATAN divalidasi ulang. Link marketplace yang sah tetap bisa
      // mengalihkan ke luar daftar putih, dan tanpa pemeriksaan ini seluruh
      // penjagaan anti-SSRF hanya berlaku untuk alamat pertama.
      const sah = validateMarketplaceUrl(berikut);
      if (!sah.ok) {
        return { ok: false, status: res.status, error: `pengalihan ke luar daftar putih: ${sah.reason}`, rantai };
      }
      rantai.push(berikut);
      sekarang = berikut;
    }
    return { ok: false, status: 0, error: `pengalihan lebih dari ${MAKS_LOMPATAN} kali`, rantai };
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError" ? "timeout 8 detik" : String(err);
    return { ok: false, status: 0, error: msg, rantai };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Baca judul dan foto dari PARAMETER URL pengalihan.
 *
 * Link berbagi TikTok Shop dan Tokopedia membawa `og_info` — JSON ber-encode
 * URL berisi {title, image} — persis supaya aplikasi chat bisa menampilkan
 * pratinjau tanpa membuka halamannya. Kita memanfaatkan hal yang sama, dan
 * itulah satu-satunya jalan masuk ketika halaman tujuannya dijaga anti-bot.
 *
 * Parameter lain yang kadang membawa hal serupa ikut dicoba. Yang tidak
 * terbaca dilewati diam-diam: ini jalur CADANGAN, bukan sumber utama, dan
 * kegagalannya tidak boleh menjatuhkan apa pun.
 */
export function parseOgInfoDariUrl(daftarUrl: string[]): { title?: string; image?: string } {
  const hasil: { title?: string; image?: string } = {};
  for (const u of daftarUrl) {
    let params: URLSearchParams;
    try { params = new URL(u).searchParams; } catch { continue; }
    for (const kunci of ["og_info", "ogInfo", "share_info"]) {
      const mentah = params.get(kunci);
      if (!mentah) continue;
      try {
        const obj = JSON.parse(mentah) as { title?: unknown; image?: unknown };
        if (!hasil.title && typeof obj.title === "string" && obj.title.trim()) hasil.title = obj.title.trim();
        if (!hasil.image && typeof obj.image === "string" && /^https?:\/\//.test(obj.image)) hasil.image = obj.image;
      } catch { /* bukan JSON — lewati */ }
    }
  }
  return hasil;
}

/** Ambil URL gambar dari blok JSON-LD (schema.org Product.image: string | string[]
 * | ImageObject | campuran). Toleran terhadap JSON rusak — blok yang gagal
 * di-parse dilewati. */
export function parseJsonLdImages(html: string): string[] {
  const out: string[] = [];
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const pushImage = (val: unknown) => {
    if (typeof val === "string" && /^https?:\/\//.test(val)) out.push(val);
    else if (Array.isArray(val)) val.forEach(pushImage);
    else if (val && typeof val === "object" && "url" in val) pushImage((val as { url: unknown }).url);
  };
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const obj = node as Record<string, unknown>;
    if ("image" in obj) pushImage(obj.image);
    if ("@graph" in obj) walk(obj["@graph"]);
  };
  for (const m of blocks) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* blok JSON-LD rusak — lewati */
    }
  }
  return out;
}

/** Fallback foto: pindai URL gambar produk yang tertanam di state JSON halaman
 * (halaman lite marketplace sering TANPA JSON-LD — kasus nyata tk.tokopedia.com
 * 2026-08-06: 0 blok ld+json tapi ~9 foto produk sebagai signed URL bergaya
 * Bytedance `~tplv`). Unescape dulu (\/ dan & — signed URL butuh query
 * signature utuh), lalu dedup per content-hash (tiap foto muncul berkali-kali
 * sebagai varian resize/white-p di mirror p16/p19). URL rusak/terpotong tidak
 * berbahaya: downloadImages memverifikasi via decoder sharp sebelum dipakai. */
export function parseInlineProductImages(html: string): string[] {
  const unescaped = html.replace(/\\\//g, "/").replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&");
  const matches = unescaped.match(/https:\/\/[a-z0-9.-]+\/[^"'\s<>\\]+~tplv[^"'\s<>\\]*/g) ?? [];
  const byHash = new Map<string, string>();
  for (const url of matches) {
    // Wajib punya segmen content-hash hex — menyaring aset non-produk yang
    // kebetulan bergaya ~tplv (favicon.ico~tplv, 192px.png~tplv, logo, dll).
    const hash = /\/([a-f0-9]{16,40})~/.exec(url)?.[1];
    if (!hash) continue;
    // Varian "resize" lebih netral daripada "white-p" (padded) — utamakan.
    if (!byHash.has(hash) || (url.includes("resize") && !byHash.get(hash)!.includes("resize"))) {
      byHash.set(hash, url);
    }
  }
  return [...byHash.values()];
}

/** Harga normal (coret) dari state halaman — kunci bergaya original/slash/
 * market price dengan nilai LEBIH BESAR dari harga jual. Dipakai untuk prefill
 * add-on Promo (keputusan Brian 2026-08-06: "harga normal bisa diisi dong").
 * Ambil kandidat terkecil yang tetap > harga jual (menghindari harga bundel). */
export function parseOriginalPriceFromHtml(html: string, priceIdr: number | null): number | null {
  if (!priceIdr) return null;
  const unescaped = html.replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
  const candidates: number[] = [];
  for (const m of unescaped.matchAll(/"(\w*(?:original|slash|market|before)\w*(?:price|Price)\w*|\w*(?:price|Price)\w*(?:Original|Slash|Before)\w*)"\s*:\s*"?(?:Rp\.?\s?)?([\d.,]{4,15})"?/gi)) {
    const n = parseInt(m[2].replace(/[.,](?=\d{3}\b)/g, "").replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n > priceIdr && n < 1_000_000_000) candidates.push(n);
  }
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

const DESC_BOILERPLATE = [
  /promo khusus pengguna baru[^.!]*[.!]?/gi,
  /\bdi aplikasi tokopedia\b[^.!]*[.!]?/gi,
  /\bgratis ongkir\b[^.!]*[.!]?/gi,
  /\bcicilan 0%[^.!]*[.!]?/gi,
  // Ekor nama toko: "di Skin1004 Mall.", "di TokoAbc Official Store"
  /\bdi\s+[A-Za-z0-9_ ]{2,30}?(?:Mall|Official\s*(?:Store|Shop)?|Store)\b\.?/gi,
];

/** Bersihkan og:description untuk prefill "deskripsi visual produk". PENTING:
 * field ini ikut masuk PROMPT render ("The product is ...") — teks marketing
 * ("PROMO TERMURAH!!") merusak konsistensi visual. Buang boilerplate & overlap
 * dengan judul; kalau tidak tersisa kalimat bermakna, kembalikan null (biarkan
 * kosong daripada mengarang). */
export function cleanDescriptionForVisual(desc: string | undefined, title: string | undefined): string | null {
  const strip = (s: string) =>
    s
      .replace(/\b(promo|diskon|termurah|murah|cod|official store|original|ready stock|bisa cod|gratis ongkir|flash sale|terlaris|best ?seller)\b/gi, " ")
      .replace(/[!¡🔥⚡✨💥]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,.\-–|]+|[\s,.\-–|]+$/g, "")
      .trim();
  let out = desc ?? "";
  const bareTitle = (title ?? "")
    .replace(/\s*(\||-)\s*(Tokopedia|Shopee|Lazada|Blibli).*$/i, "")
    .replace(/\s+di\s+[A-Za-z0-9 ]{2,30}(Mall|Store|Official)?\s*$/i, "")
    .trim();
  if (bareTitle.length >= 10) out = out.split(bareTitle).join(" ");
  for (const re of DESC_BOILERPLATE) out = out.replace(re, " ");
  out = strip(out);
  if (out.length >= 15) return out.slice(0, 160);
  // Fallback (permintaan Brian 2026-08-06: deskripsi jangan kosong): judul yang
  // sudah dibersihkan biasanya memuat identitas visual berguna (merek, varian,
  // ukuran "30ml") — lebih baik daripada kosong, tetap tanpa kata marketing.
  const fromTitle = strip(bareTitle);
  return fromTitle.length >= 10 ? fromTitle.slice(0, 160) : null;
}

export async function extractFromUrl(rawUrl: string): Promise<ExtractResult> {
  const check = validateMarketplaceUrl(rawUrl);
  if (!check.ok) {
    return { extracted: false, reason: `url ditolak: ${check.reason}`, message: "Link-nya bukan dari marketplace yang kami dukung. Isi manual aja ya, cuma 3 kolom kok." };
  }

  const fetched = await fetchProductHtml(rawUrl);
  // JALUR CADANGAN dari rantai pengalihan — dibaca DULUAN, karena ia tetap
  // berguna bahkan ketika halaman tujuannya gagal atau dijaga anti-bot.
  //
  // Link berbagi TikTok Shop / Tokopedia membawa judul dan foto produk di
  // parameter `og_info` alamat pengalihannya, sementara halaman tujuannya
  // menjawab "Security Check" tanpa satu pun tag Open Graph (diverifikasi pada
  // vt.tokopedia.com, 3 Sep 2026). Tanpa jalur ini, seluruh link berbagi dari
  // aplikasi — bentuk yang paling sering dipakai orang — selalu gagal.
  const dariUrl = parseOgInfoDariUrl(fetched.rantai);

  const html = fetched.html ?? "";
  const og = fetched.ok ? parseOpenGraph(html) : {};
  const judul = og.title ?? dariUrl.title;
  const fotoUrl = og.image ?? dariUrl.image;

  // HALAMAN DEPAN MARKETPLACE BUKAN PRODUK.
  //
  // Ketika marketplace menyajikan cangkang aplikasi alih-alih halaman produk —
  // anti-bot, pengalihan yang tidak terjadi, atau tautan yang sudah mati — tag
  // Open Graph-nya tetap ADA dan tetap terbaca. Isinya judul situs.
  //
  // Terjadi 3 Sep 2026: link Shopee menghasilkan produk bernama "Shopee
  // Indonesia | Situs Belanja Online Terlengkap & Terpercaya", lengkap dengan
  // foto banner beranda. Itu lebih buruk daripada gagal: form terisi dengan
  // percaya diri oleh data yang salah, dan orang bisa saja meneruskannya.
  //
  // Judul beranda punya bentuk yang khas dan stabil, jadi ia bisa dikenali —
  // dan menolaknya mengembalikan alur ke pengisian manual, yang benar.
  if (judul && JUDUL_BERANDA.some((re) => re.test(judul))) {
    return {
      extracted: false,
      reason: `halaman depan marketplace, bukan produk (judul: "${judul.slice(0, 80)}")`,
      message: "Link-nya mengarah ke halaman depan toko, bukan ke produknya. Buka produknya lalu salin link dari tombol Bagikan ya.",
    };
  }

  if (!judul && !fotoUrl) {
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
    return {
      extracted: false,
      reason: "tidak ada tag Open Graph di halaman maupun di rantai pengalihan (kemungkinan halaman login/anti-bot)",
      message: "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok.",
    };
  }

  const price = parsePriceFromHtml(html);
  const name = judul?.slice(0, 120) ?? undefined;
  // USP (keputusan Brian 2026-08-06): foto dari link harus ikut ter-copy
  // sebanyak mungkin — bukan cuma 1 og:image. Sumber digabung berurutan:
  // og:image (foto utama) -> JSON-LD Product.image -> pindaian state halaman.
  // Dedup per content-hash (og:image dan varian inline = foto yang sama), maks 5.
  const candidates = [
    ...(fotoUrl ? [fotoUrl] : []),
    ...parseJsonLdImages(html),
    ...parseInlineProductImages(html),
  ].map((u) => absolutize(u, rawUrl));
  const seenHash = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of candidates) {
    const hash = /\/([a-f0-9]{16,40})~/.exec(u)?.[1] ?? u;
    if (seenHash.has(hash)) continue;
    seenHash.add(hash);
    imageUrls.push(u);
    if (imageUrls.length >= 5) break;
  }
  return {
    extracted: true,
    name,
    priceIdr: price, // null bila tidak ketemu — user isi manual
    categoryGuess: guessCategory(`${name ?? ""} ${og.description ?? ""}`),
    imageUrls,
    originalPriceIdr: parseOriginalPriceFromHtml(html, price),
    visualDesc: cleanDescriptionForVisual(og.description, judul),
  };
}

// --- Pembersih nama produk marketplace (2026-08-11) ---
//
// Judul Tokopedia/Shopee adalah tumpukan kata kunci SEO, bukan nama produk:
//   "Promo SKINTIFlC - Instant Glowing First Serum Spray 50ML/100ML |
//    Radiance Booster Essence wajah Toner Centella Kulit Leb"
// 18 kata, dipotong di tengah kata ("Leb"), plus embel-embel promo.
//
// Nama ini masuk ke kalimat skrip. Tier bersuara dibatasi ~30 kata total
// (L-05), jadi nama 18 kata membuat SETIAP varian gagal validasi — dan
// karena ekstraksi link adalah jalur utama, praktis semua produk marketplace
// tidak bisa dibuatkan video. Terbukti dari data production: nama asli 0/4
// varian lolos, versi dipendekkan 4/4 lolos.
//
// Pembersihan sengaja KONSERVATIF: hanya memotong bagian yang jelas bukan
// nama (embel-embel promo, spesifikasi ukuran, ekor setelah pemisah), dan
// hanya memangkas panjang bila masih kepanjangan. User tetap bisa mengedit
// nama di langkah Detail — ini cuma default yang waras.
const MARKETING_PREFIXES = /^(promo|sale|diskon|murah|terlaris|viral|ready|new|original|bpom|cod|grosir|best\s*seller)\b[\s\-–—:.]*/gi;

/** Token spesifikasi/ukuran: "50ML", "100ml/50ml", "30gr", "20 ml", "2pcs". */
const SPEC_TOKEN = /^(\d+(\.\d+)?\s*(ml|gr|gram|g|kg|l|liter|pcs|pack|sachet|cm|mm|inch)\b[\/\d\w]*|[\d/]+(ml|gr|g|kg|pcs)\b)$/i;

/** Label promo dalam kurung: "[ SPECIAL MEGA LIVE ]", "(FLASH SALE)", "【BARU】".
 *
 *  Pola paling umum di judul marketplace, dan sebelumnya TIDAK dikenali sama
 *  sekali. Akibatnya fatal karena pemotongan di bawah mengambil enam kata
 *  PERTAMA: judul "[ SPECIAL MEGA LIVE ] JJ Glow Sabun Gluta Pink ..." pulang
 *  sebagai "[ SPECIAL MEGA LIVE ]" — label promonya disimpan, nama produknya
 *  dibuang. Terlihat 16 Agu 2026 ketika Brian tidak bisa membuat skrip untuk
 *  produk nyata dan pesan errornya cuma menebak-nebak sebabnya.
 *
 *  Panjang isinya dibatasi supaya kurung yang membungkus SELURUH judul tidak
 *  menghapus semuanya. */
const BRACKET_TAG = /[[(（【][^\])）】]{0,40}[\])）】]/g;

export function cleanProductName(raw: string, maxWords = 6): string {
  if (!raw) return raw;
  // 1. Ambil segmen pertama sebelum pemisah daftar-kata-kunci.
  let name = raw.split(/[|｜]/)[0];
  // 2. Buang label promo dalam kurung, di mana pun letaknya.
  const tanpaKurung = name.replace(BRACKET_TAG, " ").replace(/\s{2,}/g, " ").trim();
  // Kalau membuang kurung menyisakan terlalu sedikit, judulnya memang seluruhnya
  // di dalam kurung — pertahankan bentuk asli daripada memulangkan sisa acak.
  if (tanpaKurung.split(/\s+/).filter(Boolean).length >= 2) name = tanpaKurung;
  // 3. Buang embel-embel promo di depan (bisa bertumpuk: "Promo Sale ...").
  let before = "";
  while (before !== name) { before = name; name = name.replace(MARKETING_PREFIXES, ""); }
  // 4. Buang token spesifikasi/ukuran di mana pun.
  let words = name.split(/\s+/).filter((w) => w && !SPEC_TOKEN.test(w));
  // 5. Masih panjang -> potong, TAPI buang penggal kata terakhir yang jelas
  //    terpotong ("Leb") supaya tidak jadi kata aneh di skrip.
  if (words.length > maxWords) words = words.slice(0, maxWords);
  const last = words[words.length - 1];
  if (last && last.length <= 3 && /^[A-Za-z]+$/.test(last) && words.length > 2) words = words.slice(0, -1);
  const cleaned = words.join(" ").replace(/[\s\-–—:,.]+$/, "").trim();
  // Jangan pernah mengembalikan string kosong — lebih baik nama asli.
  return cleaned.length >= 3 ? cleaned : raw.trim();
}
