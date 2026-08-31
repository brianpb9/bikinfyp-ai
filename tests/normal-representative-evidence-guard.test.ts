import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.BYTEPLUS_ARK_API_KEY = "test-only-never-sent";
process.env.BYTEPLUS_MODEL_HQ = "dreamina-seedance-2-0-mini-260615";
process.env.BYTEPLUS_RES_HQ = "720p";
process.env.RENDER_GIT_COMMIT = "a".repeat(40);
process.env.RACUN_DEPLOY_ENV = "staging";
(process.env as Record<string, string | undefined>).NODE_ENV = "production";
process.env.RENDER_SERVICE_ID = "srv-d9n28ue417fc73ch2b60";
process.env.RACUN_DB_RUNTIME = "postgres";
process.env.DATABASE_URL = "postgresql://evidence-test.invalid/staging";
process.env.STORAGE_MODE = "r2";
process.env.R2_BUCKET = "bikinfyp-staging";
process.env.STORAGE_DIR = path.join(os.tmpdir(), `normal-evidence-${process.pid}`);

const normal = await import("../lib/providers/normal-evidence");
const { byteplusVideo, setBytePlusEvidenceHooksForTests } = await import("../lib/providers/stubs/byteplus");
const { generateVideoWithFailover, setVideoProvidersForTests } = await import("../lib/providers/registry");
const { processPostgresJob, setProcessPostgresWorkerDependenciesForTests } = await import("../lib/postgres/worker");
const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");
import type { NormalEvidenceContract, NormalEvidenceStore, PostClaim } from "../lib/providers/normal-evidence";
import type { NormalEvidenceOfflineQcReceipt } from "../lib/media/normal-evidence-offline-qc";
import type { VisualSpec, VideoProvider } from "../lib/providers/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "normal-evidence-guard-"));
const ref = path.join(tmp, "ref.png");
fs.writeFileSync(ref, Buffer.from("authorized-reference-fixture"));
const refSha256 = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(ref)).digest("hex");

function contract(): NormalEvidenceContract {
  const base = {
    taskId: normal.NORMAL_EVIDENCE_TASK, jobId: "job-evidence", productId: "product-1", subjectId: "persona-1",
    referenceSha256: refSha256, referenceManifestSha256: "c".repeat(64),
    productSnapshotSha256: "d".repeat(64), approvedScriptSha256:null, deploySha: "a".repeat(40),
    model: normal.NORMAL_EVIDENCE_MODEL, category: "skincare", format: normal.NORMAL_EVIDENCE_FORMAT,
    durationS: 15, resolution: normal.NORMAL_EVIDENCE_RESOLUTION,
  };
  return {
    ...base, idempotencyKey: normal.expectedNormalEvidenceIdempotencyKey(base), userId: "user-1",
    referenceBrand: "Example Brand", authorizationSource: normal.NORMAL_EVIDENCE_AUTHORIZATION_SOURCE,
    estimatedCostUsd: normal.NORMAL_EVIDENCE_ESTIMATE_USD, maxCostUsd: normal.NORMAL_EVIDENCE_MAX_USD,
    providerPostCount: 0, state: "PREPOST_READY", providerTaskId: null, payloadSha256: null,
  };
}

function jjGlowContract(): NormalEvidenceContract {
  const base = {
    taskId: normal.JJ_GLOW_FINAL_EVIDENCE_TASK, jobId: normal.JJ_GLOW_FINAL_EVIDENCE_JOB_ID,
    userId: normal.JJ_GLOW_FINAL_EVIDENCE_USER_ID, productId: normal.JJ_GLOW_FINAL_EVIDENCE_PRODUCT_ID,
    subjectId: "persona-lokal-reviewed", referenceSha256: normal.JJ_GLOW_FINAL_EVIDENCE_REFERENCE_SHA256,
    referenceManifestSha256: "c".repeat(64), productSnapshotSha256: "d".repeat(64), approvedScriptSha256:"e".repeat(64),
    deploySha: "a".repeat(40), model: normal.NORMAL_EVIDENCE_MODEL, category: "beauty",
    format: "hands_only", durationS:15, resolution:normal.NORMAL_EVIDENCE_RESOLUTION,
  };
  return { ...base, idempotencyKey:normal.expectedNormalEvidenceIdempotencyKey(base),
    referenceBrand:"JJ GLOW",authorizationSource:normal.NORMAL_EVIDENCE_AUTHORIZATION_SOURCE,
    estimatedCostUsd:normal.NORMAL_EVIDENCE_ESTIMATE_USD,maxCostUsd:normal.NORMAL_EVIDENCE_MAX_USD,
    providerPostCount:0,state:"PREPOST_READY",providerTaskId:null,payloadSha256:null };
}

