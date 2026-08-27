import { config } from "./config";
import { getDb } from "./db";
import { postgresRuntimeEnabled } from "./postgres/smoke-runtime";
import { getPool } from "./postgres/pool";

type QueryResult={rowCount:number|null};
type QueryPool={query(sql:string,values:unknown[]):Promise<QueryResult>};
const productionDependencies={
  postgresRuntimeEnabled,
  getPool:(databaseUrl:string)=>getPool(databaseUrl) as unknown as QueryPool,
  getDb,
};
type Dependencies=typeof productionDependencies;
let overrides:Partial<Dependencies>|undefined;

export function setMediaFileAccessDependenciesForTests(next?:Partial<Dependencies>):void {overrides=next;}
function dependencies():Dependencies{return {...productionDependencies,...overrides};}

const CANONICAL_CATEGORY_SQL="('beauty','health','fashion','muslim_fashion','home','kitchen','gadget','electronics','food','kids','jasa','app','toko')";

/** A valid HMAC link is a bearer capability, never proof of account ownership.
 * Generated job media additionally rechecks current C5 truth on every byte
 * request, so an already-issued URL is revoked by re-quarantine. */
export async function fileBelongsToUser(relPath:string,userId:string):Promise<boolean>{
  const deps=dependencies();
  if(deps.postgresRuntimeEnabled()){
    const pool=deps.getPool(config.databaseUrl);
    const result=await pool.query(`
      SELECT 1 FROM outputs o JOIN jobs j ON j.id=o.job_id JOIN products p ON p.id=j.product_id
        WHERE o.video_url=$1
          AND p.category_review_state='CLEAR' AND p.category_review_reason IS NULL
          AND p.category_review_version>=1 AND p.category IN ${CANONICAL_CATEGORY_SQL}
          AND ((j.org_id IS NULL AND j.user_id=$2)
            OR EXISTS (SELECT 1 FROM org_members m JOIN organizations org ON org.id=m.org_id
                       WHERE m.org_id=j.org_id AND m.user_id=$2 AND org.status='active'))
      UNION ALL
      SELECT 1 FROM products p CROSS JOIN LATERAL jsonb_array_elements_text(p.images::jsonb) image(path)
        WHERE image.path=$1 AND ((p.org_id IS NULL AND p.user_id=$2)
          OR EXISTS (SELECT 1 FROM org_members m JOIN organizations org ON org.id=m.org_id
                     WHERE m.org_id=p.org_id AND m.user_id=$2 AND org.status='active'))
      UNION ALL
      SELECT 1 FROM promo_jobs pj WHERE pj.user_id=$2 AND $1 IN (pj.output_url,pj.generated_shot_url)
      UNION ALL
      SELECT 1 FROM promo_jobs pj CROSS JOIN LATERAL jsonb_array_elements_text(pj.uploaded_clip_urls::jsonb) clip(path)
        WHERE pj.user_id=$2 AND clip.path=$1
      UNION ALL
      SELECT 1 FROM job_shots js JOIN jobs j ON j.id=js.job_id JOIN products p ON p.id=j.product_id
        WHERE $1 IN (js.storage_key,js.thumb_key)
          AND p.category_review_state='CLEAR' AND p.category_review_reason IS NULL
          AND p.category_review_version>=1 AND p.category IN ${CANONICAL_CATEGORY_SQL}
          AND ((j.org_id IS NULL AND j.user_id=$2)
            OR EXISTS (SELECT 1 FROM org_members m JOIN organizations org ON org.id=m.org_id
                       WHERE m.org_id=j.org_id AND m.user_id=$2 AND org.status='active'))
      LIMIT 1`,[relPath,userId]);
    return Boolean(result.rowCount);
  }
  const db=deps.getDb();
  const c5=`p.category_review_state='CLEAR' AND p.category_review_reason IS NULL
    AND p.category_review_version>=1 AND p.category IN ${CANONICAL_CATEGORY_SQL}`;
  const output=db.prepare(`SELECT 1 FROM outputs o JOIN jobs j ON j.id=o.job_id JOIN products p ON p.id=j.product_id
    WHERE o.video_url=? AND j.user_id=? AND ${c5} LIMIT 1`).get(relPath,userId);
  if(output)return true;
  const shot=db.prepare(`SELECT 1 FROM job_shots js JOIN jobs j ON j.id=js.job_id JOIN products p ON p.id=j.product_id
    WHERE (js.storage_key=? OR js.thumb_key=?) AND j.user_id=? AND ${c5} LIMIT 1`).get(relPath,relPath,userId);
  if(shot)return true;
  const products=db.prepare("SELECT images FROM products WHERE user_id=?").all(userId) as {images:string}[];
  return products.some((product)=>{try{return (JSON.parse(product.images) as unknown[]).includes(relPath);}catch{return false;}});
}
