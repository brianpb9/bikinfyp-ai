/** PostgreSQL regression for the exact candidate-4 hands-only ledger tuple.
 * Runs only in the disposable DB created by the evidence-lease harness. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";

const URL_UJI = process.env.UJI_PG_URL ?? "";
const skip = !URL_UJI;
const USER = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
const PRODUCT = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const SCRIPT = "ca32178f-2731-4234-bb07-48f24a2f2079";
const JOB = "2c49a5c8-9465-4400-a214-159336a2c097";
const TASK = "FINAL-POST-SWEEP-CANDIDATE-4-20260901";
const REFERENCE = "744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1";
const AT = "2026-08-31T19:47:54.433Z";
let pool: Pool;

before(async () => { if (!skip) pool = new Pool({connectionString:URL_UJI,max:2}); });
after(async () => { if (!skip) await pool.end(); });

type Tuple = {task:string;job:string;user:string;product:string;reference:string;
  approved:string|null;category:string;format:string;duration:number};
const exact:Tuple = {task:TASK,job:JOB,user:USER,product:PRODUCT,reference:REFERENCE,
  approved:"e".repeat(64),category:"beauty",format:"hands_only",duration:15};

async function insertEvidence(client:PoolClient, value:Tuple) {
  await client.query(`INSERT INTO normal_representative_evidence_runs
    (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
     reference_brand,authorization_source,product_snapshot_sha256,approved_script_sha256,deploy_sha,model,
     category,format,duration_s,resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'777b1356-2a88-4120-ab61-d49b02ceca10',$6,$7,'JJ GLOW',
      'approved_reference_manifest:v2',$8,$9,$10,'dreamina-seedance-2-0-mini-260615',$11,$12,$13,
      '720p',1.134,1.25,0,'PREPOST_READY',$14,$14)`,
  [value.task,crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"),value.job,value.user,
    value.product,value.reference,"b".repeat(64),"c".repeat(64),value.approved,"d".repeat(40),
    value.category,value.format,value.duration,AT]);
}

test("candidate #4 exact evidence tuple succeeds and every neighboring tuple is rejected", {skip,concurrency:false}, async () => {
  const client=await pool.connect();
  const altUser="11111111-1111-4111-8111-111111111111";
  const altProduct="22222222-2222-4222-8222-222222222222";
  const altScript="33333333-3333-4333-8333-333333333333";
  const altJob="44444444-4444-4444-8444-444444444444";
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id,email,created_at) VALUES ($1,'candidate4@example.test',$2),($3,'neighbor@example.test',$2)",
      [USER,AT,altUser]);
    await client.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'JJ GLOW',12000,'beauty','[]',$3),($4,$5,'Neighbor',12000,'beauty','[]',$3)",
      [PRODUCT,USER,AT,altProduct,altUser]);
    await client.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ($1,$2,'H1','joy','bestie','[]','exact','[]','{}',$3),($4,$5,'H1','joy','bestie','[]','neighbor','[]','{}',$3)",
      [SCRIPT,PRODUCT,AT,altScript,altProduct]);
    await client.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'hands_only','high_quality',15,'QUEUED',$5,$5),($6,$7,$8,$9,'hands_only','high_quality',15,'QUEUED',$5,$5)",
      [JOB,USER,PRODUCT,SCRIPT,AT,altJob,altUser,altProduct,altScript]);

    await assert.doesNotReject(() => insertEvidence(client,exact));
    assert.equal((await client.query("SELECT count(*)::int n FROM normal_representative_evidence_runs WHERE job_id=$1",[JOB])).rows[0].n,1);
    await client.query("DELETE FROM normal_representative_evidence_runs WHERE job_id=$1",[JOB]);

    const neighbors:Array<[string,Tuple]> = [
      ["task",{...exact,task:"FINAL-POST-SWEEP-CANDIDATE-5-UNAUTHORIZED"}],
      ["job",{...exact,job:altJob}], ["user",{...exact,user:altUser}],
      ["product",{...exact,product:altProduct}], ["reference",{...exact,reference:"f".repeat(64)}],
      ["approved script",{...exact,approved:null}], ["category",{...exact,category:"food"}],
      ["format",{...exact,format:"talking_head"}], ["duration",{...exact,duration:30}],
    ];
    for (const [field,value] of neighbors) {
      await client.query("SAVEPOINT neighbor");
      let error:unknown;
      try { await insertEvidence(client,value); } catch (caught) { error=caught; }
      await client.query("ROLLBACK TO SAVEPOINT neighbor");
      await client.query("RELEASE SAVEPOINT neighbor");
      assert.equal((error as {code?:string})?.code,"23514",`${field} neighbor must fail exact CHECK`);
    }
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); }
});
