import crypto from "node:crypto";
import { MANAGED_STAGING_WORKER_SERVICE_ID } from "../staging-deterministic-worker";
import type { NormalEvidenceOfflineQcReceipt } from "../media/normal-evidence-offline-qc";

export const NORMAL_EVIDENCE_TASK = "NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829";
export const JJ_GLOW_FINAL_EVIDENCE_TASK = "P0-JJ-GLOW-FINAL-RECOVERY-CANDIDATE-20260831";
export const JJ_GLOW_FINAL_EVIDENCE_JOB_ID = "55284f20-efb8-4b18-8a24-f90fc91af733";
export const JJ_GLOW_FINAL_EVIDENCE_PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
export const JJ_GLOW_FINAL_EVIDENCE_USER_ID = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
export const JJ_GLOW_FINAL_EVIDENCE_REFERENCE_SHA256 = "744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1";
export const NORMAL_EVIDENCE_MODEL = "dreamina-seedance-2-0-mini-260615";
export const NORMAL_EVIDENCE_RESOLUTION = "720p";
export const NORMAL_EVIDENCE_FORMAT = "talking_head";
export const NORMAL_EVIDENCE_DURATION_S = 15;
export const NORMAL_EVIDENCE_WIDTH = 720;
export const NORMAL_EVIDENCE_HEIGHT = 1280;
export const NORMAL_EVIDENCE_FPS = 24;
export const NORMAL_EVIDENCE_ESTIMATED_TOKENS =
  NORMAL_EVIDENCE_DURATION_S * NORMAL_EVIDENCE_WIDTH * NORMAL_EVIDENCE_HEIGHT * NORMAL_EVIDENCE_FPS / 1024;
export const NORMAL_EVIDENCE_USD_PER_M_TOKENS = 3.5;
export const NORMAL_EVIDENCE_ESTIMATE_USD = Math.round(
  NORMAL_EVIDENCE_ESTIMATED_TOKENS / 1_000_000 * NORMAL_EVIDENCE_USD_PER_M_TOKENS * 1000
) / 1000;
export const NORMAL_EVIDENCE_MAX_USD = 1.25;
export const NORMAL_EVIDENCE_AUTHORIZATION_SOURCE = "approved_reference_manifest:v2";
export const NORMAL_EVIDENCE_STAGING_BUCKET = "bikinfyp-staging";

export function normalEvidenceActualCostUsd(completionTokens: number): number {
  if (!Number.isSafeInteger(completionTokens) || completionTokens <= 0) throw new Error("NORMAL_EVIDENCE_COMPLETION_TOKENS_INVALID");
  return Math.round(completionTokens / 1_000_000 * NORMAL_EVIDENCE_USD_PER_M_TOKENS * 1_000_000) / 1_000_000;
}

export interface NormalEvidenceContract {
  taskId: string;
  idempotencyKey: string;
  jobId: string;
  userId: string;
  productId: string;
  subjectId: string;
  referenceSha256: string;
  referenceManifestSha256: string;
  referenceBrand: string;
  authorizationSource: string;
  productSnapshotSha256: string;
  approvedScriptSha256: string | null;
  deploySha: string;
  model: string;
  category: string;
  format: string;
  resolution: string;
  durationS: number;
  estimatedCostUsd: number;
  maxCostUsd: number;
  providerPostCount: number;
  state: string;
  providerTaskId: string | null;
  payloadSha256: string | null;
}

export type PostClaim =
  | { action: "POST" }
  | { action: "POLL_ONLY"; taskId: string }
  | { action: "STOP_NO_RETRY" };

export interface NormalEvidenceCapture {
  taskId: string;
  artifactKey: string;
  artifactSha256: string;
  qc: NormalEvidenceOfflineQcReceipt;
  correlation: unknown;
}

