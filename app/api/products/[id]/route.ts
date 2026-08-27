import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, audit, type ProductRow } from "@/lib/db";
import { validBrand, validPriceIdr, validProductName } from "@/lib/product-validation";
import { parsePromoFields } from "@/lib/promo";
import { pgSetProductBrand, pgUpdateProduct, postgresRuntimeEnabled, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import { buildAuthoritativeTypeBoundaryInput, validateAuthoritativeProductType } from "@/lib/product-type-boundary";

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
    // Produk organisasi WAJIB lewat dashboard (RBAC belanja + gerbang review
    // scene + library org). Lihat pastikanBukanProdukOrg.
    pastikanBukanProdukOrg(product);

    const body = await req.json().catch(() => ({}));
    const name = body.name !== undefined ? validProductName(body.name) : product.name;
    const priceIdr = body.price_idr !== undefined ? validPriceIdr(body.price_idr) : product.price_idr;
    const category = body.category !== undefined ? String(body.category).trim() : product.category;
    const productTypeToken = String(body.product_type ?? product.product_type_token ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmationTouched = body.confirmed_product_type !== undefined;
    const confirmedProductTypeToken = String(confirmationTouched ? body.confirmed_product_type : product.product_type_confirmed_token ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmedBy = confirmationTouched ? user.id : String(product.product_type_confirmed_by ?? "");
    const confirmedAt = confirmationTouched ? now() : String(product.product_type_confirmed_at ?? "");
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

    return await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
      { kind: "DECLARED_PRODUCT_TYPE", sourceId: "product-mutation.product_type", token: productTypeToken, version: 1 },
      confirmedProductTypeToken && confirmedBy && confirmedAt
        && (confirmationTouched || product.product_type_state === "CONFIRMED") ? {
        kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: confirmedProductTypeToken, actorId: confirmedBy,
        confirmedAt, version: 1, provenance: "USER_SELF_ASSERTION",
      } : null,
    ), async () => {
    if (postgresRuntimeEnabled()) await pgUpdateProduct(user.id, id, {
      name, priceIdr, category, productTypeToken, productTypeConfirmedToken: confirmedProductTypeToken,
      productTypeConfirmedBy: confirmedBy, productTypeConfirmedAt: confirmedAt, productTypeVersion: 1,
      productVisualDesc: visualDesc, ...promo,
    });
    else {
      db!.prepare(
        `UPDATE products SET name = ?, price_idr = ?, category = ?, product_type_token = ?,
           product_type_confirmed_token = ?, product_type_confirmed_by = ?, product_type_confirmed_at = ?,
           product_type_version = 1, product_type_state = 'CONFIRMED', product_visual_desc = ?,
           promo_price_before_idr = ?, promo_ends_at = ?, promo_stock_left = ? WHERE id = ?`
      ).run(name, priceIdr, category, productTypeToken, confirmedProductTypeToken, confirmedBy, confirmedAt,
        visualDesc, promo.promoPriceBeforeIdr, promo.promoEndsAt, promo.promoStockLeft, id);
      audit(user.id, "product.updated", "products", id, { name, price_idr: priceIdr, promo: promo.promoPriceBeforeIdr !== null });
    }

    // Merek terkonfirmasi user (audit C9) → raw_meta.brand, merge — jangan
    // menimpa hasil scrape (og). Field tidak dikirim = tidak disentuh;
    // dikirim kosong/null = hapus (user menolak usulan yang salah).
    if (body.brand !== undefined) {
      const brand = validBrand(body.brand);
      if (postgresRuntimeEnabled()) await pgSetProductBrand(user.id, id, brand);
      else {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse((product.raw_meta as string | null) ?? "{}") as Record<string, unknown>; } catch { /* raw_meta korup: mulai bersih, og hilang lebih baik daripada PATCH gagal */ }
        if (brand) meta.brand = brand; else delete meta.brand;
        const serialized = Object.keys(meta).length ? JSON.stringify(meta) : null;
        db!.prepare("UPDATE products SET raw_meta = ? WHERE id = ?").run(serialized, id);
        audit(user.id, "product.brand_set", "products", id, { brand });
      }
    }
    return Response.json({ ok: true, product_id: id, name, price_idr: priceIdr, category });
    });
  } catch (err) {
    return errorResponse(err);
  }
}
