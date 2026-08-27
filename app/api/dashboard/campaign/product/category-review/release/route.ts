import crypto from "node:crypto";

import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { withProductEvidenceMutationLock } from "@/lib/job-admission-reference";
import { getPool } from "@/lib/postgres/pool";
import { authorizeCategoryReviewRelease, effectiveCategoryReviewRole, type CategoryReviewRecord } from "@/lib/product-type-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guarded C5 release. Membership role is loaded server-side; request bodies
 * cannot self-assert the authorized role. Missing env remains fail-closed. */
export async function POST(req:Request) {
  try {
    const {user,membership}=await requireOrgContextApi(req);
    const body=await req.json().catch(()=>({}));
    const productId=typeof body.product_id === "string" ? body.product_id.trim() : "";
    const reviewReason=typeof body.reason === "string" ? body.reason.trim() : "";
    const expectedVersion=Number(body.expected_version);
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.","product_id is required.");
    return await withProductEvidenceMutationLock(productId,async()=>{
      const pool=getPool(config.databaseUrl);
      const client=await pool.connect();
      try {
        await client.query("BEGIN");
        const configuredRole=process.env.C5_AUTHORIZED_HUMAN_REVIEW_ROLE ?? "";
        const trustedOwners=await client.query<{user_id:string}>(
          `SELECT user_id FROM org_members WHERE org_id=$1 AND role='owner' ORDER BY user_id FOR SHARE`,
          [membership.org_id],
        );
        const roleBinding=effectiveCategoryReviewRole({configuredRole,membershipRole:membership.role,
          actorId:user.id,trustedOwnerIds:trustedOwners.rows.map((owner)=>owner.user_id)});
        const selected=await client.query<{
          category_review_state:"CLEAR"|"QUARANTINED";category_review_reason:"CATEGORY_UNKNOWN"|"CATEGORY_AMBIGUOUS"|"CATEGORY_BUNDLE"|null;
          category_reviewed_by:string|null;category_reviewed_role:string|null;category_reviewed_at:string|Date|null;category_review_version:number;
        }>(`SELECT category_review_state,category_review_reason,category_reviewed_by,category_reviewed_role,
              category_reviewed_at,category_review_version FROM products WHERE id=$1 AND org_id=$2 FOR UPDATE`,
          [productId,membership.org_id]);
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
            && meta.reason === reviewReason && meta.previous_version === expectedVersion
            && meta.effective_authorized_role === roleBinding.effectiveRole
            && meta.underlying_membership_role === roleBinding.membershipRole
            && meta.underlying_owner_user_id === roleBinding.ownerUserId
            && current.version === expectedVersion + 1) {
            await client.query("COMMIT");
            return Response.json({ok:true,idempotent:true,product_id:productId,category_review:current});
          }
        }
        const reviewedAt=new Date().toISOString();
        const released=authorizeCategoryReviewRelease(current,{actorId:user.id,actorRole:roleBinding.effectiveRole,
          reviewedAt,reason:reviewReason,expectedVersion},configuredRole);
        const updated=await client.query(
          `UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_reviewed_by=$1,
             category_reviewed_role=$2,category_reviewed_at=$3,category_review_version=$4
           WHERE id=$5 AND org_id=$6 AND category_review_state='QUARANTINED' AND category_review_version=$7`,
          [released.reviewedBy,released.reviewedRole,released.reviewedAt,released.version,
            productId,membership.org_id,expectedVersion]);
        if (updated.rowCount !== 1) throw ERR.BAD_REQUEST("Status tinjauan berubah. Muat ulang lalu coba lagi.","Category review changed concurrently.");
        await client.query(
          `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at)
           VALUES ($1,$2,'product.category_released','products',$3,$4,$5)`,
          [crypto.randomUUID(),user.id,productId,JSON.stringify({actor_role:roleBinding.effectiveRole,
            effective_authorized_role:roleBinding.effectiveRole,
            underlying_membership_role:roleBinding.membershipRole,
            underlying_owner_user_id:roleBinding.ownerUserId,reason:reviewReason,
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
