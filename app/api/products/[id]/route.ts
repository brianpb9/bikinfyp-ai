import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, audit, type ProductRow } from "@/lib/db";
import { validPriceIdr, validProductName } from "@/lib/product-validation";
import { parsePromoFields } from "@/lib/promo";
import { pgUpdateProduct, postgresRuntimeEnabled, smokeGetProduct } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/products/[id] — edit konfirmasi setelah ekstraksi (nama/harga/kategori/deskripsi).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const db = postgresRuntimeEnabled() ? null : getDb();
    const product = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, id)
      : db!.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(id, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Produknya");

    const body = await req.json().catch(() => ({}));
    const name = body.name !== undefined ? validProductName(body.name) : product.name;
    const priceIdr = body.price_idr !== undefined ? validPriceIdr(body.price_idr) : product.price_idr;
    const category = body.category !== undefined ? String(body.category).trim() : product.category;
    const visualDesc =
      body.product_visual_desc !== undefined
        ? body.product_visual_desc === null || body.product_visual_desc === ""
          ? null
          : String(body.product_visual_desc).slice(0, 200)
        : product.product_visual_desc ?? null;
    // Add-on promo (opsional): field yang tidak dikirim = pertahankan nilai lama;
    // dikirim kosong/null = hapus.
    const promoTouched =
      body.promo_price_before_idr !== undefined || body.promo_ends_at !== undefined || body.promo_stock_left !== undefined;
    const promo = promoTouched
      ? parsePromoFields((k) => (body as Record<string, unknown>)[k])
      : {
          promoPriceBeforeIdr: product.promo_price_before_idr ?? null,
          promoEndsAt: product.promo_ends_at ?? null,
          promoStockLeft: product.promo_stock_left ?? null,
        };

    if (!name) throw ERR.BAD_REQUEST("Nama produk wajib ada huruf atau angka, bukan emoji saja ya.", "Product name is required.");
    if (!priceIdr)
      throw ERR.BAD_REQUEST("Harganya wajib diisi — harga adalah bahan wajib hook videonya.", "Price is required.");
    if (promo.promoPriceBeforeIdr !== null && promo.promoPriceBeforeIdr <= priceIdr)
      throw ERR.BAD_REQUEST(
        "Harga normal (sebelum diskon) harus lebih besar dari harga jual — kalau tidak, diskonnya bohong.",
        "promo_price_before_idr must exceed price_idr."
      );

    if (postgresRuntimeEnabled()) await pgUpdateProduct(user.id, id, { name, priceIdr, category, productVisualDesc: visualDesc, ...promo });
    else {
      db!.prepare(
        "UPDATE products SET name = ?, price_idr = ?, category = ?, product_visual_desc = ?, promo_price_before_idr = ?, promo_ends_at = ?, promo_stock_left = ? WHERE id = ?"
      ).run(name, priceIdr, category, visualDesc, promo.promoPriceBeforeIdr, promo.promoEndsAt, promo.promoStockLeft, id);
      audit(user.id, "product.updated", "products", id, { name, price_idr: priceIdr, promo: promo.promoPriceBeforeIdr !== null });
    }
    return Response.json({ ok: true, product_id: id, name, price_idr: priceIdr, category });
  } catch (err) {
    return errorResponse(err);
  }
}
