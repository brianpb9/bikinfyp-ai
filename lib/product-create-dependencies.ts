import { getAuthUser } from "./auth";
import { getDb, now, uuid, type ProductRow } from "./db";
import { postgresRuntimeEnabled, smokeCreateProduct, smokeGetProductByIdForCreateReconciliation } from "./postgres/smoke-runtime";
import { canonicalProductTypeTimestamp } from "./product-type-timestamp";

export interface ExpectedProductCreation {
  id: string;
  userId: string;
  sourceUrl: string | null;
  name: string;
  priceIdr: number;
  category: string;
  productTypeToken?: string;
  productTypeConfirmedToken?: string;
  productTypeConfirmedBy?: string;
  productTypeConfirmedAt?: string;
  productTypeVersion?: 1;
  productVisualDesc: string | null;
  images: string[];
  promoPriceBeforeIdr: number | null;
  promoEndsAt: string | null;
  promoStockLeft: number | null;
  rawMeta: Record<string, unknown> | null;
}

export type ProductCreationReconciliation = "absent" | "exact" | "mismatch";

export function productCreationRowMatchesExpected(row: ProductRow, expected: ExpectedProductCreation): boolean {
  return row.id === expected.id
    && row.user_id === expected.userId
    && (row.org_id ?? null) === null
    && (row.source_url ?? null) === expected.sourceUrl
    && row.name === expected.name
    && Number(row.price_idr) === expected.priceIdr
    && row.category === expected.category
    && (expected.productTypeToken === undefined || row.product_type_token === expected.productTypeToken)
    && (expected.productTypeConfirmedToken === undefined || row.product_type_confirmed_token === expected.productTypeConfirmedToken)
    && (expected.productTypeConfirmedBy === undefined || row.product_type_confirmed_by === expected.productTypeConfirmedBy)
    && (expected.productTypeConfirmedAt === undefined
      || canonicalProductTypeTimestamp(row.product_type_confirmed_at) === expected.productTypeConfirmedAt)
    && (expected.productTypeVersion === undefined || row.product_type_version === expected.productTypeVersion)
    && (expected.productTypeVersion === undefined || row.product_type_state === "CONFIRMED")
    && (row.product_visual_desc ?? null) === expected.productVisualDesc
    && (row.brand_brief ?? null) === null
    && row.images === JSON.stringify(expected.images)
    && (row.promo_price_before_idr ?? null) === expected.promoPriceBeforeIdr
    && (row.promo_ends_at ?? null) === expected.promoEndsAt
    && (row.promo_stock_left ?? null) === expected.promoStockLeft
    && (row.raw_meta ?? null) === (expected.rawMeta ? JSON.stringify(expected.rawMeta) : null);
}

async function reconcileProductCreation(
  expected: ExpectedProductCreation,
  usePostgres: boolean,
): Promise<ProductCreationReconciliation> {
  const row = usePostgres
    ? await smokeGetProductByIdForCreateReconciliation(expected.id)
    : getDb().prepare("SELECT * FROM products WHERE id = ?").get(expected.id) as ProductRow | undefined;
  if (!row) return "absent";
  return productCreationRowMatchesExpected(row, expected) ? "exact" : "mismatch";
}

function auditProductCreatedOnce(
  actor: string,
  productId: string,
  meta: {
    name: string; category: string; brand: string | null; promo: boolean; product_type: string;
    product_type_state: "CONFIRMED"; product_type_confirmation: "USER_SELF_ASSERTION";
    product_type_confirmed_by: string; product_type_confirmed_at: string; product_type_version: 1;
  },
): void {
  getDb().prepare(
    `INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at)
     SELECT ?, ?, 'product.created', 'products', ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM audit_log
       WHERE actor = ? AND action = 'product.created' AND entity = 'products' AND entity_id = ?
     )`,
  ).run(uuid(), actor, productId, JSON.stringify(meta), now(), actor, productId);
}

const productionDependencies = {
  getAuthUser,
  auditProductCreatedOnce,
  getDb,
  now,
  uuid,
  postgresRuntimeEnabled,
  smokeCreateProduct,
  reconcileProductCreation,
};

export type ProductCreateDependencies = typeof productionDependencies;
let dependenciesForTests: Partial<ProductCreateDependencies> | undefined;

/** Test seam for the exported E1 handler; production keeps canonical deps. */
export function setProductCreateDependenciesForTests(
  dependencies?: Partial<ProductCreateDependencies>,
): void {
  dependenciesForTests = dependencies;
}

export function productCreateDependencies(): ProductCreateDependencies {
  return { ...productionDependencies, ...dependenciesForTests };
}
