import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { extractFromUrl, cleanProductName } from "@/lib/extract";
import { downloadProductImages } from "@/lib/product-image-download";
import { createSignedUrl } from "@/lib/signed-url";
import { pgAudit, pgCanExtract, postgresRuntimeEnabled, smokeCreateProduct, smokeGetOrgProduct } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { sanitizeClaims } from "@/lib/media/claim-overlay";
import { buildAuthoritativeTypeBoundaryInput, categoryReviewForMutation, deriveCategoryReview, parseStructuredCategoryOutcome, validateAuthoritativeProductType } from "@/lib/product-type-boundary";
import { canonicalProductTypeTimestamp } from "@/lib/product-type-timestamp";
import { withProductEvidenceMutationLock } from "@/lib/job-admission-reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Produk kampanye brand (M8, F-ENT-01). BEDA dari bulk lama (M3-M6) yang
// menerima N link produk × 1 video: brand nyaris selalu fokus ke SATU produk
// unggulan dan mau BANYAK variasi video darinya (arahan Brian 2026-08-11).
// Jadi di sini satu produk dibuat dulu, dilengkapi foto+detail sebanyak
// mungkin (makin lengkap makin bagus hasil render), baru di-fan-out ke 2-6
// video di langkah berikutnya.

function productPayload(product: { id: string; name: string; price_idr: number; category: string; product_type_token?: string | null; product_type_confirmed_by?: string | null; product_type_confirmed_at?: string | Date | null; product_type_version?: number | null; product_type_state?: string | null; category_review_state?: string | null; category_review_reason?: string | null; category_reviewed_by?: string | null; category_reviewed_role?: string | null; category_reviewed_at?: string | Date | null; category_review_version?: number | null; product_visual_desc?: string | null; brand_brief?: string | null; claims?: string | null; promo_price_before_idr?: number | null; promo_ends_at?: string | null; promo_stock_left?: number | null; images: string; source_url: string | null }) {
  const images = JSON.parse(product.images || "[]") as string[];
  return {
    product_id: product.id,
    name: product.name,
    price_idr: product.price_idr,
    category: product.category,
    product_type: product.product_type_token ?? null,
    product_type_confirmation: product.product_type_state === "CONFIRMED"
      && product.product_type_confirmed_by && product.product_type_confirmed_at && product.product_type_version === 1
      ? {
          state: "CONFIRMED", actor_id: product.product_type_confirmed_by,
          confirmed_at: canonicalProductTypeTimestamp(product.product_type_confirmed_at), version: 1,
          provenance: "USER_SELF_ASSERTION" as const,
        }
      : null,
    category_review: {
      state: product.category_review_state ?? "QUARANTINED",
      reason: product.category_review_reason ?? "CATEGORY_UNKNOWN",
      reviewed_by: product.category_reviewed_by ?? null,
      reviewed_role: product.category_reviewed_role ?? null,
      reviewed_at: product.category_reviewed_at ?? null,
      version: product.category_review_version ?? 1,
    },
    product_visual_desc: product.product_visual_desc ?? null,
    brand_brief: product.brand_brief ?? null,
    claims: product.claims ? JSON.parse(product.claims) : [],
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
    const productTypeToken = String(body.product_type ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmedProductTypeToken = String(body.confirmed_product_type ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmedAt = new Date().toISOString();

    return await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
      { kind: "DECLARED_PRODUCT_TYPE", sourceId: "campaign-product.product_type", token: productTypeToken, version: 1 },
      confirmedProductTypeToken ? {
        kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: confirmedProductTypeToken, actorId: user.id,
        confirmedAt, version: 1, provenance: "USER_SELF_ASSERTION",
      } : null,
    ), async () => {

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
      const category = result.categoryGuess ?? "default";
      const categoryReview = deriveCategoryReview(category, parseStructuredCategoryOutcome(body.category_outcome ?? "KNOWN"));
      if (categoryReview.state === "QUARANTINED") {
        const product = await smokeCreateProduct(user.id, {
          sourceUrl:url,name:cleanProductName(result.name ?? "Produk dari link"),priceIdr:result.priceIdr ?? 0,
          category,images:[],productVisualDesc:result.visualDesc ?? null,
          rawMeta:{og:{price:result.priceIdr,original:result.originalPriceIdr}},orgId:membership.org_id,
          productTypeToken,productTypeConfirmedToken:confirmedProductTypeToken,productTypeConfirmedBy:user.id,
          productTypeConfirmedAt:confirmedAt,productTypeVersion:1,
          categoryReviewState:categoryReview.state,categoryReviewReason:categoryReview.reason,
          categoryReviewVersion:categoryReview.version,
        },productId);
        await pgAudit(user.id,"product.category_quarantined","products",productId,
          {campaign:true,reason:categoryReview.reason,category,remote_image_downloads:0});
        return Response.json({extracted:true,...productPayload(product),images_downloaded:0},{status:202});
      }
      const images = result.imageUrls?.length ? await downloadProductImages(productId, result.imageUrls, url) : [];
      const promoBefore = result.originalPriceIdr && result.priceIdr && result.originalPriceIdr > result.priceIdr ? result.originalPriceIdr : null;
      const product = await smokeCreateProduct(
        user.id,
        {
          sourceUrl: url, name: cleanProductName(result.name ?? "Produk dari link"), priceIdr: result.priceIdr ?? 0,
          category, images, productVisualDesc: result.visualDesc ?? null,
          promoPriceBeforeIdr: promoBefore, rawMeta: { og: { price: result.priceIdr, original: result.originalPriceIdr } },
          productTypeToken, productTypeConfirmedToken: confirmedProductTypeToken,
          productTypeConfirmedBy: user.id, productTypeConfirmedAt: confirmedAt, productTypeVersion: 1,
          orgId: membership.org_id,
          categoryReviewState:categoryReview.state,categoryReviewReason:categoryReview.reason,
          categoryReviewVersion:categoryReview.version,
        },
        productId
      );
      await pgAudit(user.id, "product.extracted", "products", productId, {
        reason: "ok", price: result.priceIdr, campaign: true, product_type: productTypeToken,
        product_type_state: "CONFIRMED", product_type_confirmation: "USER_SELF_ASSERTION",
        product_type_confirmed_by: user.id, product_type_confirmed_at: confirmedAt, product_type_version: 1,
      });
      return Response.json({ extracted: true, ...productPayload(product), images_downloaded: images.length });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw ERR.BAD_REQUEST("Isi link produk atau nama produknya dulu.", "url or name is required.");
    const priceIdr = Number.isFinite(Number(body.price_idr)) ? Math.max(0, Math.round(Number(body.price_idr))) : 0;
    const category = typeof body.category === "string" && body.category ? body.category : "default";
    const categoryReview = deriveCategoryReview(category, parseStructuredCategoryOutcome(body.category_outcome ?? "KNOWN"));
    const product = await smokeCreateProduct(user.id, {
      sourceUrl: null, name, priceIdr, category,
      images: [], productVisualDesc: null, orgId: membership.org_id,
      productTypeToken, productTypeConfirmedToken: confirmedProductTypeToken,
      productTypeConfirmedBy: user.id, productTypeConfirmedAt: confirmedAt, productTypeVersion: 1,
      categoryReviewState:categoryReview.state,categoryReviewReason:categoryReview.reason,
      categoryReviewVersion:categoryReview.version,
    });
    await pgAudit(user.id, "product.created", "products", product.id, {
      manual: true, campaign: true, product_type: productTypeToken,
      product_type_state: "CONFIRMED", product_type_confirmation: "USER_SELF_ASSERTION",
      product_type_confirmed_by: user.id, product_type_confirmed_at: confirmedAt, product_type_version: 1,
    });
    return Response.json({ extracted: true, ...productPayload(product), images_downloaded: 0 },
      {status:categoryReview.state === "QUARANTINED" ? 202 : 200});
    });
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
    return await withProductEvidenceMutationLock(productId, async () => {

    // Per-ORG, bukan per-user. Produk dashboard dibuat satu anggota, dibayar
    // dari dompet organisasi, dan disunting seluruh tim — pemeriksaan per-user
    // menolak rekan satu tim atas produk yang jelas ada di daftar mereka.
    const existing = await smokeGetOrgProduct(membership.org_id, productId);
    if (!existing) throw ERR.NOT_FOUND("Produknya");

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
    const priceIdr = Number.isFinite(Number(body.price_idr)) ? Math.max(0, Math.round(Number(body.price_idr))) : existing.price_idr;
    const category = typeof body.category === "string" && body.category ? body.category : existing.category;
    const categoryReview = categoryReviewForMutation({
      state:existing.category_review_state as "CLEAR"|"QUARANTINED",
      reason:existing.category_review_reason as "CATEGORY_UNKNOWN"|"CATEGORY_AMBIGUOUS"|"CATEGORY_BUNDLE"|null,
      reviewedBy:existing.category_reviewed_by ?? null,reviewedRole:existing.category_reviewed_role ?? null,
      reviewedAt:existing.category_reviewed_at == null ? null : canonicalProductTypeTimestamp(existing.category_reviewed_at),
      version:existing.category_review_version ?? 1,
    },category,parseStructuredCategoryOutcome(body.category_outcome ?? "KNOWN"));
    const productTypeToken = String(body.product_type ?? existing.product_type_token ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmationTouched = body.confirmed_product_type !== undefined;
    const confirmedProductTypeToken = String(confirmationTouched ? body.confirmed_product_type : existing.product_type_confirmed_token ?? "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const confirmedBy = confirmationTouched ? user.id : String(existing.product_type_confirmed_by ?? "");
    const confirmedAt = confirmationTouched
      ? new Date().toISOString()
      : canonicalProductTypeTimestamp(existing.product_type_confirmed_at);
    const visualDesc = typeof body.product_visual_desc === "string" ? body.product_visual_desc.trim().slice(0, 600) || null : existing.product_visual_desc ?? null;
    const brandBrief = typeof body.brand_brief === "string" ? body.brand_brief.trim().slice(0, 1200) || null : existing.brand_brief ?? null;

    // Urgensi & kelangkaan (add-on Promo, lib/promo.ts). Angka-angka ini
    // BOLEH muncul di caption/overlay tapi tidak boleh dikarang di skrip —
    // resolvePromo() yang memutuskan, dan promo kedaluwarsa otomatis di-drop
    // saat render. Harga coret hanya dipakai kalau LEBIH BESAR dari harga
    // jual; kalau tidak, itu klaim diskon palsu dan kami buang di sini.
    // Klaim untuk overlay teks. Dibersihkan lewat sanitizeClaims yang sama
    // dengan yang dipakai renderer, jadi apa yang tersimpan persis apa yang
    // akan tampil — tidak ada aturan panjang/jumlah yang berbeda antara
    // penyimpanan dan tampilan.
    const claims = Array.isArray(body.claims) ? sanitizeClaims(body.claims) : null;

    const rawBefore = Number(body.promo_price_before_idr);
    const promoBefore = Number.isFinite(rawBefore) && rawBefore > priceIdr ? Math.round(rawBefore) : null;
    const promoEndsAt = typeof body.promo_ends_at === "string" && body.promo_ends_at.trim()
      ? body.promo_ends_at.trim() : null;
    const rawStock = Number(body.promo_stock_left);
    const promoStock = Number.isFinite(rawStock) && rawStock > 0 ? Math.round(rawStock) : null;

    return await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
      { kind: "DECLARED_PRODUCT_TYPE", sourceId: "campaign-product-mutation.product_type", token: productTypeToken, version: 1 },
      confirmedProductTypeToken && confirmedBy && confirmedAt
        && (confirmationTouched || existing.product_type_state === "CONFIRMED") ? {
        kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: confirmedProductTypeToken, actorId: confirmedBy,
        confirmedAt, version: 1, provenance: "USER_SELF_ASSERTION",
      } : null,
    ), async () => {
    const pool = getPool(config.databaseUrl);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (confirmationTouched) await client.query(
        // WHERE per org, sejalan dengan pemeriksaan di atas. Kalau ini tetap
        // "user_id=$10", pemeriksaan sudah lolos tapi UPDATE-nya mengenai nol
        // baris — rekan satu tim menekan Simpan, tidak ada error, dan tidak ada
        // yang tersimpan. Kegagalan diam yang jauh lebih membingungkan
        // daripada penolakan yang jujur.
        `UPDATE products SET name=$1, price_idr=$2, category=$3, product_visual_desc=$4,
           brand_brief=$5, promo_price_before_idr=$6, promo_ends_at=$7, promo_stock_left=$8,
           claims=COALESCE($11, claims), product_type_token=$12, product_type_confirmed_token=$13,
           product_type_confirmed_by=$14, product_type_confirmed_at=$15, product_type_version=1,
           product_type_state='CONFIRMED',category_review_state=$16,category_review_reason=$17,
           category_reviewed_by=$18,category_reviewed_role=$19,category_reviewed_at=$20,
           category_review_version=$21 WHERE id=$9 AND org_id=$10`,
        [name, priceIdr, category, visualDesc, brandBrief, promoBefore, promoEndsAt, promoStock,
          productId, membership.org_id, claims ? JSON.stringify(claims) : null,
          productTypeToken, confirmedProductTypeToken, confirmedBy, confirmedAt,
          categoryReview.state,categoryReview.reason,categoryReview.reviewedBy,categoryReview.reviewedRole,
          categoryReview.reviewedAt,categoryReview.version]
      );
      else await client.query(
        // An ordinary detail save must never copy the C2 fields read above.
        // A concurrent explicit reconfirmation or quarantine therefore wins
        // durably instead of being resurrected from this request's stale row.
        `UPDATE products SET name=$1, price_idr=$2, category=$3, product_visual_desc=$4,
           brand_brief=$5, promo_price_before_idr=$6, promo_ends_at=$7, promo_stock_left=$8,
           claims=COALESCE($11, claims),category_review_state=$12,category_review_reason=$13,
           category_reviewed_by=$14,category_reviewed_role=$15,category_reviewed_at=$16,
           category_review_version=$17 WHERE id=$9 AND org_id=$10`,
        [name, priceIdr, category, visualDesc, brandBrief, promoBefore, promoEndsAt, promoStock,
          productId, membership.org_id, claims ? JSON.stringify(claims) : null,
          categoryReview.state,categoryReview.reason,categoryReview.reviewedBy,categoryReview.reviewedRole,
          categoryReview.reviewedAt,categoryReview.version]
      );
      if (categoryReview.state === "QUARANTINED") await client.query(
        `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at)
         VALUES ($1,$2,'product.category_quarantined','products',$3,$4,$5)`,
        [crypto.randomUUID(),user.id,productId,JSON.stringify({campaign:true,reason:categoryReview.reason,
          category,version:categoryReview.version}),new Date().toISOString()]);
      await client.query("COMMIT");
    } catch(error) {
      await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    } finally { client.release(); }
    const updated = await smokeGetOrgProduct(membership.org_id, productId);
    if (!updated) throw ERR.NOT_FOUND("Produknya");
    const updatedConfirmedAt = canonicalProductTypeTimestamp(updated.product_type_confirmed_at);
    await pgAudit(user.id, "product.updated", "products", productId, {
      campaign: true, product_type: updated.product_type_token,
      product_type_state: updated.product_type_state,
      product_type_confirmation: updated.product_type_state === "CONFIRMED" ? "USER_SELF_ASSERTION" : null,
      product_type_confirmed_by: updated.product_type_confirmed_by,
      product_type_confirmed_at: updatedConfirmedAt || null,
      product_type_version: updated.product_type_version,
      category_review_state:updated.category_review_state,category_review_reason:updated.category_review_reason,
      category_review_version:updated.category_review_version,
    });
    return Response.json(productPayload(updated),{status:updated.category_review_state === "QUARANTINED" ? 202 : 200});
    });
    });
  } catch (err) {
    return errorResponse(err);
  }
}
