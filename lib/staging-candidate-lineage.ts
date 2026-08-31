import crypto from "node:crypto";

export const JJ_LINEAGE_TASK = "P0-JJ-GLOW-CANDIDATE-CLOSURE-20260831-R10";
export const JJ_LINEAGE_HEADER = "x-racun-staging-lineage-read";
export const JJ_LINEAGE_TTL_MS = 5 * 60_000;
export const JJ_LINEAGE_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
export const JJ_PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
export const JJ_SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
export const JJ_PRINCIPAL_ID = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
export const JJ_REFERENCE_SHA = "744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1";
export const JJ_RIGHTS_RECEIPT_SHA = "ca3906a381e6d299bc46fe62aeefbc3bd9b4183a6ff59c4f3cde2ca8f94788c3";

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
  product_job_count: number;
  product_script_count: number;
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

export function buildStagingCandidateLineageReceipt(row: CandidateRow, queriedAt: string, deployedSha: string) {
  const manifest = parsed<Record<string, any>>(row.approved_reference_manifest);
  const snapshot = parsed<Record<string, unknown>>(row.job_product_snapshot);
  const images = parsed<string[]>(row.images);
  const rights = parsed<Record<string, any>>(row.raw_meta)?.staging_reference_rights;
  const referenceKey = images?.[0];
  if (row.product_id !== JJ_PRODUCT_ID || row.script_id !== JJ_SCRIPT_ID
    || row.state !== "QUEUED" || row.creator_category !== "lokal"
    || row.provider_video !== null || row.provider_voice !== null || row.output_url !== null
    || Number(row.provider_task_count) !== 0 || Number(row.hold_count) !== 1
    || Number(row.product_job_count) !== 1 || Number(row.product_script_count) !== 1
    || !row.id || !row.persona_id || !manifest || !snapshot || images?.length !== 1
    || referenceKey !== rights?.reference_key
    || rights?.reference_sha256 !== JJ_REFERENCE_SHA
    || rights?.receipt_sha256 !== JJ_RIGHTS_RECEIPT_SHA
    || rights?.publication_permitted !== false
    || manifest.references?.length !== 1 || manifest.references[0]?.sha256 !== JJ_REFERENCE_SHA) {
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
      exact_product_job_count: Number(row.product_job_count),
      exact_product_script_count: Number(row.product_script_count),
      worker_required_suspended: true,
    },
  };
  return { ...payload, receipt_payload_sha256: sha256(bytesFor(payload)) };
}
