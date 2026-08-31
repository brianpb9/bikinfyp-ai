import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { periksaAdmisi } from "../lib/script-engine/admisi";
import { assertNoJjGlowFinalCandidateHistory, smokeCreateJob } from "../lib/postgres/smoke-runtime";
import {
  assertJjGlowLockedProductState, authorizeJjGlowExactAdmission, authorizeJjGlowLifecycleAuthority,
  assertJjGlowCandidate4PredecessorInvariant,
  assertJjGlowLifecycleActivationInvariant,
  jjGlowLifecycleStateSha256,
  JJ_GLOW_FINAL_RECOVERY_TASK, JJ_GLOW_CANDIDATE_4_TASK, JJ_GLOW_CANDIDATE_4_SCRIPT_ID,
  JJ_GLOW_LIFECYCLE_SCHEMA,
  JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256, JJ_GLOW_PRINCIPAL_ID,
  JJ_GLOW_PRODUCT_ID, JJ_GLOW_SCRIPT_ID, JJ_GLOW_STAGING_WEB_SERVICE_ID,
} from "../lib/staging-jj-glow-exact-admission";

const require = createRequire(import.meta.url);
const fixture = require("../scripts/staging-jj-glow-candidate.cjs") as {
  segments: Array<{ role:"hook"|"demo"|"story"|"cta";start:number;end:number;text:string;
    visual_direction:string;product_state?:"hidden"|"partial"|"hero" }>;
  admission: Record<string,unknown>;
  EXPECTED_PRODUCT_STATE: Record<string,unknown>;
  BPOM_EVIDENCE_PATH: string;
  BPOM_EVIDENCE_SHA256: string;
  assertExpectedProductState(product:Record<string,unknown>):void;
  validateBpomEvidence(bytes:Buffer|null,nowMs?:number):Record<string,unknown>;
  lifecycleMutationReceipt(action:string,actor:string,reason:string,correlationId:string):Record<string,unknown>;
};

function productRow(state = fixture.EXPECTED_PRODUCT_STATE):Record<string,unknown> {
  const { brand, staging_reference_rights, images, ...row } = structuredClone(state);
  return { ...row, images: JSON.stringify(images), raw_meta: JSON.stringify({ brand, staging_reference_rights }) };
}

