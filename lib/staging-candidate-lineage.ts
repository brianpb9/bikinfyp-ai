import crypto from "node:crypto";
import { canonicalReferenceRightsJson, referenceRightsSha256 } from "./staging-reference-rights";
import {
  JJ_GLOW_FINAL_RECOVERY_TASK, JJ_GLOW_LIFECYCLE_SCHEMA, jjGlowLifecycleStateSha256,
} from "./staging-jj-glow-exact-admission";

export const JJ_LINEAGE_TASK = "P0-JJ-GLOW-CANDIDATE-CLOSURE-20260831-R12";
export const JJ_LINEAGE_HEADER = "x-racun-staging-lineage-read";
export const JJ_LINEAGE_TTL_MS = 5 * 60_000;
export const JJ_LINEAGE_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
export const JJ_PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
export const JJ_SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
export const JJ_PRINCIPAL_ID = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
export const JJ_REFERENCE_SHA = "744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1";
export const JJ_RIGHTS_RECEIPT_SHA = "ca3906a381e6d299bc46fe62aeefbc3bd9b4183a6ff59c4f3cde2ca8f94788c3";
export const JJ_RIGHTS_SCOPE = "internal_staging_ai_and_derivatives_only";
export const JJ_PRODUCT_SNAPSHOT_SHA = "674b9dc532404087544e4f0a95c56d7a0e077388ce78aab9827f92c2a2df73d6";

type CandidateRow = Record<string, unknown> & {
  id: string;
  persona_id: string;
  product_id: string;
  script_id: string;
  state: string;
  creator_category: string;
  provider_video: string | null;
  provider_voice: string | null;
  output_url: string | null;
  provider_task_count: number;
  hold_count: number;
  hold_delta: number;
  terminal_ledger_count: number;
  job_ledger_net: number;
  database_name: string;
  database_principal: string;
  database_server_address: string;
  database_server_port: number;
  product_job_count: number;
  product_script_count: number;
  lifecycle_receipt_count: number;
  lifecycle_actor: string;
  lifecycle_meta: string | Record<string, unknown>;
  approved_reference_manifest: string | Record<string, unknown>;
  job_product_snapshot: string | Record<string, unknown>;
  images: string | string[];
  raw_meta: string | Record<string, unknown>;
};