export interface NormalEvidenceStore {
  get(jobId: string): Promise<NormalEvidenceContract | null>;
  claimPost(jobId: string, payloadSha256: string): Promise<PostClaim>;
  bindTask(jobId: string, payloadSha256: string, taskId: string): Promise<void>;
  recordProviderSuccess(jobId: string, input: { taskId: string; usage: unknown; actualCostUsd: number }): Promise<void>;
  captureNoPublication(jobId: string, input: NormalEvidenceCapture): Promise<void>;
  settleStopNoRetry(jobId: string): Promise<void>;
}

const NOOP: NormalEvidenceStore = {
  async get() { return null; },
  // A direct accidental call must never turn an absent durable row into spend.
  async claimPost() { return { action: "STOP_NO_RETRY" }; },
  async bindTask() { throw new Error("NORMAL_EVIDENCE_STORE_NOT_CONFIGURED"); },
  async recordProviderSuccess() { throw new Error("NORMAL_EVIDENCE_STORE_NOT_CONFIGURED"); },
  async captureNoPublication() { throw new Error("NORMAL_EVIDENCE_STORE_NOT_CONFIGURED"); },
  async settleStopNoRetry() { throw new Error("NORMAL_EVIDENCE_STORE_NOT_CONFIGURED"); },
};

let activeStore: NormalEvidenceStore = NOOP;
export function setNormalEvidenceStore(store?: NormalEvidenceStore) { activeStore = store ?? NOOP; }
export function normalEvidenceStore(): NormalEvidenceStore { return activeStore; }

/** Canonical worker bootstrap: rollback/dev SQLite must retain the NOOP store
 * and therefore cannot accidentally query PostgreSQL before provider choice. */