test("naskah manual JJ GLOW melewati gerbang admisi tanpa klaim tak terverifikasi", () => {
  const result = periksaAdmisi({
    segments: fixture.segments,
    snapshot: fixture.admission,
    hookFamily: "H1",
    register: "bestie",
    productName: "JJ GLOW GLUTA PINK BRIGHTENING SOAP",
    productPriceIdr: 1,
    productSourceUrl: null,
    qualityTier: "high_quality",
    format: "hands_only",
  });
  assert.equal(result.passed, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  const spoken = fixture.segments.map((segment) => segment.text).join(" ");
  assert.doesNotMatch(spoken, /mencerahkan|memutihkan|glowing|mengobati|menyembuhkan|10x/i);
  assert.match(spoken, /terdaftar BPOM/i);
});

test("candidate terikat ke digest seluruh state produk dan C5", () => {
  assert.doesNotThrow(() => fixture.assertExpectedProductState(productRow()));
  for (const field of Object.keys(fixture.EXPECTED_PRODUCT_STATE)) {
    const changed = structuredClone(fixture.EXPECTED_PRODUCT_STATE);
    if (field === "brand") changed[field] = "MEREK LAIN";
    else if (typeof changed[field] === "number") changed[field] = Number(changed[field]) + 1;
    else if (changed[field] === null && ["promo_price_before_idr", "promo_stock_left"].includes(field)) changed[field] = 1;
    else if (changed[field] === null) changed[field] = "MUTATED";
    else changed[field] = `${String(changed[field])}-MUTATED`;
    let rejected = false;
    try { fixture.assertExpectedProductState(productRow(changed)); } catch { rejected = true; }
    assert.equal(rejected, true, field);
  }
});

test("precondition exact-state dijalankan pada row admission terkunci", () => {
  const row = productRow();
  assert.doesNotThrow(() => assertJjGlowLockedProductState(row, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256));
  for (const field of Object.keys(fixture.EXPECTED_PRODUCT_STATE)) {
    const changed = structuredClone(fixture.EXPECTED_PRODUCT_STATE);
    if (field === "brand") changed[field] = "MEREK LAIN";
    else if (typeof changed[field] === "number") changed[field] = Number(changed[field]) + 1;
    else if (changed[field] === null && ["promo_price_before_idr", "promo_stock_left"].includes(field)) changed[field] = 1;
    else if (changed[field] === null) changed[field] = "MUTATED";
    else changed[field] = `${String(changed[field])}-MUTATED`;
    let rejected = false;
    try { assertJjGlowLockedProductState(productRow(changed), JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256); }
    catch { rejected = true; }
    assert.equal(rejected, true, field);
  }
  const source = fs.readFileSync("lib/postgres/smoke-runtime.ts", "utf8");
  const lock = source.indexOf("FROM products WHERE id=$1 AND user_id=$2 FOR SHARE");
  const exact = source.indexOf("assertJjGlowLockedProductState", lock);
  const snapshot = source.indexOf("createJobProductSnapshotRaw", exact);
  const insert = source.indexOf("INSERT INTO jobs", snapshot);
  assert.ok(lock >= 0 && exact > lock && snapshot > exact && insert > snapshot,
    "exact-state harus diperiksa setelah row lock dan sebelum snapshot/job/hold");
});

test("precondition exact-state hanya tersedia untuk fixture dan web staging exact", () => {
  const intent = { expectedSha256: JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256, userId: JJ_GLOW_PRINCIPAL_ID,
    productId: JJ_GLOW_PRODUCT_ID, scriptId: JJ_GLOW_SCRIPT_ID };
  const runtime = { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging", RENDER_SERVICE_ID: JJ_GLOW_STAGING_WEB_SERVICE_ID } as NodeJS.ProcessEnv;
  assert.equal(authorizeJjGlowExactAdmission(intent, runtime), JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, expectedSha256: undefined }, runtime), /DIGEST_REQUIRED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, expectedSha256: null }, runtime), /DIGEST_REQUIRED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, expectedSha256: "" }, runtime), /DIGEST_REQUIRED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, expectedSha256: { sha: JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256 } }, runtime), /DIGEST_REQUIRED/);
  assert.equal(authorizeJjGlowExactAdmission({ ...intent, expectedSha256: undefined, productId: "unrelated" }, runtime), null);
  assert.throws(() => authorizeJjGlowExactAdmission(intent, { ...runtime, RACUN_DEPLOY_ENV: "production" }), /UNAUTHORIZED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, userId: "other" }, runtime), /UNAUTHORIZED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, expectedSha256: "0".repeat(64) }, runtime), /DIGEST_REQUIRED/);
});

