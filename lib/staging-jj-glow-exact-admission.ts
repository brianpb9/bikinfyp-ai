import crypto from "node:crypto";

export const JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256 = "2d575429751a26f5fe3ef51ddb4be5d4f537beb720b69c0d2f5db2182bb77af1";
export const JJ_GLOW_PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
export const JJ_GLOW_SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
export const JJ_GLOW_CANDIDATE_4_SCRIPT_ID = "ca32178f-2731-4234-bb07-48f24a2f2079";
export const JJ_GLOW_CANDIDATE_3_JOB_ID = "55284f20-efb8-4b18-8a24-f90fc91af733";
export const JJ_GLOW_PRINCIPAL_ID = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
export const JJ_GLOW_STAGING_WEB_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
export const JJ_GLOW_FINAL_RECOVERY_TASK = "P0-JJ-GLOW-FINAL-RECOVERY-CANDIDATE-20260831";
export const JJ_GLOW_CANDIDATE_4_TASK = "FINAL-POST-SWEEP-CANDIDATE-4-20260901";
export const JJ_GLOW_LIFECYCLE_SCHEMA = "bikinfyp.staging-candidate-lifecycle/v1";

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

export type JjGlowLifecycleAuthority = {
  schema: typeof JJ_GLOW_LIFECYCLE_SCHEMA;
  task: typeof JJ_GLOW_FINAL_RECOVERY_TASK | typeof JJ_GLOW_CANDIDATE_4_TASK;
  correlation_id: string;
  historical_root_cause_waiver: true;
  final_candidate_ordinal: 3 | 4;
  max_canonical_candidates_created: 3 | 4;
  provider_posts_at_admission: 0;
  mutation_policy: { delete_requires_reason_actor: true; supersede_requires_reason_actor: true };
};

/** Exact final-recovery authority only; unrelated admissions cannot attach lifecycle claims. */
export function authorizeJjGlowLifecycleAuthority(
  value: unknown,
  exactProductStateSha256: string | null,
): JjGlowLifecycleAuthority | null {
  if (exactProductStateSha256 === null) {
    if (value == null) return null;
    throw new Error("JJ_GLOW_LIFECYCLE_UNAUTHORIZED");
  }
  const item = value as Partial<JjGlowLifecycleAuthority> | null;
  const legacyAuthority = item?.task === JJ_GLOW_FINAL_RECOVERY_TASK
    && item.final_candidate_ordinal === 3 && item.max_canonical_candidates_created === 3;
  const candidate4Authority = item?.task === JJ_GLOW_CANDIDATE_4_TASK
    && item.final_candidate_ordinal === 4 && item.max_canonical_candidates_created === 4;
  if (!item || item.schema !== JJ_GLOW_LIFECYCLE_SCHEMA || (!legacyAuthority && !candidate4Authority)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(item.correlation_id ?? ""))
    || item.historical_root_cause_waiver !== true || item.provider_posts_at_admission !== 0
    || item.mutation_policy?.delete_requires_reason_actor !== true
    || item.mutation_policy?.supersede_requires_reason_actor !== true) {
    throw new Error("JJ_GLOW_LIFECYCLE_AUTHORITY_INVALID");
  }
  return item as JjGlowLifecycleAuthority;
}

export function jjGlowLifecycleStateSha256(value: Record<string, unknown>): string {
  return canonicalSha(value);
}

export type JjGlowLifecycleActivationReadback = {
  actor: unknown;
  created_at: unknown;
  meta: unknown;
};

/** Activation revalidates the complete immutable authority receipt while its
 * audit row is locked. `audit_log` is not protected by an update trigger, so
 * checking only the state digest is not an activation boundary. */