const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
const bytesFor = (value: unknown) => Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`);
const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const parsed = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

function signature(secret: string, sha: string, expiresAtMs: number, nonce: string): string {
  return crypto.createHmac("sha256", secret)
    .update(JSON.stringify({ task: JJ_LINEAGE_TASK, sha, expiresAtMs, nonce }))
    .digest("hex");
}

export function stagingCandidateLineageHeader(
  secret: string,
  sha: string,
  options: { nowMs?: number; nonce?: string } = {},
): string {
  const expiresAtMs = (options.nowMs ?? Date.now()) + JJ_LINEAGE_TTL_MS;
  const nonce = options.nonce ?? crypto.randomBytes(16).toString("hex");
  return `${JJ_LINEAGE_TASK}:${sha}:${expiresAtMs}:${nonce}:${signature(secret, sha, expiresAtMs, nonce)}`;
}

export function authorizedStagingCandidateLineageRead(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): boolean {
  if (env.NODE_ENV !== "production" || env.RACUN_DEPLOY_ENV !== "staging" || env.RENDER_SERVICE_ID !== JJ_LINEAGE_SERVICE_ID) return false;
  const sha = env.RENDER_GIT_COMMIT?.trim() ?? "";
  const secret = env.AUTH_SECRET ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha) || secret.length < 16) return false;
  const parts = (request.headers.get(JJ_LINEAGE_HEADER) ?? "").split(":");
  if (parts.length !== 5 || parts[0] !== JJ_LINEAGE_TASK || parts[1] !== sha) return false;
  const expiresAtMs = Number(parts[2]);
  const nonce = parts[3];
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs || expiresAtMs > nowMs + JJ_LINEAGE_TTL_MS) return false;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(parts[4])) return false;
  const expected = signature(secret, sha, expiresAtMs, nonce);
  return crypto.timingSafeEqual(Buffer.from(parts[4], "hex"), Buffer.from(expected, "hex"));
}

export function buildStagingWebDatabaseBindingReceipt(
  binding: { sha256: string; components: string[] },
  candidateRowCount: number,
  queriedAt: string,
  deployedSha: string,
) {
  if (!/^[0-9a-f]{64}$/.test(binding.sha256)
    || !/^[0-9a-f]{40}$/.test(deployedSha)
    || !Number.isInteger(candidateRowCount) || candidateRowCount < 0 || candidateRowCount > 1) {
    throw new Error("STAGING_WEB_DATABASE_BINDING_INVALID");
  }
  const componentSet = new Set(binding.components);
  const components = {
    database_name_present: componentSet.has("database_name"),
    server_version_present: componentSet.has("server_version_num"),
    system_identifier_present: componentSet.has("system_identifier"),
  };
  if (Object.values(components).some((present) => !present)) {
    throw new Error("STAGING_WEB_DATABASE_BINDING_INCOMPLETE");
  }
  return {
    schema: "bikinfyp.staging-web-database-binding/v1",
    task: JJ_LINEAGE_TASK,
    queried_at: queriedAt,
    deployed_sha: deployedSha,
    candidate_present: candidateRowCount === 1,
    candidate_row_count: candidateRowCount,
    runtime: "live-web-pool-read-only",
    database_binding: { sha256: binding.sha256, ...components },
  };
}

export function buildStagingCandidateLineageReceipt(row: CandidateRow, queriedAt: string, deployedSha: string) {
  const manifest = parsed<Record<string, any>>(row.approved_reference_manifest);
  const snapshot = parsed<Record<string, unknown>>(row.job_product_snapshot);
  const images = parsed<string[]>(row.images);
  const rights = parsed<Record<string, any>>(row.raw_meta)?.staging_reference_rights;
  const referenceKey = images?.[0];
  const receiptKey = `${referenceKey}.rights.json`;
  const manifestRights = manifest?.stagingReferenceRights;
  const manifestBinding = manifestRights?.binding;
  const manifestReceipt = manifestRights?.receipt;
  const lifecycle = parsed<Record<string, any>>(row.lifecycle_meta);
  const lifecycleState = lifecycle?.post_commit_state as Record<string, unknown> | undefined;
  if (row.product_id !== JJ_PRODUCT_ID || row.script_id !== JJ_SCRIPT_ID
    || row.state !== "QUEUED" || row.creator_category !== "lokal"
    || row.provider_video !== null || row.provider_voice !== null || row.output_url !== null
    || Number(row.provider_task_count) !== 0 || Number(row.hold_count) !== 1
    || Number(row.hold_delta) !== -12_000 || Number(row.terminal_ledger_count) !== 0
    || Number(row.job_ledger_net) !== -12_000
    || !row.database_name || !row.database_principal || !row.database_server_address
    || !Number.isInteger(Number(row.database_server_port)) || Number(row.database_server_port) <= 0
    || Number(row.product_job_count) !== 1 || Number(row.product_script_count) !== 1
    || Number(row.lifecycle_receipt_count) !== 1 || row.lifecycle_actor !== JJ_PRINCIPAL_ID
    || lifecycle?.schema !== JJ_GLOW_LIFECYCLE_SCHEMA || lifecycle?.task !== JJ_GLOW_FINAL_RECOVERY_TASK
    || lifecycle?.historical_root_cause_waiver !== true || lifecycle?.final_candidate_ordinal !== 3
    || lifecycle?.max_canonical_candidates_created !== 3 || lifecycle?.provider_posts_at_admission !== 0
    || lifecycle?.create_actor !== JJ_PRINCIPAL_ID || lifecycle?.append_only !== true
    || lifecycle?.transaction_commit_receipt?.atomic_with_job !== true
    || lifecycle?.transaction_commit_receipt?.visible_only_after_commit !== true
    || lifecycle?.mutation_policy?.delete_requires_reason_actor !== true
    || lifecycle?.mutation_policy?.supersede_requires_reason_actor !== true
    || !lifecycleState || lifecycleState.job_id !== row.id || lifecycleState.product_id !== row.product_id
    || lifecycleState.script_id !== row.script_id || lifecycleState.state !== row.state
    || Number(lifecycleState.provider_task_count) !== Number(row.provider_task_count)
    || Number(lifecycleState.hold_count) !== Number(row.hold_count)
    || lifecycleState.approved_reference_manifest_sha256 !== sha256(typeof row.approved_reference_manifest === "string" ? row.approved_reference_manifest : JSON.stringify(row.approved_reference_manifest))
    || lifecycleState.job_product_snapshot_sha256 !== sha256(typeof row.job_product_snapshot === "string" ? row.job_product_snapshot : JSON.stringify(row.job_product_snapshot))
    || jjGlowLifecycleStateSha256(lifecycleState) !== lifecycle?.post_commit_state_sha256
    || !row.id || !row.persona_id || !manifest || !snapshot || images?.length !== 1
    || referenceKey !== rights?.reference_key
    || rights?.reference_sha256 !== JJ_REFERENCE_SHA
    || rights?.receipt_sha256 !== JJ_RIGHTS_RECEIPT_SHA
    || rights?.receipt_key !== receiptKey || rights?.scope !== JJ_RIGHTS_SCOPE
    || rights?.publication_permitted !== false
    || manifest.references?.length !== 1 || manifest.references[0]?.rel !== referenceKey
    || manifest.references[0]?.sha256 !== JJ_REFERENCE_SHA
    || manifestBinding?.reference_key !== referenceKey || manifestBinding?.receipt_key !== receiptKey
    || manifestBinding?.reference_sha256 !== JJ_REFERENCE_SHA
    || manifestBinding?.receipt_sha256 !== JJ_RIGHTS_RECEIPT_SHA
    || manifestBinding?.scope !== JJ_RIGHTS_SCOPE || manifestBinding?.publication_permitted !== false
    || referenceRightsSha256(canonicalReferenceRightsJson(manifestReceipt)) !== JJ_RIGHTS_RECEIPT_SHA
    || manifestReceipt?.schema !== "bikinfyp.staging-reference-rights/v1"
    || manifestReceipt?.source_kind !== "internally_created_synthetic"
    || manifestReceipt?.actor_principal_id !== JJ_PRINCIPAL_ID || manifestReceipt?.actor_role !== "Founder/CEO"
    || manifestReceipt?.owning_user_id !== JJ_PRINCIPAL_ID || manifestReceipt?.owning_org_id !== null
    || manifestReceipt?.product_id !== JJ_PRODUCT_ID
    || manifestReceipt?.rights_scope !== JJ_RIGHTS_SCOPE || manifestReceipt?.publication_permitted !== false
    || manifestReceipt?.normalized_object?.storage_key !== referenceKey
    || manifestReceipt?.normalized_object?.sha256 !== JJ_REFERENCE_SHA
    || manifestReceipt?.revocation?.storage_key !== `${receiptKey}.revoked.json`
    || manifestReceipt?.revocation?.status_at_issuance !== "NOT_REVOKED"
    || sha256(bytesFor(snapshot)) !== JJ_PRODUCT_SNAPSHOT_SHA) {
    throw new Error("JJ candidate lineage invariant mismatch");
  }
  const payload = {
    schema: "bikinfyp.staging-candidate-lineage-receipt/v1",
    task: JJ_LINEAGE_TASK,
    queried_at: queriedAt,
    deployed_sha: deployedSha,
    evidence_source: "/api/staging-evidence/jj-glow-candidate-lineage",
    lineage: {
      job_id: row.id,
      persona_id: row.persona_id,
      subject_id: row.persona_id,
      script_id: row.script_id,
      product_id: row.product_id,
    },
    immutable_digests: {
      product_snapshot_sha256: sha256(bytesFor(snapshot)),
      approved_reference_manifest_sha256: sha256(bytesFor(manifest)),
    },
    reference: {
      object_key: referenceKey,
      receipt_key: rights.receipt_key,
      object_sha256: rights.reference_sha256,
      receipt_sha256: rights.receipt_sha256,
      publication_permitted: false,
    },
    frozen_runtime: {
      state: row.state,
      provider_video_is_null: true,
      provider_voice_is_null: true,
      output_url_is_null: true,
      provider_task_count: Number(row.provider_task_count),
      hold_count: Number(row.hold_count),
      hold_delta: Number(row.hold_delta),
      terminal_ledger_count: Number(row.terminal_ledger_count),
      job_ledger_net: Number(row.job_ledger_net),
      exact_product_job_count: Number(row.product_job_count),
      exact_product_script_count: Number(row.product_script_count),
      worker_required_suspended: true,
    },
    control_plane: {
      database_binding_sha256: sha256(JSON.stringify({
        database: row.database_name,
        principal: row.database_principal,
        server_address: row.database_server_address,
        server_port: Number(row.database_server_port),
      })),
      database_binding_components_present: true,
    },
    lifecycle: {
      schema: lifecycle.schema,
      correlation_id: lifecycle.correlation_id,
      create_actor: lifecycle.create_actor,
      create_timestamp: lifecycle.create_timestamp,
      transaction_commit_receipt: lifecycle.transaction_commit_receipt,
      post_commit_state_sha256: lifecycle.post_commit_state_sha256,
      database_binding_sha256: lifecycleState.database_binding_sha256,
      append_only: true,
      mutation_policy: lifecycle.mutation_policy,
    },
  };
  return { ...payload, receipt_payload_sha256: sha256(bytesFor(payload)) };
}