export function installNormalEvidenceStoreForRuntime(
  postgresEnabled: boolean,
  postgresStore: NormalEvidenceStore,
): void {
  setNormalEvidenceStore(postgresEnabled ? postgresStore : undefined);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function deterministicEvidenceDigest(value: unknown): string {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export function jjGlowApprovedScriptSha256(script: Record<string, unknown>, manualAudit: Record<string, unknown>): string {
  return deterministicEvidenceDigest({
    id:script.id,job_id:script.job_id,product_id:script.product_id,hook_family:script.hook_family,
    emotion:script.emotion,register:script.register,segments:script.segments,caption:script.caption,
    hashtags:script.hashtags,validation_result:script.validation_result,quality_tier:script.quality_tier,
    hook_level:script.hook_level,approved_by_user_at:script.approved_by_user_at,
    edited_by_user:Number(script.edited_by_user),created_at:script.created_at,
    manual_evidence_audit:manualAudit,
  });
}

export function expectedNormalEvidenceIdempotencyKey(contract: Pick<NormalEvidenceContract,
  "taskId" | "jobId" | "productId" | "subjectId" | "referenceSha256" | "referenceManifestSha256"
  | "productSnapshotSha256" | "approvedScriptSha256" | "deploySha" | "model" | "category" | "format" | "durationS" | "resolution">): string {
  const legacy = {
    taskId: contract.taskId,
    jobId: contract.jobId,
    productId: contract.productId,
    subjectId: contract.subjectId,
    referenceSha256: contract.referenceSha256,
    referenceManifestSha256: contract.referenceManifestSha256,
    productSnapshotSha256: contract.productSnapshotSha256,
    deploySha: contract.deploySha,
    model: contract.model,
    category: contract.category,
    format: contract.format,
    durationS: contract.durationS,
    resolution: contract.resolution,
  };
  // NULL means a pre-0044 ordinary contract. Omitting the key preserves its
  // byte-for-byte legacy idempotency digest and therefore safe crash resume.
  // The exact JJ contract requires a non-null digest at both SQL and runtime
  // gates, so its script binding is still part of the key.
  return deterministicEvidenceDigest(contract.approvedScriptSha256
    ? {...legacy,approvedScriptSha256:contract.approvedScriptSha256}
    : legacy);
}

const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

export function assertNormalEvidenceManagedRuntime(input: {
  runtime?: NodeJS.ProcessEnv;
  databaseUrl?: string;
  storageMode?: string;
  storageBucket?: string;
}) {
  const env = input.runtime ?? process.env;
  if (env.NODE_ENV !== "production" || env.RACUN_DEPLOY_ENV !== "staging") throw new Error("NORMAL_EVIDENCE_STAGING_ONLY");
  if (env.RENDER_SERVICE_ID !== MANAGED_STAGING_WORKER_SERVICE_ID) throw new Error("NORMAL_EVIDENCE_WRONG_MANAGED_WORKER");
  if (env.RACUN_DB_RUNTIME !== "postgres" || !/^postgres(?:ql)?:\/\//i.test(input.databaseUrl ?? "")) throw new Error("NORMAL_EVIDENCE_POSTGRES_RUNTIME_REQUIRED");
  if (input.storageMode !== "r2" || input.storageBucket !== NORMAL_EVIDENCE_STAGING_BUCKET) throw new Error("NORMAL_EVIDENCE_STAGING_STORAGE_MISMATCH");
  return env;
}

/** The sole hands-only exception is a reviewed, immutable staging candidate.
 * Keeping the identity predicate here prevents a generic hands-only job from
 * borrowing the single-POST evidence path. */
export function isJjGlowFinalEvidenceContract(contract: Pick<NormalEvidenceContract,
  "taskId" | "jobId" | "userId" | "productId" | "referenceSha256" | "format" | "category" | "durationS">): boolean {
  return contract.taskId === JJ_GLOW_FINAL_EVIDENCE_TASK
    && contract.jobId === JJ_GLOW_FINAL_EVIDENCE_JOB_ID
    && contract.userId === JJ_GLOW_FINAL_EVIDENCE_USER_ID
    && contract.productId === JJ_GLOW_FINAL_EVIDENCE_PRODUCT_ID
    && contract.referenceSha256 === JJ_GLOW_FINAL_EVIDENCE_REFERENCE_SHA256
    && contract.format === "hands_only" && contract.category === "beauty"
    && contract.durationS === NORMAL_EVIDENCE_DURATION_S;
}

/** Full preflight at the last boundary before any outbound provider request. */
export function assertNormalEvidenceProviderContract(contract: NormalEvidenceContract, input: {
  runtime?: NodeJS.ProcessEnv;
  databaseUrl?: string;
  storageMode?: string;
  storageBucket?: string;
  model: string;
  resolution: string;
  durationSec: number;
  shotCount: number;
  width?: number;
  height?: number;
  format?: string;
  category?: string;
  userId?: string;
  productId?: string;
  subjectId?: string | null;
  referenceManifestRaw?: string;
  productSnapshotRaw?: string;
  referenceImageSha256?: string;
  preferI2v?: boolean;
  hasExtraReferences?: boolean;
  visualSubjectPolicy?: string;
  approvedScriptSha256?: string;
  jobProviderVideo?: string | null;
  jobProviderVoice?: string | null;
  jobOutputUrl?: string | null;
}) {
  const env = assertNormalEvidenceManagedRuntime(input);
  const exactJjGlow = isJjGlowFinalEvidenceContract(contract);
  if (contract.taskId !== NORMAL_EVIDENCE_TASK && !exactJjGlow) throw new Error("NORMAL_EVIDENCE_TASK_MISMATCH");
  const runtimeSha = env.RENDER_GIT_COMMIT;
  if (!runtimeSha || runtimeSha !== contract.deploySha || !/^[0-9a-f]{40}$/.test(runtimeSha)) throw new Error("NORMAL_EVIDENCE_DEPLOY_SHA_MISMATCH");
  if (input.model !== contract.model || input.model !== NORMAL_EVIDENCE_MODEL) throw new Error("NORMAL_EVIDENCE_MODEL_MISMATCH");
  if (input.resolution !== contract.resolution || input.resolution !== NORMAL_EVIDENCE_RESOLUTION) throw new Error("NORMAL_EVIDENCE_RESOLUTION_MISMATCH");
  if (input.durationSec !== NORMAL_EVIDENCE_DURATION_S || contract.durationS !== NORMAL_EVIDENCE_DURATION_S || input.shotCount !== 1) throw new Error("NORMAL_EVIDENCE_REQUIRES_ONE_15S_SHOT");
  if ((input.width !== undefined && input.width !== NORMAL_EVIDENCE_WIDTH)
      || (input.height !== undefined && input.height !== NORMAL_EVIDENCE_HEIGHT)) throw new Error("NORMAL_EVIDENCE_DIMENSIONS_MISMATCH");
  const expectedFormat = exactJjGlow ? "hands_only" : NORMAL_EVIDENCE_FORMAT;
  if (contract.format !== expectedFormat || (input.format && input.format !== contract.format)) throw new Error("NORMAL_EVIDENCE_FORMAT_MISMATCH");
  if (!contract.category || (input.category && input.category !== contract.category)) throw new Error("NORMAL_EVIDENCE_CATEGORY_MISMATCH");
  if (input.userId && input.userId !== contract.userId) throw new Error("NORMAL_EVIDENCE_USER_MISMATCH");
  if (input.productId && input.productId !== contract.productId) throw new Error("NORMAL_EVIDENCE_PRODUCT_MISMATCH");
  if (input.subjectId !== undefined && input.subjectId !== contract.subjectId) throw new Error("NORMAL_EVIDENCE_SUBJECT_MISMATCH");
  if (contract.authorizationSource !== NORMAL_EVIDENCE_AUTHORIZATION_SOURCE) throw new Error("NORMAL_EVIDENCE_AUTHORIZATION_MISMATCH");
  if (exactJjGlow && (!contract.approvedScriptSha256 || !/^[0-9a-f]{64}$/.test(contract.approvedScriptSha256)
      || input.approvedScriptSha256 !== contract.approvedScriptSha256)) throw new Error("JJ_GLOW_EVIDENCE_SCRIPT_DIGEST_MISMATCH");
  if (exactJjGlow && (input.jobProviderVideo !== null || input.jobProviderVoice !== null || input.jobOutputUrl !== null)) {
    throw new Error("JJ_GLOW_EVIDENCE_PRIOR_JOB_EFFECT");
  }
  if (!contract.referenceBrand.trim()) throw new Error("NORMAL_EVIDENCE_BRAND_NOT_FROZEN");
  if (input.referenceManifestRaw && sha256(input.referenceManifestRaw) !== contract.referenceManifestSha256) throw new Error("NORMAL_EVIDENCE_REFERENCE_MANIFEST_MISMATCH");
  if (input.productSnapshotRaw && sha256(input.productSnapshotRaw) !== contract.productSnapshotSha256) throw new Error("NORMAL_EVIDENCE_PRODUCT_SNAPSHOT_MISMATCH");
  if (input.referenceImageSha256 !== undefined && input.referenceImageSha256 !== contract.referenceSha256) throw new Error("NORMAL_EVIDENCE_REFERENCE_BYTES_MISMATCH");
  if (input.preferI2v !== undefined && input.preferI2v !== true) throw new Error("NORMAL_EVIDENCE_APPROVED_REFERENCE_MUST_BE_FIRST_FRAME");
  if (input.hasExtraReferences || input.visualSubjectPolicy) throw new Error("NORMAL_EVIDENCE_EXTERNAL_OR_ALTERNATE_VISUAL_PATH_FORBIDDEN");
  if (contract.idempotencyKey !== expectedNormalEvidenceIdempotencyKey(contract)) throw new Error("NORMAL_EVIDENCE_IDEMPOTENCY_MISMATCH");
  if (contract.providerPostCount < 0 || contract.providerPostCount > 1) throw new Error("NORMAL_EVIDENCE_POST_COUNTER_INVALID");
  if (contract.estimatedCostUsd !== NORMAL_EVIDENCE_ESTIMATE_USD
      || contract.estimatedCostUsd > contract.maxCostUsd
      || contract.maxCostUsd !== NORMAL_EVIDENCE_MAX_USD) throw new Error("NORMAL_EVIDENCE_COST_GUARD_FAILED");
}