export function assertJjGlowLifecycleActivationInvariant(input: {
  row: JjGlowLifecycleActivationReadback | null | undefined;
  task: typeof JJ_GLOW_FINAL_RECOVERY_TASK | typeof JJ_GLOW_CANDIDATE_4_TASK;
  correlationId: string;
  stateSha256: string;
}) {
  const { row, task, correlationId, stateSha256 } = input;
  let meta: Record<string, any>;
  try { meta = JSON.parse(String(row?.meta ?? "")) as Record<string, any>; }
  catch { throw new Error("JJ_GLOW_FINAL_EVIDENCE_LIFECYCLE_MISMATCH"); }
  const ordinal = task === JJ_GLOW_CANDIDATE_4_TASK ? 4 : 3;
  const createdAt = row?.created_at == null ? null : new Date(row.created_at as string | number | Date).toISOString();
  const transactionId = meta.transaction_commit_receipt?.transaction_id;
  if (!row || row.actor !== JJ_GLOW_PRINCIPAL_ID || meta.schema !== JJ_GLOW_LIFECYCLE_SCHEMA
      || meta.task !== task || meta.correlation_id !== correlationId
      || meta.historical_root_cause_waiver !== true || meta.final_candidate_ordinal !== ordinal
      || meta.max_canonical_candidates_created !== ordinal || meta.provider_posts_at_admission !== 0
      || meta.mutation_policy?.delete_requires_reason_actor !== true
      || meta.mutation_policy?.supersede_requires_reason_actor !== true
      || meta.create_actor !== JJ_GLOW_PRINCIPAL_ID || meta.create_timestamp !== createdAt
      || !/^[0-9]+$/.test(String(transactionId ?? ""))
      || meta.transaction_commit_receipt?.atomic_with_job !== true
      || meta.transaction_commit_receipt?.visible_only_after_commit !== true
      || meta.append_only !== true || meta.post_commit_state_sha256 !== stateSha256
      || !meta.post_commit_state || jjGlowLifecycleStateSha256(meta.post_commit_state) !== stateSha256) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_LIFECYCLE_MISMATCH");
  }
  return meta;
}

export type JjGlowCandidate4PredecessorReadback = {
  id: unknown; product_id: unknown; script_id: unknown; state: unknown;
  provider_video: unknown; provider_voice: unknown; output_url: unknown;
  provider_task_count: unknown; provider_post_count: unknown; output_count: unknown;
  fyp_posted_count: unknown; post_plan_count: unknown; hold_count: unknown;
  release_count: unknown; capture_count: unknown;
};

/** Paid activation may proceed only while the exact candidate-3 predecessor is
 * still terminal and effect-free. The activation transaction locks this row. */
export function assertJjGlowCandidate4PredecessorInvariant(row: JjGlowCandidate4PredecessorReadback | null | undefined) {
  if (!row || row.id !== JJ_GLOW_CANDIDATE_3_JOB_ID || row.product_id !== JJ_GLOW_PRODUCT_ID
      || row.script_id !== JJ_GLOW_SCRIPT_ID || row.state !== "REFUNDED"
      || row.provider_video !== null || row.provider_voice !== null || row.output_url !== null
      || Number(row.provider_task_count) !== 0 || Number(row.provider_post_count) !== 0
      || Number(row.output_count) !== 0 || Number(row.fyp_posted_count) !== 0 || Number(row.post_plan_count) !== 0
      || Number(row.hold_count) !== 1 || Number(row.release_count) !== 1 || Number(row.capture_count) !== 0) {
    throw new Error("JJ_GLOW_CANDIDATE_4_PREDECESSOR_CHANGED");
  }
}

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
    && (input.scriptId === JJ_GLOW_SCRIPT_ID || input.scriptId === JJ_GLOW_CANDIDATE_4_SCRIPT_ID);
  if (exactTuple) {
    if (input.expectedSha256 !== JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256) {
      throw new Error("JJ_GLOW_EXACT_ADMISSION_DIGEST_REQUIRED");
    }
    return JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256;
  }
  if (input.expectedSha256 == null) return null;
  throw new Error("JJ_GLOW_EXACT_ADMISSION_UNAUTHORIZED");
}