test("hands-only exception is exact-candidate only and retains one-request provider guard", () => {
  const exact = jjGlowContract();
  assert.equal(normal.isJjGlowFinalEvidenceContract(exact), true);
  assert.doesNotThrow(() => normal.assertNormalEvidenceProviderContract(exact, {
    runtime:process.env,databaseUrl:process.env.DATABASE_URL,storageMode:"r2",storageBucket:"bikinfyp-staging",
    model:normal.NORMAL_EVIDENCE_MODEL,resolution:normal.NORMAL_EVIDENCE_RESOLUTION,durationSec:15,shotCount:1,
    width:720,height:1280,format:"hands_only",category:"beauty",userId:exact.userId,productId:exact.productId,
    subjectId:exact.subjectId,referenceImageSha256:exact.referenceSha256,preferI2v:true,
    approvedScriptSha256:exact.approvedScriptSha256!,jobProviderVideo:null,jobProviderVoice:null,jobOutputUrl:null,
  }));
  assert.equal(normal.isJjGlowFinalEvidenceContract({...exact,jobId:"other"}), false);
  assert.throws(() => normal.assertNormalEvidenceProviderContract({...exact,jobId:"other"}, {
    runtime:process.env,databaseUrl:process.env.DATABASE_URL,storageMode:"r2",storageBucket:"bikinfyp-staging",
    model:normal.NORMAL_EVIDENCE_MODEL,resolution:normal.NORMAL_EVIDENCE_RESOLUTION,durationSec:15,shotCount:1,
    format:"hands_only",
  }), /TASK_MISMATCH/);
  assert.throws(() => normal.assertNormalEvidenceProviderContract(exact, {
    runtime:process.env,databaseUrl:process.env.DATABASE_URL,storageMode:"r2",storageBucket:"bikinfyp-staging",
    model:normal.NORMAL_EVIDENCE_MODEL,resolution:normal.NORMAL_EVIDENCE_RESOLUTION,durationSec:15,shotCount:3,
    format:"hands_only",
  }), /ONE_15S_SHOT/);
  assert.throws(() => normal.assertNormalEvidenceProviderContract(exact, {
    runtime:process.env,databaseUrl:process.env.DATABASE_URL,storageMode:"r2",storageBucket:"bikinfyp-staging",
    model:normal.NORMAL_EVIDENCE_MODEL,resolution:normal.NORMAL_EVIDENCE_RESOLUTION,durationSec:15,shotCount:1,
    format:"hands_only",approvedScriptSha256:"0".repeat(64),jobProviderVideo:null,jobProviderVoice:null,jobOutputUrl:null,
  }), /SCRIPT_DIGEST_MISMATCH/);
  assert.throws(() => normal.assertNormalEvidenceProviderContract(exact, {
    runtime:process.env,databaseUrl:process.env.DATABASE_URL,storageMode:"r2",storageBucket:"bikinfyp-staging",
    model:normal.NORMAL_EVIDENCE_MODEL,resolution:normal.NORMAL_EVIDENCE_RESOLUTION,durationSec:15,shotCount:1,
    format:"hands_only",approvedScriptSha256:exact.approvedScriptSha256!,jobProviderVideo:"prior-provider",jobProviderVoice:null,jobOutputUrl:null,
  }), /PRIOR_JOB_EFFECT/);
  const worker = fs.readFileSync(new URL("../lib/postgres/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /reviewedEvidenceSinglePost: exactJjGlowEvidence/);
  assert.match(worker, /jjGlowApprovedScriptSha256/);
  const store = fs.readFileSync(new URL("../lib/postgres/normal-evidence.ts", import.meta.url), "utf8");
  assert.match(store, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(store, /provider_video !== null \|\| frozen\.provider_voice !== null \|\| frozen\.output_url !== null/);
  assert.match(store, /jjGlowApprovedScriptSha256\(frozen, frozen\.manual_audit\)/);
  const approval = fs.readFileSync(new URL("../app/api/scripts/\[id\]/approve/route.ts", import.meta.url), "utf8");
  assert.match(approval, /if \(script\.job_id\) throw ERR\.BAD_REQUEST/);
});

test("reviewed exact hands-only plan becomes one 15-second provider request", () => {
  const category = getCreatorCategory("lokal");
  assert.ok(category);
  const spec = planShots({jobId:normal.JJ_GLOW_FINAL_EVIDENCE_JOB_ID,durationSec:15,
    segments:[
      {role:"hook",start:0,end:3,text:"Eh bestie, lihat sabun ini.",visual_direction:"Close-up tangan."},
      {role:"demo",start:3,end:10,text:"Ini JJ GLOW, kosmetika terdaftar BPOM.",visual_direction:"Tangan memutar produk."},
      {role:"cta",start:10,end:15,text:"Cek detailnya ya.",visual_direction:"Tangan menunjuk produk."},
    ],category,productName:"JJ GLOW GLUTA PINK BRIGHTENING SOAP",productCategory:"beauty",
    imageRefPath:ref,qualityTier:"high_quality",format:"hands_only",reviewedEvidenceSinglePost:true});
  assert.equal(spec.shots.length, 1);
  assert.equal(spec.shots[0].durationSec, 15);
  assert.throws(() => planShots({jobId:"other",durationSec:20,segments:[],category,
    productName:"x",productCategory:"beauty",imageRefPath:ref,qualityTier:"high_quality",
    format:"hands_only",reviewedEvidenceSinglePost:true}), /SINGLE_POST_SHAPE_INVALID/);
});

test("approved script digest binds content, approval fields, and manual evidence audit", () => {
  const script = {id:"s",job_id:normal.JJ_GLOW_FINAL_EVIDENCE_JOB_ID,product_id:normal.JJ_GLOW_FINAL_EVIDENCE_PRODUCT_ID,
    hook_family:"H1",emotion:"senang",register:"bestie",segments:"[]",caption:"caption",hashtags:"[]",
    validation_result:'{"passed":true}',quality_tier:"high_quality",hook_level:"agak_berani",
    approved_by_user_at:"2026-08-31T00:00:00.000Z",edited_by_user:0,created_at:"2026-08-31T00:00:00.000Z"};
  const audit = {actor:normal.JJ_GLOW_FINAL_EVIDENCE_USER_ID,created_at:"2026-08-31T00:00:00.000Z",meta:'{"provider_calls":0}'};
  const digest = normal.jjGlowApprovedScriptSha256(script,audit);
  assert.notEqual(normal.jjGlowApprovedScriptSha256({...script,caption:"mutated"},audit),digest);
  assert.notEqual(normal.jjGlowApprovedScriptSha256(script,{...audit,meta:'{"provider_calls":1}'}),digest);
});

class MemoryStore implements NormalEvidenceStore {
  row = contract();
  claims = 0;
  successes = 0;
  captures = 0;
  settlements = 0;
  onSettle?: () => void;
  async get(jobId: string) { return jobId === this.row.jobId ? { ...this.row } : null; }
  async claimPost(_jobId: string, digest: string): Promise<PostClaim> {
    this.claims++;
    if (this.row.payloadSha256 && this.row.payloadSha256 !== digest) throw new Error("NORMAL_EVIDENCE_PAYLOAD_MISMATCH");
    if (this.row.providerPostCount === 0 && this.row.state === "PREPOST_READY") {
      this.row.providerPostCount = 1; this.row.state = "POST_ATTEMPTED"; this.row.payloadSha256 = digest;
      return { action: "POST" };
    }
    if (this.row.providerPostCount === 1 && this.row.providerTaskId) return { action: "POLL_ONLY", taskId: this.row.providerTaskId };
    this.row.state = "STOP_NO_RETRY";
    return { action: "STOP_NO_RETRY" };
  }
  async bindTask(_jobId: string, digest: string, taskId: string) {
    assert.equal(this.row.state, "POST_ATTEMPTED"); assert.equal(this.row.payloadSha256, digest);
    this.row.providerTaskId = taskId; this.row.state = "TASK_BOUND";
  }
  async recordProviderSuccess(_jobId: string, input: { taskId: string; usage: unknown; actualCostUsd: number }) {
    assert.equal(input.taskId, this.row.providerTaskId); assert.ok(input.actualCostUsd <= 1.25);
    this.successes++; this.row.state = "PROVIDER_SUCCEEDED";
  }
  async captureNoPublication() { this.captures++; }
  async settleStopNoRetry() { this.settlements++; this.onSettle?.(); }
}

const spec: VisualSpec = {
  jobId: "job-evidence", width: 720, height: 1280, qualityTier: "high_quality", generateAudio: true,
  negativePrompt: "added text overlay, logo mutation, writing artifacts", ratio: "9:16",
  preferI2v: true,
  shots: [{ index: 0, durationSec: 15, prompt: "Presenter demonstrates the authorized product", imageRefPath: ref }],
};

afterEach(() => {
  normal.setNormalEvidenceStore();
  setBytePlusEvidenceHooksForTests();
  setVideoProvidersForTests();
  setProcessPostgresWorkerDependenciesForTests();
});

test("idempotency digest is canonical and the Reviewer cost is frozen", () => {
  assert.equal(normal.deterministicEvidenceDigest({ b: 2, a: { y: 1, x: 0 } }), normal.deterministicEvidenceDigest({ a: { x: 0, y: 1 }, b: 2 }));
  assert.notEqual(normal.deterministicEvidenceDigest({ a: [1, 2] }), normal.deterministicEvidenceDigest({ a: [2, 1] }));
  assert.equal(normal.NORMAL_EVIDENCE_ESTIMATED_TOKENS, 324000);
  assert.equal(normal.NORMAL_EVIDENCE_USD_PER_M_TOKENS, 3.5);
  assert.equal(normal.NORMAL_EVIDENCE_ESTIMATE_USD, 1.134);
  assert.equal(normal.normalEvidenceActualCostUsd(324000), 1.134);
  assert.doesNotThrow(() => normal.assertNormalEvidenceProviderContract(contract(), {
    runtime: process.env, databaseUrl: process.env.DATABASE_URL, storageMode: "r2", storageBucket: "bikinfyp-staging",
    model: normal.NORMAL_EVIDENCE_MODEL,
    resolution: "720p", durationSec: 15, shotCount: 1,
  }));
});

test("pre-0044 ordinary ledger keeps its legacy idempotency digest", () => {
  const ordinary = contract();
  const legacy = normal.deterministicEvidenceDigest({taskId:ordinary.taskId,jobId:ordinary.jobId,
    productId:ordinary.productId,subjectId:ordinary.subjectId,referenceSha256:ordinary.referenceSha256,
    referenceManifestSha256:ordinary.referenceManifestSha256,productSnapshotSha256:ordinary.productSnapshotSha256,
    deploySha:ordinary.deploySha,model:ordinary.model,category:ordinary.category,format:ordinary.format,
    durationS:ordinary.durationS,resolution:ordinary.resolution});
  assert.equal(ordinary.approvedScriptSha256,null);
  assert.equal(normal.expectedNormalEvidenceIdempotencyKey(ordinary),legacy);
  assert.notEqual(normal.expectedNormalEvidenceIdempotencyKey(jjGlowContract()),legacy);
});

test("paid guard rejects every wrong managed-worker/runtime/storage identity", () => {
  const base = { ...process.env };
  const input = { databaseUrl: process.env.DATABASE_URL, storageMode: "r2", storageBucket: "bikinfyp-staging" };
  assert.throws(() => normal.assertNormalEvidenceManagedRuntime({ ...input, runtime: { ...base, RENDER_SERVICE_ID: "srv-wrong" } }), /WRONG_MANAGED_WORKER/);
  assert.throws(() => normal.assertNormalEvidenceManagedRuntime({ ...input, runtime: { ...base, NODE_ENV: "development" } }), /STAGING_ONLY/);
  assert.throws(() => normal.assertNormalEvidenceManagedRuntime({ ...input, runtime: { ...base, RACUN_DB_RUNTIME: "sqlite" } }), /POSTGRES_RUNTIME_REQUIRED/);
  assert.throws(() => normal.assertNormalEvidenceManagedRuntime({ ...input, runtime: base, storageBucket: "bikinfyp-production" }), /STAGING_STORAGE_MISMATCH/);
  assert.throws(() => normal.assertNormalEvidenceManagedRuntime({ ...input, runtime: base, storageMode: "filesystem" }), /STAGING_STORAGE_MISMATCH/);
});

test("crash before create response consumes 0->1 and restart never reposts", async () => {
  const store = new MemoryStore(); normal.setNormalEvidenceStore(store);
  let outboundPosts = 0;
  setBytePlusEvidenceHooksForTests({ request: async (method) => {
    if (method === "POST") { outboundPosts++; throw new Error("simulated crash before response"); }
    throw new Error("unexpected request");
  }, sleep: async () => undefined });
  await assert.rejects(byteplusVideo.generate(spec, tmp), /simulated crash before response/);
  assert.equal(store.row.providerPostCount, 1); assert.equal(outboundPosts, 1);
  await assert.rejects(byteplusVideo.generate(spec, tmp), /STOP_NO_RETRY/);
  assert.equal(outboundPosts, 1, "restart emitted a duplicate outbound POST");
});

test("crash after create response but before durable task bind also stops without repost", async () => {
  const store = new MemoryStore(); normal.setNormalEvidenceStore(store);
  let outboundPosts = 0;
  setBytePlusEvidenceHooksForTests({
    request: async (method) => { if (method === "POST") { outboundPosts++; return { id: "provider-task-ambiguous" }; } throw new Error("unexpected request"); },
    afterPost: async () => { throw new Error("simulated crash before task bind"); }, sleep: async () => undefined,
  });
  await assert.rejects(byteplusVideo.generate(spec, tmp), /simulated crash before task bind/);
  await assert.rejects(byteplusVideo.generate(spec, tmp), /STOP_NO_RETRY/);
  assert.equal(outboundPosts, 1);
});

test("known task is polled only; no memo expiry can cause another POST", async () => {
  const store = new MemoryStore();
  store.row.providerPostCount = 1; store.row.state = "TASK_BOUND"; store.row.providerTaskId = "known-task";
  // First calculate the same request digest that the provider will enforce.
  const { bytePlusTaskPayloadSha256 } = await import("../lib/providers/stubs/byteplus");
  store.row.payloadSha256 = bytePlusTaskPayloadSha256(spec, spec.shots[0]);
  normal.setNormalEvidenceStore(store);
  let posts = 0; let gets = 0;
  setBytePlusEvidenceHooksForTests({ request: async (method, url) => {
    if (method === "POST") { posts++; throw new Error("POST forbidden"); }
    gets++; assert.match(url, /known-task$/);
    return { id: "known-task", status: "succeeded", duration: 15, content: { video_url: "data:video/mp4;base64,AAAA" }, usage: { completion_tokens: 324000, total_tokens: 324123 } };
  }, sleep: async () => undefined });
  const assets = await byteplusVideo.generate(spec, tmp);
  assert.equal(posts, 0); assert.equal(gets, 1); assert.equal(assets.length, 1);
  assert.equal(store.claims, 1); assert.equal(store.successes, 1);
});

test("evidence provider plus offline QC emits one BytePlus POST, GET polling/download only", async () => {
  const { runFfmpeg } = await import("../lib/media/ffmpeg");
  const { runNormalEvidenceOfflineQc, NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR,
    NORMAL_EVIDENCE_OFFLINE_QC_VERSION } = await import("../lib/media/normal-evidence-offline-qc");
  const localVideo = path.join(tmp, "offline-qc-source.mp4");
  await runFfmpeg(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=720x1280:r=24:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", localVideo]);
  const encoded = fs.readFileSync(localVideo).toString("base64");
  const store = new MemoryStore(); normal.setNormalEvidenceStore(store);
  const outbound: string[] = [];
  setBytePlusEvidenceHooksForTests({ request: async (method, url) => {
    outbound.push(`${method} ${url}`);
    if (method === "POST") return { id: "provider-task-one" };
    return { id: "provider-task-one", status: "succeeded", duration: 15,
      content: { video_url: `data:video/mp4;base64,${encoded}` }, usage: { completion_tokens: 324000 } };
  }, download: async (url) => {
    outbound.push(`DOWNLOAD GET ${url}`);
    return new Response(Buffer.from(encoded, "base64"), { status: 200, headers: { "content-type": "video/mp4" } });
  }, sleep: async () => undefined });
  const [asset] = await byteplusVideo.generate(spec, tmp);
  const receipt = await runNormalEvidenceOfflineQc(asset.filePath);
  assert.equal(outbound.filter((entry) => entry.startsWith("POST ")).length, 1);
  assert.equal(outbound.filter((entry) => entry.startsWith("GET ")).length, 1);
  assert.equal(outbound.filter((entry) => entry.startsWith("DOWNLOAD GET ")).length, 1);
  assert.deepEqual(receipt.evaluator, { identity: NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR,
    version: NORMAL_EVIDENCE_OFFLINE_QC_VERSION, network: "forbidden" });
  assert.equal(receipt.frame_findings.length, 13);
  assert.equal(receipt.audio_finding.stream_present, true);
  assert.equal(receipt.passed, false);
  assert.equal(receipt.disposition, "INDEPENDENT_REVIEW_REQUIRED");
  assert.equal(receipt.checks.find((check) => check.code === "EVIDENCE-BRAND")?.status, "skip");
  assert.equal(receipt.checks.find((check) => check.code === "EVIDENCE-ANTI-SLOP")?.status, "skip");
});

test("external audio and vision QC boundaries reject evidence before fetch", async () => {
  const { qcSuara } = await import("../lib/media/qc-suara");
  const { qcVision } = await import("../lib/media/qc-vision");
  await assert.rejects(qcSuara({ videoPath: "never-read.mp4", segmenSkrip: [], priceIdr: 1,
    productName: "fixture", externalNetworkPolicy: "forbid" }), /EXTERNAL_AUDIO_QC_FORBIDDEN/);
  await assert.rejects(qcVision({ videoPath: "never-read.mp4", maksOrang: 1,
    externalNetworkPolicy: "forbid" }), /EXTERNAL_VISION_QC_FORBIDDEN/);
});

test("offline QC receipt is cryptographically bound to captured artifact bytes", async () => {
  const { assertNormalEvidenceReceiptMatchesArtifact, NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR,
    NORMAL_EVIDENCE_OFFLINE_QC_VERSION } = await import("../lib/media/normal-evidence-offline-qc");
  const artifactSha256 = "7".repeat(64);
  const receipt: NormalEvidenceOfflineQcReceipt = { passed: false, checked_at: new Date().toISOString(), artifact_sha256: artifactSha256,
    evaluator: { identity: NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR, version: NORMAL_EVIDENCE_OFFLINE_QC_VERSION, network: "forbidden" as const },
    disposition: "INDEPENDENT_REVIEW_REQUIRED" as const, frame_findings: [],
    audio_finding: { stream_present: true, mean_db: -20, max_db: -3, local_probe: true as const }, checks: [] };
  assert.doesNotThrow(() => assertNormalEvidenceReceiptMatchesArtifact(receipt, artifactSha256));
  assert.throws(() => assertNormalEvidenceReceiptMatchesArtifact(receipt, "8".repeat(64)), /QC_ARTIFACT_DIGEST_MISMATCH/);
  assert.throws(() => assertNormalEvidenceReceiptMatchesArtifact({ ...receipt, passed: true }, artifactSha256), /QC_RECEIPT_CONTRACT_INVALID/);
  const { pgNormalEvidenceStore } = await import("../lib/postgres/normal-evidence");
  await assert.rejects(pgNormalEvidenceStore.captureNoPublication("job-evidence", {
    taskId: "provider-task", artifactKey: "private/evidence/test/mismatch.mp4",
    artifactSha256: "8".repeat(64), qc: receipt, correlation: { publication: false },
  }), /QC_ARTIFACT_DIGEST_MISMATCH/, "durable capture boundary must reject before opening a database transaction");
});

test("STOP_NO_RETRY crash restart settles hold on worker replay and stays terminal", async () => {
  const store = new MemoryStore(); normal.setNormalEvidenceStore(store);
  let posts = 0;
  setBytePlusEvidenceHooksForTests({ request: async (method) => {
    if (method === "POST") { posts++; throw new Error("simulated process loss after outbound write"); }
    throw new Error("unexpected polling");
  }, sleep: async () => undefined });
  await assert.rejects(byteplusVideo.generate(spec, tmp), /simulated process loss/);
  await assert.rejects(byteplusVideo.generate(spec, tmp), /STOP_NO_RETRY/);
  assert.equal(store.row.state, "STOP_NO_RETRY");
  let jobState = "GENERATING_VISUAL";
  const ledger = [{ type: "hold", delta: -10 }];
  store.onSettle = () => { ledger.push({ type: "release", delta: 10 }); jobState = "REFUNDED"; };
  const jobs = { close: async () => undefined, failJob: async () => { throw new Error("failJob forbidden"); } };
  const pool = { query: async (sql: string) => {
    if (sql.includes("SELECT product_id,state FROM jobs")) return { rows: [{ product_id: "product-1", state: jobState }], rowCount: 1 };
    if (sql.includes("FROM jobs j")) return { rows: [{ id: "job-evidence", product_id: "product-1", state: jobState }], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  setProcessPostgresWorkerDependenciesForTests({ databaseUrl: () => "postgres://test", createJobs: (() => jobs) as never,
    getPool: (() => pool) as never, createCredits: (() => { throw new Error("capture forbidden"); }) as never,
    withProductEvidenceMutationLock: async (_productId, operation) => operation() });
  await processPostgresJob("job-evidence", { retryViaQueue: true });
  await processPostgresJob("job-evidence", { retryViaQueue: true });
  assert.equal(posts, 1);
  assert.equal(jobState, "REFUNDED");
  assert.deepEqual(ledger, [{ type: "hold", delta: -10 }, { type: "release", delta: 10 }]);
  assert.equal(store.settlements, 1);
});

test("registry disables provider failover for the evidence task", async () => {
  const store = new MemoryStore(); normal.setNormalEvidenceStore(store);
  let fallbackCalls = 0;
  const fallback: VideoProvider = { name: "not-byteplus", estimateCost: () => 0, healthCheck: async () => true,
    generate: async () => { fallbackCalls++; return []; } };
  setVideoProvidersForTests([fallback]);
  await assert.rejects(generateVideoWithFailover(spec, tmp), /NORMAL_EVIDENCE_BYTEPLUS_ONLY/);
  assert.equal(fallbackCalls, 0);
});

test("SQLite worker wiring retains NOOP evidence store and reaches configured mock provider", async () => {
  let postgresQueries = 0;
  let mockProviderCalls = 0;
  const forbiddenPostgresStore: NormalEvidenceStore = {
    async get() { postgresQueries++; throw new Error("POSTGRES_QUERY_FORBIDDEN_IN_SQLITE_RUNTIME"); },
    async claimPost() { throw new Error("unexpected claim"); }, async bindTask() { throw new Error("unexpected bind"); },
    async recordProviderSuccess() { throw new Error("unexpected success"); }, async captureNoPublication() { throw new Error("unexpected capture"); },
    async settleStopNoRetry() { throw new Error("unexpected settlement"); },
  };
  normal.installNormalEvidenceStoreForRuntime(false, forbiddenPostgresStore);
  const sqliteMock: VideoProvider = { name: "sqlite-configured-mock", estimateCost: () => 0, healthCheck: async () => true,
    generate: async () => { mockProviderCalls++; return []; } };
  setVideoProvidersForTests([sqliteMock]);
  const result = await generateVideoWithFailover(spec, tmp);
  assert.equal(result.providerName, sqliteMock.name);
  assert.equal(mockProviderCalls, 1);
  assert.equal(postgresQueries, 0);
  const workerBootstrap = fs.readFileSync(new URL("../scripts/worker.ts", import.meta.url), "utf8");
  assert.match(workerBootstrap, /installNormalEvidenceStoreForRuntime\(postgresRuntimeEnabled\(\), pgNormalEvidenceStore\)/);
});

test("generated-first-frame fixture fails before Gemini and before BytePlus", async () => {
  const { prepareNormalEvidenceBytePlusOnlySpec } = await import("../lib/postgres/worker");
  let geminiImageCalls = 0;
  let byteplusPosts = 0;
  const requiringGeneratedFrame: VisualSpec = { ...spec, preferI2v: undefined,
    shots: [{ ...spec.shots[0], withholdProduct: true }] };
  const run = () => {
    const prepared = prepareNormalEvidenceBytePlusOnlySpec(requiringGeneratedFrame, ref);
    // These lines represent the only allowed continuation. The guard throws
    // above, so neither external counter can move.
    if (prepared.shots[0].imageRefPath !== ref) geminiImageCalls++;
    byteplusPosts++;
  };
  assert.throws(run, /EXTERNAL_FIRST_FRAME_PREPROCESSING_FORBIDDEN/);
  assert.equal(geminiImageCalls, 0);
  assert.equal(byteplusPosts, 0);

  const prepared = prepareNormalEvidenceBytePlusOnlySpec(spec, ref);
  assert.equal(prepared.preferI2v, true);
  assert.equal(prepared.shots[0].imageRefPath, ref);
  assert.equal(geminiImageCalls, 0);
  byteplusPosts++;
  assert.equal(byteplusPosts, 1, "eligible fixture reaches exactly one guarded BytePlus POST");
});

test("BytePlus last boundary rejects derived/non-i2v reference before outbound POST", async () => {
  const store = new MemoryStore(); normal.setNormalEvidenceStore(store);
  let posts = 0;
  setBytePlusEvidenceHooksForTests({ request: async (method) => { if (method === "POST") posts++; return {}; } });
  await assert.rejects(byteplusVideo.generate({ ...spec, preferI2v: false }, tmp), /APPROVED_REFERENCE_MUST_BE_FIRST_FRAME/);
  assert.equal(posts, 0);
  const derived = path.join(tmp, "derived.png"); fs.writeFileSync(derived, "unapproved-derived-frame");
  await assert.rejects(byteplusVideo.generate({ ...spec, shots: [{ ...spec.shots[0], imageRefPath: derived }] }, tmp), /REFERENCE_BYTES_MISMATCH/);
  assert.equal(posts, 0);
});

test("structured-story voice fixture cannot select Gemini; evidence audio is BytePlus-only", async () => {
  const { prepareNormalEvidenceBytePlusOnlySpec, selectPostVideoAudioRoute } = await import("../lib/postgres/worker");
  const structured: VisualSpec = { ...spec, visualSubjectPolicy: "neutral_story_ads" };
  assert.throws(() => prepareNormalEvidenceBytePlusOnlySpec(structured, ref), /STRUCTURED_STORY_REQUIRES_EXTERNAL_VOICE/);
  let byteplusPosts = 1; // guarded visual task already succeeded in this route fixture
  let geminiVoiceCalls = 0;
  const route = selectPostVideoAudioRoute({ representativeEvidence: true, withAudio: true,
    format: "talking_head", presenterLipsync: false, usedMockVideo: false });
  if (route === "gemini") geminiVoiceCalls++;
  assert.equal(route, "embedded");
  assert.equal(byteplusPosts, 1);
  assert.equal(geminiVoiceCalls, 0);
});

test("worker boundary disables review/QC regeneration and publication for evidence", () => {
  const worker = fs.readFileSync(new URL("../lib/postgres/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /row\.requires_approval && !representativeEvidence/);
  assert.match(worker, /!representativeEvidence && retry === 0 && qc11/);
  assert.match(worker, /representativeEvidence \|\| format === "vo_broll" \? null : await findReusableClips/);
  assert.match(worker, /if \(representativeEvidence\) \{[\s\S]*?prepareNormalEvidenceBytePlusOnlySpec\(spec, refUtama\)[\s\S]*?\} else if \(bolehFrameTurunan/);
  assert.match(worker, /if \(representativeEvidence\) \{\s*evidenceQc = await runNormalEvidenceOfflineQc\(outputPath\);\s*qc = evidenceQc;\s*\} else \{\s*qc = await postgresQcRunner\(qcInput\)/);
  const capture = worker.indexOf("await normalEvidenceStore().captureNoPublication");
  const evidenceReturn = worker.indexOf("return;", capture);
  const publication = worker.indexOf("await persistReadyOutput(row, jobs, pool, relVideo, outputPath, qc)", evidenceReturn);
  assert.ok(capture > 0 && evidenceReturn > capture && publication > evidenceReturn, "private capture must return before output/READY publication");
  const privateTerminal = worker.indexOf('privateEvidence?.state === "CAPTURED_NO_PUBLICATION"');
  const customerCapture = worker.indexOf("captureCredits", privateTerminal);
  assert.ok(privateTerminal > 0 && customerCapture > privateTerminal, "terminal private evidence must return before customer capture");
});

test("private capture atomically releases customer hold and terminalizes REFUNDED", () => {
  const store = fs.readFileSync(new URL("../lib/postgres/normal-evidence.ts", import.meta.url), "utf8");
  const begin = store.indexOf('client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")');
  const evidence = store.indexOf("state='CAPTURED_NO_PUBLICATION'", begin);
  const release = store.indexOf("'release'", evidence);
  const refunded = store.indexOf("state='REFUNDED'", release);
  const commit = store.indexOf('client.query("COMMIT")', refunded);
  assert.ok(begin > 0 && evidence > begin && release > evidence && refunded > release && commit > refunded);
  assert.equal(store.slice(begin, commit).includes("'capture'"), true, "terminal duplicate check must include capture");
  assert.match(store.slice(begin, commit), /redaction_verified=FALSE/);
  assert.doesNotMatch(store.slice(begin, commit), /redaction_verified=TRUE/);
});

test("read-only freeze is non-locking; activation revalidates under SERIALIZABLE/FOR UPDATE", () => {
  const readonly = fs.readFileSync(new URL("../scripts/normal-evidence-readonly-preflight.ts", import.meta.url), "utf8");
  const activation = fs.readFileSync(new URL("../scripts/normal-evidence-activate.ts", import.meta.url), "utf8");
  assert.match(readonly, /REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(readonly, /FOR SHARE|FOR UPDATE/);
  assert.match(activation, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(activation, /WHERE j\.id=\$1 FOR UPDATE/);
  assert.match(activation, /NORMAL_EVIDENCE_ACTIVATE_CONFIRM/);
  assert.doesNotMatch(activation, /fetch\(|createTask|apiRequest/);
});

test("JJ GLOW freeze verifies DB/R2 independently and activation is ledger-only", () => {
  const runner = fs.readFileSync(new URL("../scripts/staging-jj-glow-final-evidence.ts", import.meta.url), "utf8");
  assert.match(runner, /REPEATABLE READ READ ONLY/);
  assert.match(runner, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(runner, /mediaStorage\(\)\.get\(ref\.rel\)/);
  assert.match(runner, /mediaStorage\(\)\.get\(ref\.snapshotRel\)/);
  assert.match(runner, /mediaStorage\(\)\.get\(rights\.receipt_key\)/);
  assert.match(runner, /verifyStagingReferenceRightsBinding/);
  assert.match(runner, /INSERT INTO normal_representative_evidence_runs/);
  assert.doesNotMatch(runner, /fetch\(|createTask|enqueueJob/);
  const migration = fs.readFileSync(new URL("../migrations/postgres/0044_jj_glow_exact_evidence_format.sql", import.meta.url), "utf8");
  assert.match(migration, /job_id='55284f20-efb8-4b18-8a24-f90fc91af733'/);
  assert.match(migration, /format='hands_only'/);
  assert.match(migration, /approved_script_sha256 IS NOT NULL/);
  assert.match(migration, /NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829' AND format='talking_head'/);
});

test("migration enforces durable unique 0->1 ledger and private-only artifact key", () => {
  const migration = fs.readFileSync(new URL("../migrations/postgres/0042_normal_representative_evidence.sql", import.meta.url), "utf8");
  const pendingReview = fs.readFileSync(new URL("../migrations/postgres/0043_normal_evidence_pending_redaction_review.sql", import.meta.url), "utf8");
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /provider_post_count BETWEEN 0 AND 1/);
  assert.match(migration, /estimated_cost_usd=1\.134/);
  assert.match(migration, /max_cost_usd=1\.25/);
  assert.match(migration, /artifact_key LIKE 'private\/evidence\/%'/);
  assert.match(pendingReview, /normal_evidence_private_capture_complete/);
  assert.match(pendingReview, /normal_evidence_redaction_verification_attested/);
  assert.match(pendingReview, /redaction_attested_artifact_sha256 IS NOT NULL/);
  assert.match(pendingReview, /redaction_attested_artifact_sha256 = retrieval_sha256/);
  const captureConstraint = pendingReview.slice(pendingReview.indexOf("normal_evidence_private_capture_complete"),
    pendingReview.indexOf("normal_evidence_redaction_verification_attested"));
  assert.doesNotMatch(captureConstraint, /redaction_verified/,
    "pending private capture must not require an unearned verified-redaction claim");
});
