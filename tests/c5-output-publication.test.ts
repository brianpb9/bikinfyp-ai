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
  const [{getDb,now},{findOrCreateUserByPhone,issueToken,cookieName},{GET},{GET:jobsGET},{GET:fileGET},{createSignedUrl}]=await Promise.all([
    import("../lib/db"),import("../lib/auth"),import("../app/api/jobs/[id]/output/route"),
    import("../app/api/jobs/route"),import("../app/api/files/[...path]/route"),import("../lib/signed-url"),
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

  db.prepare(`UPDATE products SET category='beauty',category_review_state='CLEAR',category_review_reason=NULL,
    category_reviewed_by='founder-1',category_reviewed_role='Founder/CEO',category_reviewed_at=?,
    category_review_version=3 WHERE id=?`).run(now(),productId);
  const releasedStale=await GET(request(),{params:Promise.resolve({id:jobId})});
  assert.equal(releasedStale.status,422,"output metadata revived after same-category release at a newer version");
  assert.equal((await releasedStale.json()).code,"CATEGORY_REVIEW_REQUIRED");
  assert.equal((await fetchIssued(issued)).status,403,"old output revived after same-category release");
  assert.equal((await fetchIssued(issuedScene)).status,403,"old scene revived after same-category release");

  db.prepare(`UPDATE products SET category_review_state='QUARANTINED',category_review_reason='CATEGORY_UNKNOWN',
    category_reviewed_by=NULL,category_reviewed_role=NULL,category_reviewed_at=NULL,category_review_version=4 WHERE id=?`).run(productId);
  db.prepare(`UPDATE products SET category='health',category_review_state='CLEAR',category_review_reason=NULL,
    category_reviewed_by='founder-1',category_reviewed_role='Founder/CEO',category_reviewed_at=?,
    category_review_version=5 WHERE id=?`).run(now(),productId);
  const changedCategory=await GET(request(),{params:Promise.resolve({id:jobId})});
  assert.equal(changedCategory.status,422,"output metadata revived after different-category release");
  assert.equal((await changedCategory.json()).code,"CATEGORY_REVIEW_REQUIRED");
  assert.equal((await fetchIssued(issued)).status,403,"old output revived after different-category release");
  assert.equal((await fetchIssued(issuedScene)).status,403,"old scene revived after different-category release");
  const list=await jobsGET(new Request("http://localhost/api/jobs",{headers:{cookie:`${cookieName()}=${token}`} }));
  assert.equal(list.status,200);
  const listed=(await list.json() as {jobs:Array<{id:string;preview_url:string|null}>}).jobs.find((job)=>job.id===jobId);
  assert.ok(listed);assert.equal(listed.preview_url,null,"job list revived an old-generation output URL");
});

