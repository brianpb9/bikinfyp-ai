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
  const [{getDb,now},{findOrCreateUserByPhone,issueToken,cookieName},{GET},{GET:fileGET},{createSignedUrl}]=await Promise.all([
    import("../lib/db"),import("../lib/auth"),import("../app/api/jobs/[id]/output/route"),
    import("../app/api/files/[...path]/route"),import("../lib/signed-url"),
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
  const snapshot=JSON.stringify({version:4,productName:"Produk READY C5",category:"beauty",categoryReviewVersion:1,
    priceIdr:10000,promoPriceBeforeIdr:null,promoEndsAt:null,promoStockLeft:null,
    trustedBrand:{source:"products.raw_meta.brand",value:null},productVisualDesc:null,brandBrief:null,claims:[]});
  db.prepare(`INSERT INTO jobs (id,user_id,product_id,script_id,job_product_snapshot,state,created_at)
    VALUES (?,?,?,?,?,'READY',?)`).run(jobId,user.id,productId,scriptId,snapshot,now());
  db.prepare(`INSERT INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist)
    VALUES (?,?,?,?,?,?)`).run(jobId,"jobs/ready/output.mp4","caption","[]","19:00","[]");
  db.prepare(`INSERT INTO job_shots (id,job_id,idx,prompt,storage_key,thumb_key,duration_sec,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run("shot-ready-c5",jobId,0,"prompt","jobs/ready/scene.mp4",null,3,now());
  fs.mkdirSync(path.join(root,"storage/jobs/ready"),{recursive:true});
  fs.writeFileSync(path.join(root,"storage/jobs/ready/output.mp4"),Buffer.from("OUTPUT-C5"));
  fs.writeFileSync(path.join(root,"storage/jobs/ready/scene.mp4"),Buffer.from("SCENE-C5"));
  const token=await issueToken(user.id,user.phone??"");
  const request=()=>new Request(`http://localhost/api/jobs/${jobId}/output`,{headers:{cookie:`${cookieName()}=${token}`}});
  const clear=await GET(request(),{params:Promise.resolve({id:jobId})});
  assert.equal(clear.status,200);const issued=String((await clear.json()).video_url);
  assert.match(issued,/jobs%2Fready%2Foutput\.mp4|jobs\/ready\/output\.mp4/);
  const fetchIssued=async(signed:string)=>{
    const url=new URL(signed,"http://localhost");
    return fileGET(new Request(url,{headers:{cookie:`${cookieName()}=${token}`}}),
      {params:Promise.resolve({path:url.pathname.slice("/api/files/".length).split("/")})});
  };
  const issuedScene=createSignedUrl("jobs/ready/scene.mp4");
  const beforeOutput=await fetchIssued(issued);const beforeScene=await fetchIssued(issuedScene);
  assert.equal(beforeOutput.status,200);assert.equal(beforeScene.status,200);
  assert.match(beforeOutput.headers.get("cache-control")??"",/no-store/);

  db.prepare(`UPDATE products SET category_review_state='QUARANTINED',category_review_reason='CATEGORY_UNKNOWN',
    category_reviewed_by=NULL,category_reviewed_role=NULL,category_reviewed_at=NULL,category_review_version=2 WHERE id=?`).run(productId);
  const quarantined=await GET(request(),{params:Promise.resolve({id:jobId})});
  assert.equal(quarantined.status,422);
  assert.equal((await quarantined.json()).code,"CATEGORY_REVIEW_REQUIRED");
  assert.equal((await fetchIssued(issued)).status,403,"old output URL remained usable");
  assert.equal((await fetchIssued(issuedScene)).status,403,"old scene URL remained usable");

  db.prepare(`UPDATE products SET category='health',category_review_state='CLEAR',category_review_reason=NULL,
    category_reviewed_by='founder-1',category_reviewed_role='Founder/CEO',category_reviewed_at=?,
    category_review_version=3 WHERE id=?`).run(now(),productId);
  assert.equal((await fetchIssued(issued)).status,403,"old output revived after different-category release");
  assert.equal((await fetchIssued(issuedScene)).status,403,"old scene revived after different-category release");
});

test("PostgreSQL media authorization binds output and scene delivery to current C5 truth",async(t)=>{
  const {fileBelongsToUser,setMediaFileAccessDependenciesForTests}=await import("../lib/media-file-access");
  t.after(()=>setMediaFileAccessDependenciesForTests());
  let category="beauty";let version=1;const checkedSql:string[]=[];
  const snapshot=JSON.stringify({version:4,category:"beauty",categoryReviewVersion:1});
  setMediaFileAccessDependenciesForTests({postgresRuntimeEnabled:()=>true,getPool:(()=>({
    query:async(sql:string)=>{checkedSql.push(sql);return sql.includes("FROM outputs")
      ? {rowCount:1,rows:[{job_product_snapshot:snapshot,category,category_review_version:version}]}
      : {rowCount:0,rows:[]};},
  })) as never});
  assert.equal(await fileBelongsToUser("jobs/pg/output.mp4","user-pg"),true);
  assert.match(checkedSql[0],/outputs[\s\S]*JOIN products p/);
  assert.match(checkedSql[0],/job_shots[\s\S]*JOIN products p/);
  assert.match(checkedSql[0],/category_review_state='CLEAR'[\s\S]*category_review_reason IS NULL/);
  category="health";version=3;
  assert.equal(await fileBelongsToUser("jobs/pg/output.mp4","user-pg"),false);
  assert.equal(await fileBelongsToUser("jobs/pg/scene.mp4","user-pg"),false);
});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
