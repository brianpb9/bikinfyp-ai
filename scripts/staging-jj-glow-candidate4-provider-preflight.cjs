/** Fresh read-only pre-call freeze for the already-activated Candidate #4. */
const crypto=require("node:crypto");
const {Pool}=require("pg");
const {Queue}=require("bullmq");
const {S3Client,GetObjectCommand}=require("@aws-sdk/client-s3");
const {postgresRuntimeBinding}=require(`${process.cwd()}/lib/postgres/runtime-binding.cjs`);

const JOB="2c49a5c8-9465-4400-a214-159336a2c097";
const PRODUCT="c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const SCRIPT="ca32178f-2731-4234-bb07-48f24a2f2079";
const SUBJECT="777b1356-2a88-4120-ab61-d49b02ceca10";
const PRINCIPAL="ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
const TASK="FINAL-POST-SWEEP-CANDIDATE-4-20260901";
const EXECUTION_TASK="SCORE80-NORMAL-PROVIDER-EVIDENCE-20260901";
const RUNTIME="23fa4923ec667a44ef8044e309140ee169864f88";
const PRIOR_RUNTIME="4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1";
const ACTIVATION="13c22bc7a3a340f0ea5f4bb0db9a905691676c77";
const BINDING="f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610";
const REFERENCE="744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1";
const MANIFEST="33ed415c1a361f315d01f8aa1e181668fd00e3704cc69f4f8e2d65d6d6c967fa";
const SNAPSHOT="5fa4eba2297bf20724b417d1f97ba3cb747eef65f3246ac5b01f4402358502b6";
const SCRIPT_DIGEST="110198510c75de3dba61d57260dce12af7cb0f06c6a4ddfc2254479cb8f05e7c";
const RECEIPT="ca3906a381e6d299bc46fe62aeefbc3bd9b4183a6ff59c4f3cde2ca8f94788c3";
const h=(x)=>crypto.createHash("sha256").update(x).digest("hex");
const canonical=(value)=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)
  ?`[${value.map(canonical).join(",")}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
const body=async(stream)=>Buffer.from(await stream.transformToByteArray());
const fail=(ok,code)=>{if(!ok)throw Error(code)};

async function main(){
  fail(process.env.NODE_ENV==="production"&&process.env.RACUN_DEPLOY_ENV==="staging"
    &&process.env.RENDER_SERVICE_ID==="srv-d9n28ue417fc73ch2b60"
    &&process.env.RENDER_GIT_COMMIT===RUNTIME,"C4_PROVIDER_PREFLIGHT_RUNTIME_MISMATCH");
  fail(Boolean(process.env.BYTEPLUS_ARK_API_KEY),"C4_PROVIDER_PREFLIGHT_KEY_MISSING");
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1}),c=await pool.connect();
  let frozen;
  try{
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const binding=await postgresRuntimeBinding(c); fail(binding.sha256===BINDING,"C4_PROVIDER_PREFLIGHT_DB_BINDING");
    const row=(await c.query(`SELECT j.*,p.name product_name,p.category product_category,p.images product_images,
      p.raw_meta product_raw_meta,p.brand_brief,p.product_visual_desc,p.price_idr,
      s.product_id script_product_id,s.job_id script_job_id,s.hook_family,s.emotion,s.register,s.segments,
      s.caption,s.hashtags,s.validation_result,s.quality_tier script_quality_tier,s.hook_level,
      s.approved_by_user_at,s.edited_by_user,s.created_at script_created_at,
      pe.user_id persona_user_id,pe.creator_category,
      e.task_id evidence_task,e.idempotency_key,e.reference_sha256,e.reference_manifest_sha256,
      e.reference_brand,e.authorization_source,e.product_snapshot_sha256,e.approved_script_sha256,
      e.deploy_sha,e.model,e.category evidence_category,e.format evidence_format,e.duration_s evidence_duration,
      e.resolution,e.estimated_cost_usd,e.max_cost_usd,e.provider_post_count,e.state evidence_state,
      e.provider_task_id,e.payload_sha256,e.artifact_key,e.retrieval_sha256,e.qc_json,e.actual_cost_usd,
      e.lease_kind,e.lease_last_progress_at,e.lease_expires_at,
      COALESCE(sa.provider_runtime_sha,a.provider_runtime_sha) provider_runtime_sha,
      COALESCE(sa.database_binding_sha256,a.database_binding_sha256) auth_binding,
      COALESCE(sa.authorization_task_id,a.authorization_task_id) authorization_task_id,
      COALESCE(sa.authorized_by,a.authorized_by) authorized_by,
      COALESCE(sa.created_at,a.created_at) auth_created_at,
      a.provider_runtime_sha prior_provider_runtime_sha,sa.authorizer_deploy_sha
      FROM jobs j JOIN products p ON p.id=j.product_id JOIN scripts s ON s.id=j.script_id JOIN personas pe ON pe.id=j.persona_id
      JOIN normal_representative_evidence_runs e ON e.job_id=j.id
      JOIN normal_evidence_runtime_authorizations a ON a.job_id=j.id
      JOIN normal_evidence_runtime_successor_authorizations sa ON sa.job_id=j.id WHERE j.id=$1`,[JOB])).rows;
    fail(row.length===1,"C4_PROVIDER_PREFLIGHT_ROW_CARDINALITY");const r=row[0];
    const lifecycle=(await c.query("SELECT actor,meta FROM audit_log WHERE entity='jobs' AND entity_id=$1 AND action='candidate.lifecycle.created' ORDER BY created_at,id",[JOB])).rows;
    const audits=(await c.query("SELECT actor,created_at,meta FROM audit_log WHERE entity='scripts' AND entity_id=$1 AND action='script.manual_staged' ORDER BY created_at,id",[SCRIPT])).rows;
    const counts=(await c.query(`SELECT
      (SELECT count(*)::int FROM jobs WHERE product_id=$1) product_jobs,
      (SELECT count(*)::int FROM scripts WHERE product_id=$1) product_scripts,
      (SELECT count(*)::int FROM provider_tasks WHERE job_id=$2) provider_tasks,
      (SELECT count(*)::int FROM outputs WHERE job_id=$2) outputs,
      (SELECT count(*)::int FROM fyp_snapshots WHERE job_id=$2 AND posted_url IS NOT NULL) publications,
      (SELECT count(*)::int FROM post_plans WHERE job_id=$2) post_plans,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=$2 AND type='hold') holds,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=$2 AND type IN ('capture','release')) terminal_ledger`,[PRODUCT,JOB])).rows[0];
    const script={id:r.script_id,job_id:r.script_job_id,product_id:r.script_product_id,hook_family:r.hook_family,
      emotion:r.emotion,register:r.register,segments:r.segments,caption:r.caption,hashtags:r.hashtags,
      validation_result:r.validation_result,quality_tier:r.script_quality_tier,hook_level:r.hook_level,
      approved_by_user_at:r.approved_by_user_at,edited_by_user:Number(r.edited_by_user),created_at:r.script_created_at,
      manual_evidence_audit:audits[0]};
    const lifecycleMeta=JSON.parse(lifecycle[0]?.meta||"null");
    fail(r.id===JOB&&r.user_id===PRINCIPAL&&r.org_id===null&&r.product_id===PRODUCT&&r.script_id===SCRIPT&&r.persona_id===SUBJECT
      &&["QUEUED","GENERATING_VISUAL"].includes(r.state)&&r.format==="hands_only"&&r.quality_tier==="high_quality"&&Number(r.duration_s)===15
      &&r.provider_video===null&&r.provider_voice===null&&r.output_url===null&&r.requires_approval===false,"C4_PROVIDER_PREFLIGHT_JOB_CROSS_ROW");
    fail(r.script_product_id===PRODUCT&&r.script_job_id===JOB&&r.persona_user_id===PRINCIPAL&&r.creator_category==="lokal"
      &&audits.length===1&&audits[0].actor===PRINCIPAL&&h(Buffer.from(canonical(script)))===SCRIPT_DIGEST,"C4_PROVIDER_PREFLIGHT_SCRIPT_CROSS_ROW");
    fail(lifecycle.length===1&&lifecycle[0].actor===PRINCIPAL&&lifecycleMeta.task===TASK
      &&lifecycleMeta.final_candidate_ordinal===4&&lifecycleMeta.max_canonical_candidates_created===4,"C4_PROVIDER_PREFLIGHT_LIFECYCLE");
    fail(r.evidence_task===TASK&&r.deploy_sha===ACTIVATION&&r.provider_runtime_sha===RUNTIME&&r.auth_binding===BINDING
      &&r.prior_provider_runtime_sha===PRIOR_RUNTIME&&r.authorization_task_id===EXECUTION_TASK
      &&r.authorizer_deploy_sha===RUNTIME&&r.authorized_by===PRINCIPAL
      &&r.reference_sha256===REFERENCE&&r.reference_manifest_sha256===MANIFEST&&r.product_snapshot_sha256===SNAPSHOT
      &&r.approved_script_sha256===SCRIPT_DIGEST&&r.reference_brand==="JJ GLOW"&&r.model==="dreamina-seedance-2-0-mini-260615"
      &&r.evidence_category==="beauty"&&r.evidence_format==="hands_only"&&Number(r.evidence_duration)===15&&r.resolution==="720p"
      &&Number(r.estimated_cost_usd)===1.134&&Number(r.max_cost_usd)===1.25&&Number(r.provider_post_count)===0
      &&r.evidence_state==="PREPOST_READY"&&r.provider_task_id===null&&r.payload_sha256===null&&r.artifact_key===null
      &&r.retrieval_sha256===null&&r.qc_json===null&&r.actual_cost_usd===null&&r.lease_kind==="ACTIVE_EVIDENCE_LEASE"
      &&Date.parse(r.lease_expires_at)>Date.now(),"C4_PROVIDER_PREFLIGHT_EVIDENCE_AUTH_LEASE");
    fail(Number(counts.product_jobs)===2&&Number(counts.product_scripts)===2&&Number(counts.provider_tasks)===0
      &&Number(counts.outputs)===0&&Number(counts.publications)===0&&Number(counts.post_plans)===0
      &&Number(counts.holds)===1&&Number(counts.terminal_ledger)===0,"C4_PROVIDER_PREFLIGHT_EFFECT_COUNTS");
    const manifest=JSON.parse(r.approved_reference_manifest),snapshot=JSON.parse(r.job_product_snapshot),rights=manifest.stagingReferenceRights?.binding,ref=manifest.references?.[0];
    fail(h(Buffer.from(r.approved_reference_manifest))===MANIFEST&&h(Buffer.from(r.job_product_snapshot))===SNAPSHOT
      &&manifest.references.length===1&&ref.sha256===REFERENCE&&rights.reference_sha256===REFERENCE
      &&rights.receipt_sha256===RECEIPT&&snapshot.trustedBrand?.value==="JJ GLOW","C4_PROVIDER_PREFLIGHT_FROZEN_METADATA");
    const s3=new S3Client({endpoint:process.env.R2_ENDPOINT,region:process.env.R2_REGION||"auto",
      credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},forcePathStyle:true});
    const [source,snap,receipt]=await Promise.all([ref.rel,ref.snapshotRel,rights.receipt_key].map(Key=>s3.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key}))));
    const [sourceBytes,snapBytes,receiptBytes]=await Promise.all([body(source.Body),body(snap.Body),body(receipt.Body)]);
    fail(h(sourceBytes)===REFERENCE&&h(snapBytes)===REFERENCE&&h(receiptBytes)===RECEIPT,"C4_PROVIDER_PREFLIGHT_R2_DIGEST");
    const contract={schema:"candidate4-provider-evidence-cross-row-freeze/v1",execution_task:EXECUTION_TASK,job_id:JOB,
      product_id:PRODUCT,subject_id:SUBJECT,script_id:SCRIPT,reference_sha256:REFERENCE,reference_manifest_sha256:MANIFEST,
      product_snapshot_sha256:SNAPSHOT,approved_script_sha256:SCRIPT_DIGEST,evidence_idempotency_key:r.idempotency_key,
      activation_sha:ACTIVATION,provider_runtime_sha:RUNTIME,database_binding_sha256:BINDING,model:r.model,resolution:r.resolution,
      duration_s:15,estimated_cost_usd:1.134,max_cost_usd:1.25,max_provider_posts:1,auto_retry:false,publication:false,
      required_independent_verdicts:["BRAND_FIDELITY","ANTI_SLOP","PROMPT_VERDICT_ARCHIVE"]};
    frozen={contract,contract_sha256:h(Buffer.from(canonical(contract))),job_state:r.state,reference_key:ref.rel,snapshot_key:ref.snapshotRel,
      rights_receipt_key:rights.receipt_key,lease_expires_at:r.lease_expires_at,authorization_created_at:r.auth_created_at};
    await c.query("ROLLBACK");
  }catch(error){await c.query("ROLLBACK").catch(()=>{});throw error}finally{c.release();await pool.end()}
  const q=new Queue(process.env.REDIS_QUEUE_NAME||"racun-jobs",{connection:{url:process.env.REDIS_URL,maxRetriesPerRequest:null}});
  const paused=await q.isPaused(),queue=await q.getJobCounts("waiting","active","delayed","prioritized","failed");await q.close();
  fail(paused&&Number(queue.active)===0,"C4_PROVIDER_PREFLIGHT_QUEUE_NOT_PAUSED");
  console.log(JSON.stringify({event:"CANDIDATE4_PROVIDER_PRECALL_FREEZE_PASS",runtime_sha:RUNTIME,transaction:"REPEATABLE READ READ ONLY",
    database_to_r2_reference_digest:"PASS",approved_script_digest:"PASS",cross_row_metadata:"PASS",active_evidence_lease:true,
    provider_post_count:0,provider_tasks:0,outputs:0,publication:false,queue_paused:true,queue_counts:queue,
    ...frozen,mutation:false,provider_post:false,secret_value_output:false}));
}
main().catch(e=>{console.error("CANDIDATE4_PROVIDER_PRECALL_FREEZE_FAIL",e.message);process.exit(1)});
