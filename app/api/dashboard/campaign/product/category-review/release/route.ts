import crypto from "node:crypto";

import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { withProductEvidenceMutationLock } from "@/lib/job-admission-reference";
import { getPool } from "@/lib/postgres/pool";
import { authorizeCategoryReviewRelease, effectiveCategoryReviewRole, requireCanonicalC5Category, type CategoryReviewRecord } from "@/lib/product-type-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const productionDependencies = {
  requireOrgContextApi,
  withProductEvidenceMutationLock,
  getPool,
  databaseUrl: () => config.databaseUrl,
  configuredRole: () => process.env.C5_AUTHORIZED_HUMAN_REVIEW_ROLE ?? "",
  configuredPrincipalId: () => process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID ?? "",
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
};
type ReleaseDependencies = typeof productionDependencies;
let dependencyOverrides: Partial<ReleaseDependencies> | undefined;

export function setCategoryReviewReleaseDependenciesForTests(overrides?: Partial<ReleaseDependencies>):void {
  dependencyOverrides=overrides;
}

function dependencies():ReleaseDependencies {
  return {...productionDependencies,...dependencyOverrides};
}

/** Guarded C5 release. Membership role is loaded server-side; request bodies
 * cannot self-assert the authorized role. Missing env remains fail-closed. */
export async function POST(req:Request) {
  try {
    const deps=dependencies();
    const {user,membership}=await deps.requireOrgContextApi(req);
    const body=await req.json().catch(()=>({}));
    const productId=typeof body.product_id === "string" ? body.product_id.trim() : "";
    const reviewReason=typeof body.reason === "string" ? body.reason.trim() : "";
    const resolvedCategory=requireCanonicalC5Category(body.resolved_category);
    const expectedVersion=Number(body.expected_version);
    const retailScope=body.scope === "retail";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.","product_id is required.");
    return await deps.withProductEvidenceMutationLock(productId,async()=>{
      const pool=deps.getPool(deps.databaseUrl());
      const client=await pool.connect();
      try {
        await client.query("BEGIN");
        const configuredRole=deps.configuredRole();
        const roleBinding=effectiveCategoryReviewRole({configuredRole,
          configuredPrincipalId:deps.configuredPrincipalId(),membershipRole:membership.role,actorId:user.id});
        const selected=await client.query<{
          user_id:string;category:string;
          category_review_state:"CLEAR"|"QUARANTINED";category_review_reason:"CATEGORY_UNKNOWN"|"CATEGORY_AMBIGUOUS"|"CATEGORY_BUNDLE"|null;
          category_reviewed_by:string|null;category_reviewed_role:string|null;category_reviewed_at:string|Date|null;category_review_version:number;
        }>(`SELECT user_id,category,category_review_state,category_review_reason,category_reviewed_by,category_reviewed_role,
              category_reviewed_at,category_review_version FROM products
              WHERE id=$1 AND ${retailScope ? "org_id IS NULL" : "org_id=$2"} FOR UPDATE`,
          retailScope ? [productId] : [productId,membership.org_id]);
        if (!selected.rows[0]) throw ERR.NOT_FOUND("Produknya");
        const row=selected.rows[0];
        const current:CategoryReviewRecord={state:row.category_review_state,reason:row.category_review_reason,
          reviewedBy:row.category_reviewed_by,reviewedRole:row.category_reviewed_role,
          reviewedAt:row.category_reviewed_at instanceof Date ? row.category_reviewed_at.toISOString() : row.category_reviewed_at,
          version:row.category_review_version};
        if (current.state === "CLEAR") {
          const prior=await client.query<{meta:string|Record<string,unknown>}>(
            `SELECT meta FROM audit_log WHERE action='product.category_released' AND entity='products'
               AND entity_id=$1 AND actor=$2 ORDER BY created_at DESC LIMIT 1`,[productId,user.id]);
          let meta:Record<string,unknown>={};
          try {
            const raw=prior.rows[0]?.meta;
            meta=typeof raw === "string" ? JSON.parse(raw) : raw && typeof raw === "object" ? raw : {};
          } catch { /* malformed audit cannot prove idempotency */ }
          if (current.reviewedBy === user.id && current.reviewedRole === roleBinding.effectiveRole
            && row.category === resolvedCategory
            && meta.reason === reviewReason && meta.previous_version === expectedVersion
            && meta.effective_authorized_role === roleBinding.effectiveRole
            && meta.underlying_membership_role === roleBinding.membershipRole
            && meta.founder_principal_id === roleBinding.founderPrincipalId
            && current.version === expectedVersion + 1) {
            await client.query("COMMIT");
            return Response.json({ok:true,idempotent:true,product_id:productId,category_review:current});
          }
        }
        const reviewedAt=deps.now();
        const released=authorizeCategoryReviewRelease(current,{actorId:user.id,actorRole:roleBinding.effectiveRole,
          reviewedAt,reason:reviewReason,expectedVersion},configuredRole);
        const updated=await client.query(
          `UPDATE products SET category=$1,category_review_state='CLEAR',category_review_reason=NULL,category_reviewed_by=$2,
             category_reviewed_role=$3,category_reviewed_at=$4,category_review_version=$5
           WHERE id=$6 AND ${retailScope ? "org_id IS NULL" : "org_id=$7"}
             AND category_review_state='QUARANTINED' AND category_review_version=$${retailScope ? "7" : "8"}`,
          [resolvedCategory,released.reviewedBy,released.reviewedRole,released.reviewedAt,released.version,
            productId,...(retailScope ? [expectedVersion] : [membership.org_id,expectedVersion])]);
        if (updated.rowCount !== 1) throw ERR.BAD_REQUEST("Status tinjauan berubah. Muat ulang lalu coba lagi.","Category review changed concurrently.");
        await client.query(
          `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at)
           VALUES ($1,$2,'product.category_released','products',$3,$4,$5)`,
          [deps.uuid(),user.id,productId,JSON.stringify({actor_role:roleBinding.effectiveRole,
            effective_authorized_role:roleBinding.effectiveRole,
            underlying_membership_role:roleBinding.membershipRole,
            founder_principal_id:roleBinding.founderPrincipalId,reason:reviewReason,
            product_scope:retailScope ? "retail" : "organization",product_owner_user_id:row.user_id,
            previous_category:row.category,resolved_category:resolvedCategory,
            previous_reason:current.reason,previous_version:current.version,new_version:released.version}),reviewedAt]);
        await client.query("COMMIT");
        return Response.json({ok:true,product_id:productId,category_review:released});
      } catch(error) {
        await client.query("ROLLBACK").catch(()=>undefined);
        throw error;
      } finally { client.release(); }
    });
  } catch(error) { return errorResponse(error); }
}