test("all delivery/planning surfaces bind the v4 snapshot generation",async()=>{
  const {isCurrentC5JobGeneration}=await import("../lib/legacy-job-quarantine");
  const snapshot=JSON.stringify({version:4,productName:"Produk",category:"beauty",categoryReviewVersion:1,
    priceIdr:10000,promoPriceBeforeIdr:null,promoEndsAt:null,promoStockLeft:null,
    trustedBrand:{source:"products.raw_meta.brand",value:null},productVisualDesc:null,brandBrief:null,claims:[]});
  const live={job_product_snapshot:snapshot,product_category:"beauty",category_review_state:"CLEAR",
    category_review_reason:null,category_review_version:1};
  assert.equal(isCurrentC5JobGeneration(live),true);
  assert.equal(isCurrentC5JobGeneration({...live,product_category:"health",category_review_version:3}),false);
  assert.equal(isCurrentC5JobGeneration({...live,category_review_version:3}),false);

  for(const relative of [
    "../app/api/jobs/[id]/output/route.ts","../app/api/jobs/route.ts",
    "../app/api/dashboard/campaign/[runId]/route.ts","../app/api/dashboard/campaign/job/[jobId]/route.ts",
    "../app/api/dashboard/library/route.ts","../app/api/dashboard/publish/route.ts",
  ]){
    const source=fs.readFileSync(new URL(relative,import.meta.url),"utf8");
    assert.match(source,/CurrentC5JobGeneration/,`${relative} masih current-only`);
    assert.match(source,/job_product_snapshot|SELECT j\.\*/,`${relative} tidak memuat snapshot admission`);
  }
  const publish=fs.readFileSync(new URL("../app/api/dashboard/publish/route.ts",import.meta.url),"utf8");
  assert.match(publish,/withProductEvidenceMutationLock\(initial\.rows\[0\]\.product_id/);
  assert.ok(publish.indexOf("assertCurrentC5JobGeneration(owned.rows[0])")<publish.indexOf("INSERT INTO post_plans"));
});

test("actual dashboard handlers withhold old-generation scene, caption, and URL surfaces",async(t)=>{
  const [{GET:campaignScene},{GET:campaignRun},{GET:library},{GET:publish},
    {setCampaignJobDependenciesForTests},{setC5DeliveryRouteDependenciesForTests}]=await Promise.all([
    import("../app/api/dashboard/campaign/job/[jobId]/route"),
    import("../app/api/dashboard/campaign/[runId]/route"),
    import("../app/api/dashboard/library/route"),import("../app/api/dashboard/publish/route"),
    import("../lib/campaign-job-dependencies"),import("../lib/c5-delivery-route-dependencies"),
  ]);
  t.after(()=>{setCampaignJobDependenciesForTests();setC5DeliveryRouteDependenciesForTests();});
  const snapshot=JSON.stringify({version:4,productName:"Produk",category:"beauty",categoryReviewVersion:1,
    priceIdr:10000,promoPriceBeforeIdr:null,promoEndsAt:null,promoStockLeft:null,
    trustedBrand:{source:"products.raw_meta.brand",value:null},productVisualDesc:null,brandBrief:null,claims:[]});
  let generation={product_category:"beauty",category_review_state:"CLEAR",category_review_reason:null,
    category_review_version:3};
  let signed=0;let sceneReads=0;
  const base=()=>({job_id:"job-old",id:"job-old",product_id:"product-1",state:"READY",org_id:"org-1",
    approved_at:null,requires_approval:true,product_name:"Produk",segments:"[]",quality_tier:"standard",
    format:"talking_head",template_id:null,script_validation_result:null,approved_reference_manifest:null,
    job_product_snapshot:snapshot,product_type_token:"serum",product_type_confirmed_token:"serum",
    product_type_confirmed_by:"user-1",product_type_confirmed_at:"2026-08-27T00:00:00.000Z",
    product_type_version:1,product_type_state:"CONFIRMED",category_reviewed_by:"founder-1",
    category_reviewed_role:"Founder/CEO",category_reviewed_at:"2026-08-27T00:00:00.000Z",
    product_name_alias:"Produk",cost_actual_idr:1000,video_url:"jobs/old/output.mp4",caption:"STALE CAPTION",
    created_at:"2026-08-27T00:00:00.000Z",duration_s:15,bulk_run_id:"run-1",thumb_key:"jobs/old/thumb.webp",
    fail_meta:null,channel:"tiktok",scheduled_at:"2026-08-29T00:00:00.000Z",status:"planned",posted_at:null,
    ...generation});
  const pool={query:async(sql:string)=>{
    if(sql.includes("FROM post_plans"))return {rows:[{...base(),id:"plan-old",job_id:"job-old"}],rowCount:1};
    if(sql.includes("j.state = 'READY'")&&sql.includes("outputs"))return {rows:[base()],rowCount:1};
    if(sql.includes("bulk_run_id"))return {rows:[base()],rowCount:1};
    if(sql.includes("LIMIT 200"))return {rows:[base()],rowCount:1};
    if(sql.includes("p.name AS product_name, s.segments"))return {rows:[base()],rowCount:1};
    if(sql.includes("FROM job_shots")){sceneReads++;return {rows:[{idx:0,prompt:"STALE PROMPT",storage_key:"jobs/old/scene.mp4",thumb_key:null,duration_sec:3,regen_requested:false,regen_count:0}],rowCount:1};}
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const context={user:{id:"user-1"},membership:{org_id:"org-1",role:"member"}};
  const shared={postgresRuntimeEnabled:()=>true,requireOrgContextApi:async()=>context as never,
    getPool:(()=>pool) as never,createSignedUrl:(key:string)=>{signed++;return `/signed/${key}`;}};
  setCampaignJobDependenciesForTests(shared);
  setC5DeliveryRouteDependenciesForTests(shared);

  for(const next of [
    {product_category:"beauty",category_review_state:"CLEAR",category_review_reason:null,category_review_version:3},
    {product_category:"health",category_review_state:"CLEAR",category_review_reason:null,category_review_version:5},
  ]){
    generation=next;signed=0;sceneReads=0;
    const sceneResponse=await campaignScene(new Request("http://local/campaign/job/job-old"),
      {params:Promise.resolve({jobId:"job-old"})});
    assert.equal(sceneResponse.status,422);assert.equal((await sceneResponse.json()).code,"CATEGORY_REVIEW_REQUIRED");
    assert.equal(sceneReads,0,"stale scene metadata query executed");

    const runResponse=await campaignRun(new Request("http://local/campaign/run-1"),{params:Promise.resolve({runId:"run-1"})});
    const runJob=(await runResponse.json() as {jobs:Array<Record<string,unknown>>}).jobs[0];
    assert.deepEqual({video_url:runJob.video_url,download_url:runJob.download_url,caption:runJob.caption},
      {video_url:null,download_url:null,caption:null});

    const libraryResponse=await library(new Request("http://local/library"));
    const video=(await libraryResponse.json() as {videos:Array<Record<string,unknown>>}).videos[0];
    assert.deepEqual({video_url:video.video_url,download_url:video.download_url,thumb_url:video.thumb_url,caption:video.caption},
      {video_url:null,download_url:null,thumb_url:null,caption:null});

    const publishResponse=await publish(new Request("http://local/publish"));
    const publishBody=await publishResponse.json() as {plans:Array<Record<string,unknown>>;ready:unknown[]};
    assert.equal(publishBody.plans[0].caption,null,"stale post-plan caption leaked");
    assert.equal(publishBody.plans[0].download_url,null,"stale post-plan URL leaked");
    assert.deepEqual(publishBody.ready,[],"stale job remained publish-ready");
    assert.equal(signed,0,"a stale surface issued a signed URL");
  }
});

test("publish POST reloads eligibility after lock and leaves zero plans on interleaved re-quarantine",async(t)=>{
  const [{POST},{setC5DeliveryRouteDependenciesForTests}]=await Promise.all([
    import("../app/api/dashboard/publish/route"),import("../lib/c5-delivery-route-dependencies"),
  ]);
  t.after(()=>setC5DeliveryRouteDependenciesForTests());
  const snapshot=JSON.stringify({version:4,productName:"Produk",category:"beauty",categoryReviewVersion:1,
    priceIdr:10000,promoPriceBeforeIdr:null,promoEndsAt:null,promoStockLeft:null,
    trustedBrand:{source:"products.raw_meta.brand",value:null},productVisualDesc:null,brandBrief:null,claims:[]});
  let locked=false,reloads=0,inserts=0;
  const pool={query:async(sql:string)=>{
    if(sql.startsWith("SELECT product_id"))return {rows:[{product_id:"product-1"}],rowCount:1};
    if(sql.includes("SELECT j.job_product_snapshot")){reloads++;assert.equal(locked,true,"eligibility reloaded before lock");
      return {rows:[{job_product_snapshot:snapshot,product_category:"beauty",category_review_state:"CLEAR",
        category_review_reason:null,category_review_version:3}],rowCount:1};}
    if(sql.includes("INSERT INTO post_plans")){inserts++;return {rows:[],rowCount:1};}
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  setC5DeliveryRouteDependenciesForTests({postgresRuntimeEnabled:()=>true,
    requireOrgContextApi:async()=>({user:{id:"user-1"},membership:{org_id:"org-1",role:"member"}}) as never,
    assertDashboardRate:async()=>undefined,getPool:(()=>pool) as never,pgAudit:async()=>undefined,
    withProductEvidenceMutationLock:async(_productId,operation)=>{locked=true;return operation();}});
  const response=await POST(new Request("http://local/publish",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({job_id:"job-old",channel:"tiktok",scheduled_at:"2026-08-29T00:00:00.000Z",caption:"stale"})}));
  assert.equal(response.status,422);assert.equal((await response.json()).code,"CATEGORY_REVIEW_REQUIRED");
  assert.equal(reloads,1);assert.equal(inserts,0,"stale generation created a post_plan");
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
