import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, audit, type ProductRow } from "@/lib/db";
import { validBrand, validPriceIdr, validProductName } from "@/lib/product-validation";
import { parsePromoFields } from "@/lib/promo";
import { pgSetProductBrand, pgUpdateProduct, pgUpdateProductDetails, postgresRuntimeEnabled, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import { buildAuthoritativeTypeBoundaryInput, categoryReviewForMutation, parseStructuredCategoryOutcome, validateAuthoritativeProductType } from "@/lib/product-type-boundary";
import { canonicalProductTypeTimestamp } from "@/lib/product-type-timestamp";
import { withProductEvidenceMutationLock } from "@/lib/job-admission-reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/products/[id] — edit konfirmasi setelah ekstraksi (nama/harga/kategori/deskripsi).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    return await withProductEvidenceMutationLock(id, async () => {
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
    const categoryReview = categoryReviewForMutation({
      state:product.category_review_state as "CLEAR"|"QUARANTINED",
      reason:product.category_review_reason as "CATEGORY_UNKNOWN"|"CATEGORY_AMBIGUOUS"|"CATEGORY_BUNDLE"|null,
      reviewedBy:product.category_reviewed_by ?? null,reviewedRole:product.category_reviewed_role ?? null,
      reviewedAt:product.category_reviewed_at == null ? null : canonicalProductTypeTimestamp(product.category_reviewed_at),
      version:product.category_review_version ?? 1,
    },category,parseStructuredCategoryOutcome(body.category_outcome ?? "KNOWN"));
    const productTypeToken = String(body.product_type ?? product.product_type_token ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmationTouched = body.confirmed_product_type !== undefined;
    const confirmedProductTypeToken = String(confirmationTouched ? body.confirmed_product_type : product.product_type_confirmed_token ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmedBy = confirmationTouched ? user.id : String(product.product_type_confirmed_by ?? "");
    const confirmedAt = confirmationTouched
      ? now()
      : canonicalProductTypeTimestamp(product.product_type_confirmed_at);
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
    if (postgresRuntimeEnabled()) {
      if (confirmationTouched) await pgUpdateProduct(user.id, id, {
        name, priceIdr, category, productTypeToken, productTypeConfirmedToken: confirmedProductTypeToken,
        productTypeConfirmedBy: confirmedBy, productTypeConfirmedAt: confirmedAt, productTypeVersion: 1,
        categoryReviewState:categoryReview.state,categoryReviewReason:categoryReview.reason,
        categoryReviewedBy:categoryReview.reviewedBy,categoryReviewedRole:categoryReview.reviewedRole,
        categoryReviewedAt:categoryReview.reviewedAt,categoryReviewVersion:categoryReview.version,
        productVisualDesc: visualDesc, ...promo,
      });
      else await pgUpdateProductDetails(user.id, id, {
        name, priceIdr, category, productVisualDesc: visualDesc, ...promo,
        categoryReviewState:categoryReview.state,categoryReviewReason:categoryReview.reason,
        categoryReviewedBy:categoryReview.reviewedBy,categoryReviewedRole:categoryReview.reviewedRole,
        categoryReviewedAt:categoryReview.reviewedAt,categoryReviewVersion:categoryReview.version,
      });
    }
    else {
      db!.transaction(() => {
      if (confirmationTouched) db!.prepare(
          `UPDATE products SET name = ?, price_idr = ?, category = ?, product_type_token = ?,
             product_type_confirmed_token = ?, product_type_confirmed_by = ?, product_type_confirmed_at = ?,
             product_type_version = 1, product_type_state = 'CONFIRMED', product_visual_desc = ?,
             promo_price_before_idr = ?, promo_ends_at = ?, promo_stock_left = ?,
             category_review_state=?,category_review_reason=?,category_reviewed_by=?,category_reviewed_role=?,
             category_reviewed_at=?,category_review_version=? WHERE id = ?`
        ).run(name, priceIdr, category, productTypeToken, confirmedProductTypeToken, confirmedBy, confirmedAt,
          visualDesc, promo.promoPriceBeforeIdr, promo.promoEndsAt, promo.promoStockLeft,
          categoryReview.state,categoryReview.reason,categoryReview.reviewedBy,categoryReview.reviewedRole,
          categoryReview.reviewedAt,categoryReview.version,id);
      else db!.prepare(
          `UPDATE products SET name = ?, price_idr = ?, category = ?, product_visual_desc = ?,
             promo_price_before_idr = ?, promo_ends_at = ?, promo_stock_left = ?,
             category_review_state=?,category_review_reason=?,category_reviewed_by=?,category_reviewed_role=?,
             category_reviewed_at=?,category_review_version=? WHERE id = ?`
        ).run(name, priceIdr, category, visualDesc, promo.promoPriceBeforeIdr,
          promo.promoEndsAt, promo.promoStockLeft,categoryReview.state,categoryReview.reason,
          categoryReview.reviewedBy,categoryReview.reviewedRole,categoryReview.reviewedAt,categoryReview.version,id);
      if (categoryReview.state === "QUARANTINED") audit(user.id,"product.category_quarantined","products",id,
        {reason:categoryReview.reason,category,version:categoryReview.version});
      })();
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
    const updated = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, id)
      : db!.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(id, user.id) as ProductRow | undefined;
    if (!updated) throw ERR.NOT_FOUND("Produknya");
    const updatedConfirmedAt = canonicalProductTypeTimestamp(updated.product_type_confirmed_at);
    if (!postgresRuntimeEnabled()) audit(user.id, "product.updated", "products", id, {
      name: updated.name, price_idr: updated.price_idr, promo: updated.promo_price_before_idr !== null,
      product_type: updated.product_type_token, product_type_state: updated.product_type_state,
      product_type_confirmation: updated.product_type_state === "CONFIRMED" ? "USER_SELF_ASSERTION" : null,
      product_type_confirmed_by: updated.product_type_confirmed_by,
      product_type_confirmed_at: updatedConfirmedAt || null, product_type_version: updated.product_type_version,
      category_review_state:updated.category_review_state,category_review_reason:updated.category_review_reason,
      category_review_version:updated.category_review_version,
    });
    return Response.json({
      ok: true, product_id: id, name: updated.name, price_idr: updated.price_idr, category: updated.category,
      product_type: updated.product_type_token ?? null,
      product_type_confirmation: updated.product_type_state === "CONFIRMED"
        && updated.product_type_confirmed_by && updatedConfirmedAt && updated.product_type_version === 1 ? {
          state: "CONFIRMED", actor_id: updated.product_type_confirmed_by, confirmed_at: updatedConfirmedAt,
          version: 1, provenance: "USER_SELF_ASSERTION",
        } : null,
      category_review:{state:updated.category_review_state,reason:updated.category_review_reason,
        reviewed_by:updated.category_reviewed_by ?? null,reviewed_role:updated.category_reviewed_role ?? null,
        reviewed_at:updated.category_reviewed_at ?? null,version:updated.category_review_version},
    },{status:updated.category_review_state === "QUARANTINED" ? 202 : 200});
    });
    });
  } catch (err) {
    return errorResponse(err);
  }
}
