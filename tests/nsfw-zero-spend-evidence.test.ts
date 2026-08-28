import assert from "node:assert/strict";
import test from "node:test";
import {isProviderContentRejection,summarizeNsfwAggregates} from "../lib/nsfw-kpi.mjs";

process.env.DB_PATH=`/tmp/racun-test-nsfw-zero-spend-${process.pid}.db`;
process.env.STORAGE_DIR=`/tmp/racun-test-nsfw-zero-spend-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED="1";

const {getDb,now,uuid}=await import("../lib/db");
const {findOrCreateUserByPhone}=await import("../lib/auth");
const {getBalance,holdCredits}=await import("../lib/credits");
const {failJob,getJob}=await import("../lib/jobs");

test("formal NSFW KPI threshold is deterministic and excludes infrastructure failures",()=>{
  const summary=summarizeNsfwAggregates([
    {format:"hands_only",sukses:"8",ditolak_konten:"2",gagal_semua:"5"},
    {format:"talking_head",sukses:6,ditolak_konten:4,gagal_semua:5},
    {format:"new_format",sukses:0,ditolak_konten:0,gagal_semua:3},
  ]);
  assert.deepEqual(summary.map((row:{format:string;rate:number;otherFailures:number;thresholdStatus:string})=>
    [row.format,row.rate,row.otherFailures,row.thresholdStatus]),[
    ["hands_only",0.2,3,"PASS"],["talking_head",0.4,1,"FAIL"],["new_format",0,3,"UNSCOPED"],
  ]);
  assert.equal(isProviderContentRejection("timeout after request bytes sent"),false);
  assert.equal(isProviderContentRejection("input image may contain real person"),true);
});

test("zero-spend content rejection uses real failJob refund exactly once",()=>{
  const db=getDb(),user=findOrCreateUserByPhone("080000028828");
  const productId=uuid(),scriptId=uuid(),jobId=uuid(),at=now();
  db.prepare("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?, 'NSFW Fixture',1000,'default','[]',?)")
    .run(productId,user.id,at);
  db.prepare("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,approved_by_user_at,created_at) VALUES (?,?, 'H1','x','netral','[]','','[]','{}',?,?)")
    .run(scriptId,productId,at,at);
  db.prepare("INSERT INTO jobs (id,user_id,product_id,script_id,format,duration_s,state,cost_actual_idr,created_at,state_changed_at) VALUES (?,?,?,?, 'hands_only',15,'GENERATING_VISUAL',0,?,?)")
    .run(jobId,user.id,productId,scriptId,at,at);
  assert.equal(holdCredits(user.id,jobId,5000),true);
  const afterHold=getBalance(user.id);
  const reason="byteplus fixture: output flagged as nsfw";
  failJob(getJob(jobId)!,reason);failJob(getJob(jobId)!,`${reason} duplicate`);
  const job=getJob(jobId)!;
  assert.equal(job.state,"REFUNDED");assert.equal(job.cost_actual_idr,0);
  assert.equal(job.provider_video,null);assert.equal(getBalance(user.id),afterHold+5000);
  const releases=db.prepare("SELECT count(*) AS n FROM credit_ledger WHERE job_id=? AND type='release'").get(jobId) as {n:number};
  assert.equal(releases.n,1,"refund wajib append exactly once");
  const failed=db.prepare("SELECT meta FROM audit_log WHERE entity='jobs' AND entity_id=? AND action='job.transition' ORDER BY created_at")
    .all(jobId).map((row:any)=>JSON.parse(row.meta)).find((meta:any)=>meta.to==="FAILED");
  assert.equal(failed.reason,reason);assert.equal(isProviderContentRejection(failed.reason),true);
});
