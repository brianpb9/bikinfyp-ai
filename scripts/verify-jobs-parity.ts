import assert from "node:assert/strict";
import fs from "node:fs";

type Snapshot = { stale: number; state: string; refunded: number; terminalBlocked: boolean; cost: number; providers: string; output: string; foreignOutputBlocked: boolean; atomicRollback: boolean };
const mode = process.argv[2]; if (mode !== "sqlite" && mode !== "postgres") throw new Error("Gunakan sqlite atau postgres.");
const t0 = "2026-08-01T00:00:00.000Z"; const old = "2026-07-30T00:00:00.000Z";

if (mode === "sqlite") {
  assert.ok(process.env.DB_PATH); fs.rmSync(process.env.DB_PATH, { force: true }); process.env.RACUN_NO_DOTENV = "1";
  // SQLite job transitions log for the development worker; keep this harness
  // machine-readable without changing runtime logging behavior.
  console.log = () => undefined;
  const { getDb } = await import("../lib/db"); const { getJob, failJob, sweepStaleJobs, addCost, setJobProviders, transition } = await import("../lib/jobs");
  const db = getDb(); seedSqlite(db);
  const stale = sweepStaleJobs(); const job = getJob("job-a")!; const terminalBlocked = !transition("job-a", "READY");
  addCost("job-a", 420); setJobProviders("job-a", "video-a", "voice-a");
  db.prepare("INSERT OR REPLACE INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist) VALUES (?,?,?,?,?,?)").run("job-a","first.mp4","c","[]","now","[]");
  db.prepare("INSERT OR REPLACE INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist) VALUES (?,?,?,?,?,?)").run("job-a","second.mp4","c2","[]","later","[]");
  const output = (db.prepare("SELECT video_url FROM outputs WHERE job_id=?").get("job-a") as {video_url:string}).video_url;
  const foreignOutputBlocked = !(db.prepare("SELECT o.* FROM outputs o JOIN jobs j ON j.id=o.job_id WHERE o.job_id=? AND j.user_id=?").get("job-a","user-b"));
  // SQLite FK behavior is the reference atomicity expectation.
  let atomicRollback=false; try { db.prepare("INSERT INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist) VALUES ('missing','x','x','[]','x','[]')").run(); } catch { atomicRollback = !(db.prepare("SELECT 1 FROM outputs WHERE job_id='missing'").get()); }
  const release = db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM credit_ledger WHERE job_id='job-a' AND type='release'").get() as {n:number};
  process.stdout.write(JSON.stringify({ stale, state: getJob("job-a")!.state, refunded: release.n, terminalBlocked, cost: getJob("job-a")!.cost_actual_idr, providers: `${getJob("job-a")!.provider_video}/${getJob("job-a")!.provider_voice}`, output, foreignOutputBlocked, atomicRollback } satisfies Snapshot)+"\n");
} else {
  const url=process.env.DATABASE_URL; assert.ok(url); const { Pool }=await import("pg"); const { PgJobsRepository }=await import("../lib/postgres/jobs");
  const pool=new Pool({connectionString:url}); const repo=new PgJobsRepository(url,{now:()=>t0,stateTimeoutsMin:{QUEUED:30}});
  try {
    await seedPostgres(pool); const stale=await repo.sweepStaleJobs(new Date(t0).getTime()); const after=await repo.getJob("job-a"); assert.ok(after);
    await assert.rejects(() => pool.query("UPDATE jobs SET state='NOT_A_STATE' WHERE id='job-a'"), /jobs_state_known_check|check constraint/i, "database harus menolak state job tidak dikenal");
    const terminalBlocked=!(await repo.transition("job-a","READY")); await repo.addCost("job-a",420); await repo.setProviders("job-a","video-a","voice-a");
    assert.equal(await repo.upsertOutput({jobId:"job-a",userId:"user-a",videoUrl:"first.mp4",caption:"c",hashtags:"[]",suggestedPostTime:"now",complianceChecklist:"[]"}),true);
    assert.equal(await repo.upsertOutput({jobId:"job-a",userId:"user-a",videoUrl:"second.mp4",caption:"c2",hashtags:"[]",suggestedPostTime:"later",complianceChecklist:"[]"}),true);
    assert.equal(await repo.upsertOutput({jobId:"job-a",userId:"user-b",videoUrl:"bad",caption:"x",hashtags:"[]",suggestedPostTime:"x",complianceChecklist:"[]"}),false);
    const output=await repo.getOutput("job-a","user-a"); const foreignOutputBlocked=!(await repo.getOutput("job-a","user-b"));
    let atomicRollback=false; try { await pool.query("INSERT INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist) VALUES ('missing','x','x','[]','x','[]')"); } catch { atomicRollback=!(await pool.query("SELECT 1 FROM outputs WHERE job_id='missing'")).rowCount; }
    // Fresh database attack proof: only one terminal outcome wins even with concurrent workers.
    await createJob(pool,"job-race","user-a",t0); const race=await Promise.all([repo.transition("job-race","READY"),repo.failJob("job-race","timeout")]); assert.equal(race.filter((x)=>x === true || (typeof x === "object" && x.changed)).length,1,"terminal race harus punya satu pemenang");
    const release=(await pool.query<{n:string}>("SELECT COALESCE(SUM(delta),0) n FROM credit_ledger WHERE job_id='job-a' AND type='release'")).rows[0]; const final=await repo.getJob("job-a"); assert.ok(final && output);
    process.stdout.write(JSON.stringify({stale,state:final.state,refunded:Number(release.n),terminalBlocked,cost:final.cost_actual_idr,providers:`${final.provider_video}/${final.provider_voice}`,output:output.video_url,foreignOutputBlocked,atomicRollback} satisfies Snapshot)+"\n");
  } finally { await repo.close(); await pool.end(); }
}

function seedSqlite(db: any) { // test harness intentionally inserts the same FK graph as the production route.
  db.prepare("INSERT INTO users (id,email,tier,locale,created_at) VALUES ('user-a','a@test','free','id-ID',?),('user-b','b@test','free','id-ID',?)").run(t0,t0);
  db.prepare("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ('product-a','user-a','P',1,'x','[]',?)").run(t0);
  db.prepare("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ('script-a','product-a','h','e','r','[]','c','[]','{}',?)").run(t0);
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ('bonus','user-a',5000,'bonus',?)").run(t0);
  db.prepare("INSERT INTO jobs (id,user_id,product_id,script_id,state,created_at,state_changed_at) VALUES ('job-a','user-a','product-a','script-a','QUEUED',?,?)").run(old,old);
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ('hold','user-a',-5000,'hold','job-a',?)").run(t0);
}
async function seedPostgres(pool: any) {
  await pool.query("INSERT INTO users (id,email,tier,locale,created_at) VALUES ('user-a','a@test','free','id-ID',$1),('user-b','b@test','free','id-ID',$1)",[t0]);
  await pool.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ('product-a','user-a','P',1,'x','[]',$1)",[t0]);
  await pool.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ('script-a','product-a','h','e','r','[]','c','[]','{}',$1)",[t0]);
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ('bonus','user-a',5000,'bonus',$1)",[t0]); await createJob(pool,"job-a","user-a",old);
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ('hold','user-a',-5000,'hold','job-a',$1)",[t0]);
}
async function createJob(pool: any,id:string,user:string,changed:string) { await pool.query("INSERT INTO jobs (id,user_id,product_id,script_id,state,created_at,state_changed_at) VALUES ($1,$2,'product-a','script-a','QUEUED',$3,$3)",[id,user,changed]); }
