import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { extractFromUrl, canExtract } from "@/lib/extract";
import { getDb, now, uuid, audit } from "@/lib/db";
import { config, ensureDirs } from "@/lib/config";
import { runFf } from "@/lib/media/ffmpeg";
import { createSignedUrl } from "@/lib/signed-url";
import fs from "node:fs";
import path from "node:path";
import { mediaStorage } from "@/lib/storage";
import { pgAudit, pgCanExtract, postgresRuntimeEnabled, smokeCreateProduct } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_MSG = "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok.";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/** Unduh gambar OG ke storage produk (maks 5, kompresi sisi panjang ≤1600px — BR-01.5). */
async function downloadImages(productId: string, urls: string[]): Promise<string[]> {
  ensureDirs();
  const dir = path.join(config.storageDir, "uploads", productId);
  fs.mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  for (const [i, url] of urls.slice(0, 5).entries()) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) continue;
      const tmp = path.join(dir, `raw${i}`);
      fs.writeFileSync(tmp, buf);
      const out = path.join(dir, `${i}.jpg`);
      // Validasi + kompresi via PIL (gagal buka = bukan gambar valid → skip)
      await runFf("python3", [
        "-c",
        `from PIL import Image
img = Image.open("${tmp}").convert("RGB")
img.thumbnail((1600, 1600))
img.save("${out}", "JPEG", quality=85)`,
      ]);
      fs.rmSync(tmp, { force: true });
      const rel = path.join("uploads", productId, `${i}.jpg`).split(path.sep).join("/");
      await mediaStorage().put(rel, fs.readFileSync(out), "image/jpeg");
      if (config.storageMode === "r2") fs.rmSync(out, { force: true });
      rels.push(rel);
    } catch {
      /* gambar gagal diunduh/dibuka — lanjut yang lain (F-01 kasus gagal: minta upload manual) */
    }
  }
  return rels;
}

// POST /api/products/extract {url} — ekstraksi nyata: OG + JSON-LD harga + unduh foto.
// Anti-SSRF tetap ketat (lib/url-safety.ts). Rate limit 10/user/15 menit.
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const url = String(body.url ?? "").trim();
    if (!url) throw ERR.BAD_REQUEST("Link produknya belum diisi.", "URL is required.");

    if (!(postgresRuntimeEnabled() ? await pgCanExtract(user.id) : canExtract(user.id))) {
      return Response.json(
        {
          code: "EXTRACT_RATE_LIMITED",
          message_id: "Kamu udah coba ekstrak 10 kali dalam 15 menit. Isi manual dulu ya, cepat kok.",
          message_en: "Extract rate limited.",
          retryable: true,
        },
        { status: 429 }
      );
    }
    if (postgresRuntimeEnabled()) await pgAudit(user.id, "product.extract", "products", null, { url: url.slice(0, 120) });
    else audit(user.id, "product.extract", "products", null, { url: url.slice(0, 120) });

    const result = await extractFromUrl(url);
    if (!result.extracted) {
      return Response.json({ extracted: false, reason: result.reason, message: result.message ?? FALLBACK_MSG });
    }

    // Buat produk langsung (form S2 menampilkan kartu konfirmasi untuk diedit user)
    const productId = uuid();
    const images = result.imageUrls?.length ? await downloadImages(productId, result.imageUrls) : [];
    if (postgresRuntimeEnabled()) await smokeCreateProduct(user.id, {
      sourceUrl: url, name: result.name ?? "Produk dari link", priceIdr: result.priceIdr ?? 0,
      category: result.categoryGuess ?? "default", images, rawMeta: { og: { price: result.priceIdr } },
    }, productId);
    else getDb()
      .prepare(
        "INSERT INTO products (id, user_id, source_url, name, price_idr, category, images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      )
      .run(
        productId, user.id, url, result.name ?? "Produk dari link",
        result.priceIdr ?? 0, result.categoryGuess ?? "default",
        JSON.stringify(images), JSON.stringify({ og: { price: result.priceIdr } }), now()
      );
    if (postgresRuntimeEnabled()) await pgAudit(user.id, "product.extracted", "products", productId, { reason: "ok", price: result.priceIdr });
    else audit(user.id, "product.extracted", "products", productId, { reason: "ok", price: result.priceIdr });

    return Response.json({
      extracted: true,
      product_id: productId,
      name: result.name,
      price_idr: result.priceIdr, // null bila tak ketemu — field harga disorot wajib di S2
      category: result.categoryGuess,
      images,
      // URL bertanda tangan supaya S2 bisa langsung preview foto yang barusan diunduh
      // (tanpa ini, /api/files menolak — butuh exp+sig, bukan path polos).
      image_urls: images.map((rel) => createSignedUrl(rel)),
      images_downloaded: images.length,
      ...(images.length === 0 ? { warning: "Foto dari link gagal diunduh — upload manual ya." } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
