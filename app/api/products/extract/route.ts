import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { extractFromUrl, canExtract, cleanProductName } from "@/lib/extract";
import { getDb, now, uuid, audit } from "@/lib/db";
import { downloadProductImages } from "@/lib/product-image-download";
import { createSignedUrl } from "@/lib/signed-url";
import { pgAudit, pgCanExtract, postgresRuntimeEnabled, smokeCreateProduct } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_MSG = "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok.";

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
    const images = result.imageUrls?.length ? await downloadProductImages(productId, result.imageUrls) : [];
    // Harga coret hanya dipakai bila konsisten (> harga jual) — cek ulang di sini
    // karena user bisa mengubah harga di kartu konfirmasi nanti (PATCH memvalidasi lagi).
    const promoBefore =
      result.originalPriceIdr && result.priceIdr && result.originalPriceIdr > result.priceIdr
        ? result.originalPriceIdr
        : null;
    if (postgresRuntimeEnabled()) await smokeCreateProduct(user.id, {
      sourceUrl: url, name: cleanProductName(result.name ?? "Produk dari link"), priceIdr: result.priceIdr ?? 0,
      category: result.categoryGuess ?? "default", images, productVisualDesc: result.visualDesc ?? null,
      promoPriceBeforeIdr: promoBefore, rawMeta: { og: { price: result.priceIdr, original: result.originalPriceIdr } },
    }, productId);
    else getDb()
      .prepare(
        "INSERT INTO products (id, user_id, source_url, name, price_idr, category, product_visual_desc, images, promo_price_before_idr, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        productId, user.id, url, cleanProductName(result.name ?? "Produk dari link"),
        result.priceIdr ?? 0, result.categoryGuess ?? "default", result.visualDesc ?? null,
        JSON.stringify(images), promoBefore,
        JSON.stringify({ og: { price: result.priceIdr, original: result.originalPriceIdr } }), now()
      );
    if (postgresRuntimeEnabled()) await pgAudit(user.id, "product.extracted", "products", productId, { reason: "ok", price: result.priceIdr });
    else audit(user.id, "product.extracted", "products", productId, { reason: "ok", price: result.priceIdr });

    return Response.json({
      extracted: true,
      product_id: productId,
      name: result.name,
      price_idr: result.priceIdr, // null bila tak ketemu — field harga disorot wajib di S2
      category: result.categoryGuess,
      product_visual_desc: result.visualDesc ?? null,
      promo_price_before_idr: promoBefore,
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
