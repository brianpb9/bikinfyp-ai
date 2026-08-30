import crypto from "node:crypto";

export const JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256 = "2d575429751a26f5fe3ef51ddb4be5d4f537beb720b69c0d2f5db2182bb77af1";
export const JJ_GLOW_PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
export const JJ_GLOW_SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
export const JJ_GLOW_PRINCIPAL_ID = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
export const JJ_GLOW_STAGING_WEB_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";

type ProductRow = Record<string, unknown>;
const exactNumber = (value: unknown, field: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} is not finite`);
  return parsed;
};
const nullableNumber = (value: unknown, field: string) => value == null ? null : exactNumber(value, field);
const exactIso = (value: unknown) => value == null ? null : new Date(value as string | number | Date).toISOString();
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
const canonicalSha = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export function jjGlowSelectedProductState(product: ProductRow) {
  let rawMeta: Record<string, unknown>;
  try { rawMeta = JSON.parse(String(product.raw_meta ?? "{}")) as Record<string, unknown>; }
  catch { throw new Error("JJ_GLOW_EXACT_STATE_INVALID_RAW_META"); }
  return {
    id: product.id, user_id: product.user_id, org_id: product.org_id, name: product.name,
    price_idr: exactNumber(product.price_idr, "price_idr"), category: product.category, source_url: product.source_url,
    product_visual_desc: product.product_visual_desc, brand_brief: product.brand_brief, claims: product.claims,
    promo_price_before_idr: nullableNumber(product.promo_price_before_idr, "promo_price_before_idr"),
    promo_ends_at: product.promo_ends_at, promo_stock_left: nullableNumber(product.promo_stock_left, "promo_stock_left"),
    images: JSON.parse(String(product.images ?? "[]")), brand: rawMeta.brand ?? null,
    staging_reference_rights: rawMeta.staging_reference_rights ?? null,
    product_type_token: product.product_type_token, product_type_confirmed_token: product.product_type_confirmed_token,
    product_type_confirmed_by: product.product_type_confirmed_by,
    product_type_confirmed_at: exactIso(product.product_type_confirmed_at),
    product_type_version: exactNumber(product.product_type_version, "product_type_version"), product_type_state: product.product_type_state,
    category_review_state: product.category_review_state, category_review_reason: product.category_review_reason,
    category_reviewed_by: product.category_reviewed_by, category_reviewed_role: product.category_reviewed_role,
    category_reviewed_at: exactIso(product.category_reviewed_at),
    category_review_version: exactNumber(product.category_review_version, "category_review_version"),
  };
}

/** Must run on the product row held FOR SHARE inside the job transaction. */
export function assertJjGlowLockedProductState(product: ProductRow, expectedSha256: string) {
  if (expectedSha256 !== JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256
      || canonicalSha(jjGlowSelectedProductState(product)) !== JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256) {
    throw new Error("JJ_GLOW_EXACT_PRODUCT_STATE_MISMATCH");
  }
}

export function authorizeJjGlowExactAdmission(input: {
  expectedSha256: unknown; userId: string; productId: string; scriptId: string;
}, runtime: NodeJS.ProcessEnv = process.env): string | null {
  const exactTuple = runtime.RACUN_DEPLOY_ENV === "staging"
    && runtime.RENDER_SERVICE_ID === JJ_GLOW_STAGING_WEB_SERVICE_ID
    && input.userId === JJ_GLOW_PRINCIPAL_ID && input.productId === JJ_GLOW_PRODUCT_ID
    && input.scriptId === JJ_GLOW_SCRIPT_ID;
  if (exactTuple) {
    if (input.expectedSha256 !== JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256) {
      throw new Error("JJ_GLOW_EXACT_ADMISSION_DIGEST_REQUIRED");
    }
    return JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256;
  }
  if (input.expectedSha256 == null) return null;
  throw new Error("JJ_GLOW_EXACT_ADMISSION_UNAUTHORIZED");
}
