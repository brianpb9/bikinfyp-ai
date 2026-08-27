import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"c5-output-publication-"));
process.env.DB_PATH=path.join(root,"test.db");
process.env.STORAGE_DIR=path.join(root,"storage");
Object.assign(process.env,{NODE_ENV:"test"});
delete process.env.RACUN_DB_RUNTIME;
delete process.env.RACUN_POSTGRES_SMOKE;

test("READY retail output stops issuing signed URLs immediately after C5 re-quarantine",async()=>{
  const [{getDb,now},{findOrCreateUserByPhone,issueToken,cookieName},{GET}]=await Promise.all([
    import("../lib/db"),import("../lib/auth"),import("../app/api/jobs/[id]/output/route"),
  ]);
  const db=getDb();
  const user=findOrCreateUserByPhone("+6280000000005");
  const productId="product-ready-c5";const scriptId="script-ready-c5";const jobId="job-ready-c5";
  db.prepare(`INSERT INTO products (id,user_id,name,price_idr,category,product_type_token,
    product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,product_type_version,
    product_type_state,category_review_state,category_review_reason,category_review_version,images,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,'CONFIRMED','CLEAR',NULL,1,'[]',?)`).run(
      productId,user.id,"Produk READY C5",10000,"beauty","serum","serum",user.id,"2026-08-27T20:00:00.000Z",now());
  db.prepare(`INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,
    validation_result,approved_by_user_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      scriptId,productId,"problem","senang","santai","[]","caption","[]","{}",now(),now());
  db.prepare(`INSERT INTO jobs (id,user_id,product_id,script_id,state,created_at) VALUES (?,?,?,?,'READY',?)`)
    .run(jobId,user.id,productId,scriptId,now());
  db.prepare(`INSERT INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist)
    VALUES (?,?,?,?,?,?)`).run(jobId,"jobs/ready/output.mp4","caption","[]","19:00","[]");
  const token=await issueToken(user.id,user.phone??"");
  const request=()=>new Request(`http://localhost/api/jobs/${jobId}/output`,{headers:{cookie:`${cookieName()}=${token}`}});
  const clear=await GET(request(),{params:Promise.resolve({id:jobId})});
  assert.equal(clear.status,200);assert.match(String((await clear.json()).video_url),/jobs%2Fready%2Foutput\.mp4|jobs\/ready\/output\.mp4/);

  db.prepare(`UPDATE products SET category_review_state='QUARANTINED',category_review_reason='CATEGORY_UNKNOWN',
    category_reviewed_by=NULL,category_reviewed_role=NULL,category_reviewed_at=NULL,category_review_version=2 WHERE id=?`).run(productId);
  const quarantined=await GET(request(),{params:Promise.resolve({id:jobId})});
  assert.equal(quarantined.status,422);
  assert.equal((await quarantined.json()).code,"CATEGORY_REVIEW_REQUIRED");
});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