test("runner memakai OTP acak singkat dan mengirim digest admission", () => {
  const source = fs.readFileSync("scripts/staging-jj-glow-candidate.cjs", "utf8");
  assert.match(source, /crypto\.randomInt\(0, 1_000_000\)/);
  assert.match(source, /otpNow\.getTime\(\) \+ 60_000/);
  assert.match(source, /DELETE FROM otp_codes WHERE id=\$1/);
  assert.match(source, /expected_product_state_sha256: EXPECTED_PRODUCT_STATE_SHA256/);
  assert.match(source, /expected_database_binding_sha256: databaseBinding\.sha256/);
  assert.match(source, /lifecycle_authority:lifecycleAuthority/);
  assert.match(source, /JJ_GLOW_READBACK_MODE === "post-exit"/);
  assert.match(source, /candidate\.lifecycle\.deleted/);
  assert.match(source, /SELECT id FROM jobs WHERE script_id=\$1"[\s\S]*SELECT id,job_id FROM scripts WHERE id=\$1 FOR UPDATE/);
  assert.match(source, /SELECT id FROM jobs WHERE script_id=\$1 FOR UPDATE/);
  assert.match(source, /DELETE FROM scripts WHERE id=\$1 AND job_id IS NULL RETURNING id/);
  assert.match(source, /deleted\.rowCount !== 1/);
  assert.doesNotMatch(source, /SELECT id FROM jobs WHERE script_id=\$1"[^\n]*\.catch/);
  for (const query of [
    "FROM outputs o WHERE o.job_id=j.id",
    "FROM fyp_snapshots f WHERE f.job_id=j.id AND f.posted_url IS NOT NULL",
    "FROM post_plans pp WHERE pp.job_id=j.id",
    "FROM normal_representative_evidence_runs n WHERE n.job_id=j.id",
  ]) assert.equal(source.split(query).length - 1, 2, `${query} wajib diperiksa same-process dan post-exit`);
  assert.match(source, /final\.output_count !== 0[\s\S]*final\.provider_post_count !== 0/);
  assert.match(source, /item\.output_count\) !== 0[\s\S]*item\.provider_post_count\) !== 0/);
  assert.match(source, /JJ_GLOW_CANONICAL_CREATE_AUTHORITY_REQUIRED/);
  assert.match(source, /JJ_GLOW_CANDIDATE_4_AUTHORITY_REQUIRED/);
  assert.match(source, /candidate #4 historical preflight invariant mismatch/);
  assert.match(source, /JJ_GLOW_BOOTSTRAP_PASS/);
  assert.doesNotMatch(source, /const OTP\s*=|10 \* 60_000/);
});

test("final recovery lifecycle authority exact dan mutation receipt butuh actor+reason", () => {
  const authority = {
    schema:JJ_GLOW_LIFECYCLE_SCHEMA,task:JJ_GLOW_FINAL_RECOVERY_TASK,
    correlation_id:"11111111-1111-4111-8111-111111111111",historical_root_cause_waiver:true,
    final_candidate_ordinal:3,max_canonical_candidates_created:3,provider_posts_at_admission:0,
    mutation_policy:{delete_requires_reason_actor:true,supersede_requires_reason_actor:true},
  } as const;
  assert.deepEqual(authorizeJjGlowLifecycleAuthority(authority, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256), authority);
  const candidate4 = {...authority,task:JJ_GLOW_CANDIDATE_4_TASK,
    final_candidate_ordinal:4,max_canonical_candidates_created:4} as const;
  assert.deepEqual(authorizeJjGlowLifecycleAuthority(candidate4, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256), candidate4);
  assert.throws(() => authorizeJjGlowLifecycleAuthority({...authority,final_candidate_ordinal:4}, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256), /INVALID/);
  assert.throws(() => authorizeJjGlowLifecycleAuthority({...candidate4,max_canonical_candidates_created:3}, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256), /INVALID/);
  assert.throws(() => authorizeJjGlowLifecycleAuthority(authority, null), /UNAUTHORIZED/);
  assert.equal(fixture.lifecycleMutationReceipt("delete", JJ_GLOW_PRINCIPAL_ID,
    "admission failed permanently", authority.correlation_id).actor, JJ_GLOW_PRINCIPAL_ID);
  assert.throws(() => fixture.lifecycleMutationReceipt("supersede", "anonymous", "short", authority.correlation_id), /INVALID/);
});

test("candidate #4 memakai tuple staging exact dan script id khusus", () => {
  const runtime = {NODE_ENV:"production",RACUN_DEPLOY_ENV:"staging",
    RENDER_SERVICE_ID:JJ_GLOW_STAGING_WEB_SERVICE_ID} as NodeJS.ProcessEnv;
  assert.equal(authorizeJjGlowExactAdmission({expectedSha256:JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256,
    userId:JJ_GLOW_PRINCIPAL_ID,productId:JJ_GLOW_PRODUCT_ID,scriptId:JJ_GLOW_CANDIDATE_4_SCRIPT_ID},runtime),
  JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256);
});

test("final recovery menolak job terminal maupun lifecycle delete history", async () => {
  const queryable = (history:{prior_job:boolean;prior_script_pointer:boolean;prior_lifecycle:boolean}) => ({
    query: async () => ({ rows:[history], rowCount:1 }),
  }) as never;
  await assert.doesNotReject(() => assertNoJjGlowFinalCandidateHistory(queryable({
    prior_job:false,prior_script_pointer:false,prior_lifecycle:false,
  }), JJ_GLOW_PRODUCT_ID, JJ_GLOW_SCRIPT_ID));
  await assert.rejects(() => assertNoJjGlowFinalCandidateHistory(queryable({
    prior_job:true,prior_script_pointer:false,prior_lifecycle:false,
  }), JJ_GLOW_PRODUCT_ID, JJ_GLOW_SCRIPT_ID), /HISTORY_EXISTS/, "terminal job history must block #4");
  await assert.rejects(() => assertNoJjGlowFinalCandidateHistory(queryable({
    prior_job:false,prior_script_pointer:false,prior_lifecycle:true,
  }), JJ_GLOW_PRODUCT_ID, JJ_GLOW_SCRIPT_ID), /HISTORY_EXISTS/, "deleted lifecycle history must block #4");
});

test("smokeCreateJob candidate #4 meneruskan authority dan menerima tepat satu predecessor refunded", async () => {
  const authority = {
    schema:JJ_GLOW_LIFECYCLE_SCHEMA,task:JJ_GLOW_CANDIDATE_4_TASK,
    correlation_id:"550e8400-e29b-41d4-a716-446655440000",historical_root_cause_waiver:true,
    provider_posts_at_admission:0,mutation_policy:{delete_requires_reason_actor:true,supersede_requires_reason_actor:true},
    final_candidate_ordinal:4,max_canonical_candidates_created:4,
  } as const;
  const queryable = (history:{product_job_count:number;valid_predecessor_count:number;candidate_job_count:number;
    prior_script_pointer:boolean;prior_lifecycle:boolean}) => ({
    query: async () => ({ rows:[history], rowCount:1 }),
  }) as never;
  const exact = {product_job_count:1,valid_predecessor_count:1,candidate_job_count:0,
    prior_script_pointer:false,prior_lifecycle:false};
  assert.match(smokeCreateJob.toString(),
    /assertNoJjGlowFinalCandidateHistory\(client,\s*input\.productId,\s*input\.scriptId,\s*lifecycleAuthority\)/,
    "canonical admission must pass the reviewed 4/4 authority into its history guard");
  await assert.doesNotReject(() => assertNoJjGlowFinalCandidateHistory(
    queryable(exact), JJ_GLOW_PRODUCT_ID, JJ_GLOW_CANDIDATE_4_SCRIPT_ID, authority));
  await assert.rejects(() => assertNoJjGlowFinalCandidateHistory(
    queryable({...exact,valid_predecessor_count:0}), JJ_GLOW_PRODUCT_ID, JJ_GLOW_CANDIDATE_4_SCRIPT_ID, authority),
  /CANDIDATE_4_HISTORY_INVALID/);
  await assert.rejects(() => assertNoJjGlowFinalCandidateHistory(
    queryable({...exact,product_job_count:2}), JJ_GLOW_PRODUCT_ID, JJ_GLOW_CANDIDATE_4_SCRIPT_ID, authority),
  /CANDIDATE_4_HISTORY_INVALID/);
});

test("candidate #4 final evidence requires its exact post-creation database binding", () => {
  const freeze = fs.readFileSync("scripts/staging-jj-glow-final-evidence.ts", "utf8");
  assert.match(freeze,
    /CANDIDATE_4_MODE\s*\?\s*process\.env\.JJ_GLOW_EXPECTED_DATABASE_BINDING_SHA256\?\.trim\(\)/,
    "candidate #4 must not reuse the predecessor's historical database binding");
  assert.match(freeze,
    /database_binding_sha256:EVIDENCE_DATABASE_BINDING_SHA256/,
    "lifecycle reconstruction must use the independently read-back exact binding");
  assert.match(freeze,
    /binding\.sha256 !== EVIDENCE_DATABASE_BINDING_SHA256/,
    "live freeze connection must match that exact binding");
});

test("candidate #4 activation rejects every predecessor terminal/effect mutation", () => {
  const exact = {
    id:"55284f20-efb8-4b18-8a24-f90fc91af733",product_id:JJ_GLOW_PRODUCT_ID,script_id:JJ_GLOW_SCRIPT_ID,
    state:"REFUNDED",provider_video:null,provider_voice:null,output_url:null,provider_task_count:0,
    provider_post_count:0,output_count:0,fyp_posted_count:0,post_plan_count:0,hold_count:1,release_count:1,capture_count:0,
  };
  assert.doesNotThrow(() => assertJjGlowCandidate4PredecessorInvariant(exact));
  const mutations: Array<[keyof typeof exact, unknown]> = [
    ["id","wrong"],["product_id","wrong"],["script_id","wrong"],
    ["state","READY"],["provider_video","byteplus"],["provider_voice","byteplus"],["output_url","private/x.mp4"],
    ["provider_task_count",1],["provider_post_count",1],["output_count",1],["fyp_posted_count",1],
    ["post_plan_count",1],["hold_count",2],["release_count",0],["capture_count",1],
  ];
  for (const [field,value] of mutations) {
    assert.throws(() => assertJjGlowCandidate4PredecessorInvariant({...exact,[field]:value}),
      /CANDIDATE_4_PREDECESSOR_CHANGED/, `must reject predecessor mutation ${field}`);
  }
});

test("candidate #4 activation locks and rejects every lifecycle authority mutation", () => {
  const stateSha256 = "a".repeat(64);
  const createdAt = "2026-08-31T19:47:54.433Z";
  const state = {proof:"fixture"};
  const exact = {
    schema:JJ_GLOW_LIFECYCLE_SCHEMA,task:JJ_GLOW_CANDIDATE_4_TASK,
    correlation_id:"84e77d2f-6da7-4bb3-a56f-a59aa25cea5a",historical_root_cause_waiver:true,
    final_candidate_ordinal:4,max_canonical_candidates_created:4,provider_posts_at_admission:0,
    mutation_policy:{delete_requires_reason_actor:true,supersede_requires_reason_actor:true},
    create_actor:JJ_GLOW_PRINCIPAL_ID,create_timestamp:createdAt,
    transaction_commit_receipt:{transaction_id:"134621",atomic_with_job:true,visible_only_after_commit:true},
    post_commit_state:state,post_commit_state_sha256:stateSha256,append_only:true,
  };
  // Isolate authority-field validation from the independently covered state digest check.
  const validStateSha = jjGlowLifecycleStateSha256(state);
  exact.post_commit_state_sha256 = validStateSha;
  const input = {row:{actor:JJ_GLOW_PRINCIPAL_ID,created_at:createdAt,meta:JSON.stringify(exact)},
    task:JJ_GLOW_CANDIDATE_4_TASK,correlationId:exact.correlation_id,stateSha256:validStateSha} as const;
  assert.doesNotThrow(() => assertJjGlowLifecycleActivationInvariant(input));
  const mutations: Array<(value:typeof exact) => void> = [
    (v) => { v.schema="wrong" as typeof v.schema; }, (v) => { v.task=JJ_GLOW_FINAL_RECOVERY_TASK; },
    (v) => { v.correlation_id="wrong"; }, (v) => { v.historical_root_cause_waiver=false; },
    (v) => { v.final_candidate_ordinal=3; }, (v) => { v.max_canonical_candidates_created=3; },
    (v) => { v.provider_posts_at_admission=1; },
    (v) => { v.mutation_policy.delete_requires_reason_actor=false; },
    (v) => { v.mutation_policy.supersede_requires_reason_actor=false; },
    (v) => { v.create_actor="wrong"; }, (v) => { v.create_timestamp="2026-08-31T19:47:55.433Z"; },
    (v) => { v.transaction_commit_receipt.transaction_id=""; },
    (v) => { v.transaction_commit_receipt.atomic_with_job=false; },
    (v) => { v.transaction_commit_receipt.visible_only_after_commit=false; },
    (v) => { v.append_only=false; }, (v) => { v.post_commit_state_sha256="b".repeat(64); },
    (v) => { v.post_commit_state={proof:"mutated"}; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(exact); mutate(changed);
    assert.throws(() => assertJjGlowLifecycleActivationInvariant({...input,row:{...input.row,meta:JSON.stringify(changed)}}),
      /LIFECYCLE_MISMATCH/);
  }
  assert.throws(() => assertJjGlowLifecycleActivationInvariant({...input,row:{...input.row,actor:"wrong"}}), /LIFECYCLE_MISMATCH/);
  assert.throws(() => assertJjGlowLifecycleActivationInvariant({...input,row:{...input.row,created_at:"2026-08-31T19:47:55.433Z"}}), /LIFECYCLE_MISMATCH/);
  const freeze = fs.readFileSync("scripts/staging-jj-glow-final-evidence.ts", "utf8");
  assert.match(freeze, /candidate\.lifecycle\.created'\$\{suffix\}/,
    "activation must apply FOR UPDATE to the exact lifecycle audit row");
});

test("binding DB diperiksa pada client transaksi yang sama dan probe runtime dibundel", () => {
  const admission = fs.readFileSync("lib/postgres/smoke-runtime.ts", "utf8");
  const begin = admission.indexOf('client.query("BEGIN ISOLATION LEVEL READ COMMITTED")');
  const binding = admission.indexOf("postgresRuntimeBinding(client)", begin);
  const firstLock = admission.indexOf('client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE"', binding);
  assert.ok(begin >= 0 && binding > begin && firstLock > binding,
    "setiap attempt harus attest backend pada client setelah BEGIN sebelum admission writes");
  assert.doesNotMatch(admission.slice(0, begin), /postgresRuntimeBinding\(pool\)/);

  const runner = fs.readFileSync("scripts/staging-jj-glow-candidate.cjs", "utf8");
  const runnerBegin = runner.indexOf('client.query("BEGIN")');
  const runnerBinding = runner.indexOf("postgresRuntimeBinding(client)", runnerBegin);
  const runnerInsert = runner.indexOf("INSERT INTO scripts", runnerBinding);
  assert.ok(runnerBegin >= 0 && runnerBinding > runnerBegin && runnerInsert > runnerBinding);

  const dockerfile = fs.readFileSync("Dockerfile.web", "utf8");
  assert.match(dockerfile, /esbuild scripts\/staging-candidate-durability-probe\.ts/);
  assert.match(dockerfile, /node --check \/srv\/app\/scripts\/staging-candidate-durability-probe\.cjs/);
  assert.match(dockerfile, /staging-candidate-durability-probe\.cjs self-check \| grep -qx DURABILITY_PROBE_RUNTIME_SELF_CHECK_PASS/);
  assert.doesNotMatch(dockerfile, /tsx scripts\/staging-candidate-durability-probe/);

  const probe = fs.readFileSync("scripts/staging-candidate-durability-probe.ts", "utf8");
  assert.match(probe, /expectedDatabaseBindingSha256:binding\.sha256/);
  assert.match(probe, /\$4::text,[\s\S]*\$4::timestamptz/,
    "fixture timestamp must be explicitly typed across legacy TEXT and TIMESTAMPTZ columns");
  assert.match(probe, /catch \(error\) \{\s*try \{ await cleanupFixture\(\); \}/);
  assert.match(probe, /DELETE FROM jobs WHERE user_id=\$1 AND product_id=\$2 AND script_id=\$3/);
});

test("claim BPOM membutuhkan evidence authoritative exact, belum stale", () => {
  const bytes = fs.readFileSync(fixture.BPOM_EVIDENCE_PATH);
  const evidence = fixture.validateBpomEvidence(bytes, Date.parse("2026-08-31T00:00:00.000Z"));
  assert.equal(evidence.evidence_id, "BPOM-KO-NA18260500350-20260831");
  assert.equal(fixture.BPOM_EVIDENCE_SHA256, "55bb83ce881ed1b01ed0cd829edb6f7234012af1347a95edf8e29c04b36330d0");
  assert.throws(() => fixture.validateBpomEvidence(null), /missing/);
  assert.throws(() => fixture.validateBpomEvidence(bytes, Date.parse("2026-09-03T00:00:00.000Z")), /stale/);
  const mismatched = Buffer.from(bytes);
  mismatched[mismatched.length - 2] ^= 1;
  assert.throws(() => fixture.validateBpomEvidence(mismatched), /digest mismatch/);
});
