import { getAuthUser } from "./auth";
import { getDb, now, uuid, type ProductRow } from "./db";
import { postgresRuntimeEnabled, smokeCreateProduct, smokeGetProductByIdForCreateReconciliation } from "./postgres/smoke-runtime";

export interface ExpectedProductCreation {
  id: string;
  userId: string;
  sourceUrl: string | null;
  name: string;
  priceIdr: number;
  category: string;
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
  meta: { name: string; category: string; brand: string | null; promo: boolean },
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
