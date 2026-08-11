import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { extractFromUrl, cleanProductName } from "@/lib/extract";
import { downloadProductImages } from "@/lib/product-image-download";
import { createSignedUrl } from "@/lib/signed-url";
import { pgAudit, pgCanExtract, postgresRuntimeEnabled, smokeCreateProduct, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Produk kampanye brand (M8, F-ENT-01). BEDA dari bulk lama (M3-M6) yang
// menerima N link produk × 1 video: brand nyaris selalu fokus ke SATU produk
// unggulan dan mau BANYAK variasi video darinya (arahan Brian 2026-08-11).
// Jadi di sini satu produk dibuat dulu, dilengkapi foto+detail sebanyak
// mungkin (makin lengkap makin bagus hasil render), baru di-fan-out ke 2-6
// video di langkah berikutnya.

function productPayload(product: { id: string; name: string; price_idr: number; category: string; product_visual_desc?: string | null; brand_brief?: string | null; promo_price_before_idr?: number | null; promo_ends_at?: string | null; promo_stock_left?: number | null; images: string; source_url: string | null }) {
  const images = JSON.parse(product.images || "[]") as string[];
  return {
    product_id: product.id,
    name: product.name,
    price_idr: product.price_idr,
    category: product.category,
    product_visual_desc: product.product_visual_desc ?? null,
    brand_brief: product.brand_brief ?? null,
    promo_price_before_idr: product.promo_price_before_idr ?? null,
    promo_ends_at: product.promo_ends_at ?? null,
    promo_stock_left: product.promo_stock_left ?? null,
    source_url: product.source_url,
    images,
    image_urls: images.map((rel) => createSignedUrl(rel)),
  };
}

// POST — buat produk kampanye. Dua jalur: {url} (tarik otomatis dari link)
// atau {name, price_idr, ...} (isi manual, dipakai kalau link gagal dibaca —
// brand tidak boleh mentok cuma karena marketplace-nya memblokir scraper).
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard campaign requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (url) {
      if (!(await pgCanExtract(user.id))) {
        throw ERR.BAD_REQUEST("Batas ekstraksi link tercapai (10 per 15 menit). Tunggu sebentar atau isi manual.", "Extract rate limited.");
      }
      await pgAudit(user.id, "product.extract", "products", null, { url: url.slice(0, 120), campaign: true });
      const result = await extractFromUrl(url);
      if (!result.extracted) {
        // BUKAN error — brand tetap lanjut lewat jalur manual. Client
        // menampilkan form kosong dengan pesan ini sebagai catatan.
        return Response.json({ extracted: false, reason: result.reason ?? null, message: result.message ?? "Link-nya belum bisa kami baca. Isi manual aja ya." });
      }
      const productId = crypto.randomUUID();
      const images = result.imageUrls?.length ? await downloadProductImages(productId, result.imageUrls) : [];
      const promoBefore = result.originalPriceIdr && result.priceIdr && result.originalPriceIdr > result.priceIdr ? result.originalPriceIdr : null;
      const product = await smokeCreateProduct(
        user.id,
        {
          sourceUrl: url, name: cleanProductName(result.name ?? "Produk dari link"), priceIdr: result.priceIdr ?? 0,
          category: result.categoryGuess ?? "default", images, productVisualDesc: result.visualDesc ?? null,
          promoPriceBeforeIdr: promoBefore, rawMeta: { og: { price: result.priceIdr, original: result.originalPriceIdr } },
          orgId: membership.org_id,
        },
        productId
      );
      await pgAudit(user.id, "product.extracted", "products", productId, { reason: "ok", price: result.priceIdr, campaign: true });
      return Response.json({ extracted: true, ...productPayload(product), images_downloaded: images.length });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw ERR.BAD_REQUEST("Isi link produk atau nama produknya dulu.", "url or name is required.");
    const priceIdr = Number.isFinite(Number(body.price_idr)) ? Math.max(0, Math.round(Number(body.price_idr))) : 0;
    const product = await smokeCreateProduct(user.id, {
      sourceUrl: null, name, priceIdr, category: typeof body.category === "string" && body.category ? body.category : "default",
      images: [], productVisualDesc: null, orgId: membership.org_id,
    });
    await pgAudit(user.id, "product.created", "products", product.id, { manual: true, campaign: true });
    return Response.json({ extracted: true, ...productPayload(product), images_downloaded: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH — lengkapi detail produk. Sengaja TIDAK memakai pgUpdateProduct
// (jalur retail /api/products/[id]): fungsi itu tidak tahu brand_brief, jadi
// menambahkannya di sana berisiko menghapus brief diam-diam kalau produk
// brand pernah lewat jalur retail. Update di sini menyentuh persis 5 kolom
// yang memang milik langkah ini.
export async function PATCH(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard campaign requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");

    const existing = await smokeGetProduct(user.id, productId);
    if (!existing || existing.org_id !== membership.org_id) throw ERR.NOT_FOUND("Produknya");

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
    const priceIdr = Number.isFinite(Number(body.price_idr)) ? Math.max(0, Math.round(Number(body.price_idr))) : existing.price_idr;
    const category = typeof body.category === "string" && body.category ? body.category : existing.category;
    const visualDesc = typeof body.product_visual_desc === "string" ? body.product_visual_desc.trim().slice(0, 600) || null : existing.product_visual_desc ?? null;
    const brandBrief = typeof body.brand_brief === "string" ? body.brand_brief.trim().slice(0, 1200) || null : existing.brand_brief ?? null;

    // Urgensi & kelangkaan (add-on Promo, lib/promo.ts). Angka-angka ini
    // BOLEH muncul di caption/overlay tapi tidak boleh dikarang di skrip —
    // resolvePromo() yang memutuskan, dan promo kedaluwarsa otomatis di-drop
    // saat render. Harga coret hanya dipakai kalau LEBIH BESAR dari harga
    // jual; kalau tidak, itu klaim diskon palsu dan kami buang di sini.
    const rawBefore = Number(body.promo_price_before_idr);
    const promoBefore = Number.isFinite(rawBefore) && rawBefore > priceIdr ? Math.round(rawBefore) : null;
    const promoEndsAt = typeof body.promo_ends_at === "string" && body.promo_ends_at.trim()
      ? body.promo_ends_at.trim() : null;
    const rawStock = Number(body.promo_stock_left);
    const promoStock = Number.isFinite(rawStock) && rawStock > 0 ? Math.round(rawStock) : null;

    const pool = getPool(config.databaseUrl);
    try {
      await pool.query(
        "UPDATE products SET name=$1, price_idr=$2, category=$3, product_visual_desc=$4, brand_brief=$5, promo_price_before_idr=$6, promo_ends_at=$7, promo_stock_left=$8 WHERE id=$9 AND user_id=$10",
        [name, priceIdr, category, visualDesc, brandBrief, promoBefore, promoEndsAt, promoStock, productId, user.id]
      );
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
    await pgAudit(user.id, "product.updated", "products", productId, { campaign: true });

    const updated = await smokeGetProduct(user.id, productId);
    if (!updated) throw ERR.NOT_FOUND("Produknya");
    return Response.json(productPayload(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
