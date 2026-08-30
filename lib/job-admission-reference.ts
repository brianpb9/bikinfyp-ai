import { parseJobReferenceManifest, prepareJobReferenceManifest, type JobReferenceManifest } from "./job-reference-manifest";
import { catatKanariReferensi, GagalTanpaReferensi } from "./kanari-bukti";
import { pesanTanpaReferensi, resolveApprovedReference } from "./product-truth";
import { mediaStorage } from "./storage";
import { config } from "./config";
import { connectEvidenceLockClient, releaseSessionAdvisoryLock } from "./postgres/evidence-lock-pool";
import type { PoolClient } from "pg";
import { ERR } from "./errors";
import { stagingReferenceRightsBindingFromRawMeta, stagingReferenceRightsRel, verifyStagingReferenceRightsBinding, type StagingReferenceRightsBinding } from "./staging-reference-rights";

type ProductEvidenceBoundary = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";
type ProductOwner = { kind: "user" | "org"; id: string };
const postgresRuntimeEnabled = () =>
  process.env.RACUN_POSTGRES_SMOKE === "1" || process.env.RACUN_DB_RUNTIME === "postgres";

type EvidenceLockClient = PoolClient;
const productionLockDependencies = {
  postgresRuntimeEnabled,
  connect: async (): Promise<EvidenceLockClient> => connectEvidenceLockClient(config.databaseUrl),
  useProcessLocalLock: true,
};
type EvidenceLockDependencies = typeof productionLockDependencies;
let lockDependenciesForTests: Partial<EvidenceLockDependencies> | undefined;

export function setEvidenceLockDependenciesForTests(
  dependencies?: Partial<EvidenceLockDependencies>,
): void {
  lockDependenciesForTests = dependencies;
}

function evidenceLockDependencies(): EvidenceLockDependencies {
  return { ...productionLockDependencies, ...lockDependenciesForTests };
}

async function acquireProcessProductOperation(productId: string): Promise<() => void> {
  return evidenceLockDependencies().useProcessLocalLock
    ? acquireLocalProductOperation(productId)
    : () => undefined;
}

const productOperationTails = new Map<string, Promise<void>>();

async function acquireLocalProductOperation(productId: string): Promise<() => void> {
  const previous = productOperationTails.get(productId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  productOperationTails.set(productId, tail);
  await previous;
  return () => {
    release();
    if (productOperationTails.get(productId) === tail) productOperationTails.delete(productId);
  };
}

async function unlockAndRelease(client: EvidenceLockClient, productId: string): Promise<void> {
  await releaseSessionAdvisoryLock({
    client,
    sql: "SELECT pg_advisory_unlock(hashtextextended($1, 881731)) AS unlocked",
    values: [productId],
    label: "admission-evidence",
  });
}

async function acquirePostgresProductLock(productId: string): Promise<EvidenceLockClient> {
  const client = await evidenceLockDependencies().connect();
  try {
    const rawWait = Number(process.env.PG_EVIDENCE_LOCK_WAIT_MS);
    const maxWaitMs = Number.isFinite(rawWait) && rawWait > 0 ? Math.floor(rawWait) : 120_000;
    const deadline = Date.now() + maxWaitMs;
    do {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 881731)) AS locked",
        [productId],
      );
      if (result.rows[0]?.locked) return client;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for evidence advisory lock ${productId}`);
  } catch (error) {
    try { client.release(error instanceof Error ? error : new Error(String(error))); }
    catch (releaseError) { console.error("[admission-evidence] failed to evict acquire client:", releaseError); }
    throw error;
  }
}

/** Serialize mutation paths with provider/setup operations. PostgreSQL uses a
 * session advisory lock (not an idle transaction), and runs the mutation on
 * that same connection so this stays safe even when the pool size is one. */
export async function withProductEvidenceMutationLock<T>(
  productId: string,
  mutation: (client?: EvidenceLockClient) => Promise<T>,
): Promise<T> {
  const release = await acquireProcessProductOperation(productId);
  let client: EvidenceLockClient | null = null;
  try {
    if (evidenceLockDependencies().postgresRuntimeEnabled()) {
      client = await acquirePostgresProductLock(productId);
    }
    return await mutation(client ?? undefined);
  } finally {
    if (client) await unlockAndRelease(client, productId);
    release();
  }
}

export type LockedProductTypeState = {
  category?: string | null;
  product_type_token: string | null;
  product_type_confirmed_token: string | null;
  product_type_confirmed_by: string | null;
  product_type_confirmed_at: string | Date | null;
  product_type_version: number | null;
  product_type_state: string;
  category_review_state?: string | null;
  category_review_reason?: string | null;
  category_reviewed_by?: string | null;
  category_reviewed_role?: string | null;
  category_reviewed_at?: string | Date | null;
  category_review_version?: number | null;
};

export type AdmissionEvidenceLease = {
  productType: LockedProductTypeState | null;
  release(): Promise<void>;
};

/**
 * Keep the verified product identity stable until the provider/setup operation
 * completes. PostgreSQL holds a session advisory lock across the operation,
 * so it is unaffected by idle_in_transaction_session_timeout and E5/E9 wait.
 * SQLite uses the same keyed lock as its E5 mutation path.
 */
export async function acquireAdmissionReferenceEvidence(input: {
  productId: string;
  owner: ProductOwner;
  boundary: ProductEvidenceBoundary;
  loadSqliteCandidateRels: () => Promise<string[]> | string[];
  loadSqliteProductType?: () => Promise<LockedProductTypeState | null> | LockedProductTypeState | null;
  loadSqliteRawMeta?: () => Promise<string | null> | string | null;
}): Promise<AdmissionEvidenceLease> {
  const releaseLocal = await acquireProcessProductOperation(input.productId);
  let client: PoolClient | null = null;
  let released = false;
  try {
    let candidateRels: string[];
    let productType: LockedProductTypeState | null = null;
    let stagingReferenceRightsBinding: StagingReferenceRightsBinding | null = null;
    if (evidenceLockDependencies().postgresRuntimeEnabled()) {
      client = await acquirePostgresProductLock(input.productId);
      const ownerColumn = input.owner.kind === "org" ? "org_id" : "user_id";
      const locked = await client.query<LockedProductTypeState & { images: string; raw_meta: string | null }>(
        `SELECT images,raw_meta,category,product_type_token,product_type_confirmed_token,product_type_confirmed_by,
                product_type_confirmed_at,product_type_version,product_type_state,
                category_review_state,category_review_reason,category_reviewed_by,
                category_reviewed_role,category_reviewed_at,category_review_version
           FROM products WHERE id=$1 AND ${ownerColumn}=$2`,
        [input.productId, input.owner.id]
      );
      if (!locked.rows[0]) throw new Error(`Admission product ${input.productId} disappeared before ${input.boundary}`);
      candidateRels = JSON.parse(locked.rows[0].images || "[]") as string[];
      productType = locked.rows[0];
      stagingReferenceRightsBinding = stagingReferenceRightsBindingFromRawMeta(locked.rows[0].raw_meta);
    } else {
      candidateRels = await input.loadSqliteCandidateRels();
      productType = await input.loadSqliteProductType?.() ?? null;
      stagingReferenceRightsBinding = stagingReferenceRightsBindingFromRawMeta(await input.loadSqliteRawMeta?.() ?? null);
    }
    await assertAdmissionReferenceEvidence({
      productId: input.productId,
      candidateRels,
      boundary: input.boundary,
      stagingReferenceRightsBinding,
    });
    return {
      productType,
      async release() {
        if (released) return;
        released = true;
        if (client) await unlockAndRelease(client, input.productId);
        releaseLocal();
      },
    };
  } catch (error) {
    if (client) await unlockAndRelease(client, input.productId);
    releaseLocal();
    throw error;
  }
}

/**
 * Read-only product-evidence gate for provider-consuming work that happens
 * before a job id exists (script generation, matrix expansion, and campaign
 * confirmation setup).
 *
 * This deliberately does not create the durable per-job snapshot; the
 * authoritative admission path still calls prepareAdmissionReferenceManifest
 * under its product-row lock. The preflight only prevents an invalid product
 * from reaching an LLM/provider or leaving setup rows behind before that
 * authoritative transaction runs.
 */
export async function assertAdmissionReferenceEvidence(input: {
  productId: string;
  candidateRels: string[];
  boundary: ProductEvidenceBoundary;
  stagingReferenceRightsBinding?: StagingReferenceRightsBinding | null;
}): Promise<void> {
  const resolution = await resolveApprovedReference(input.candidateRels);
  catatKanariReferensi(resolution, {
    produkId: input.productId,
    runtime: `admission-preflight-${input.boundary}`,
  });
  if (!resolution.utama) {
    const failedOcr = resolution.ditolak.find((item) => item.alasan === "OCR_FAILED");
    if (failedOcr) throw ERR.OCR_FAILED(failedOcr.pesan);
    const unreadable = resolution.ditolak.find((item) => item.alasan === "LABEL_UNREADABLE");
    if (unreadable) throw ERR.LABEL_UNREADABLE(unreadable.pesan);
    throw new GagalTanpaReferensi(pesanTanpaReferensi(resolution), resolution);
  }
  if (input.stagingReferenceRightsBinding) {
    if (resolution.tersetujui.length !== 1) throw new Error("STAGING_REFERENCE_RIGHTS_REQUIRES_SOLE_REFERENCE");
    await verifyStagingReferenceRightsBinding({
      binding:input.stagingReferenceRightsBinding,referenceRel:resolution.utama.rel,now:new Date().toISOString(),
    });
  }
  else {
    for (const reference of resolution.tersetujui) {
      if (await mediaStorage().get(stagingReferenceRightsRel(reference.rel))) {
        throw new Error("STAGING_REFERENCE_RIGHTS_BINDING_MISSING");
      }
    }
  }
}

/**
 * Canonical admission wrapper. It preserves the worker's existing
 * NO_APPROVED_REFERENCE contract while preparing deterministic job-owned bytes
 * before a job row, hold, or queue message can become visible.
 */
export async function prepareAdmissionReferenceManifest(input: {
  jobId: string;
  productId: string;
  candidateRels: string[];
  runtime: "admission-sqlite" | "admission-postgres-retail" | "admission-postgres-org";
  onSnapshotTarget?: (snapshotRel: string) => void;
  stagingReferenceRightsBinding?: StagingReferenceRightsBinding | null;
}): Promise<{ manifest: JobReferenceManifest; raw: string }> {
  const prepared = await prepareJobReferenceManifest({
    jobId: input.jobId,
    candidateRels: input.candidateRels,
    onSnapshotTarget: input.onSnapshotTarget,
    stagingReferenceRightsBinding:input.stagingReferenceRightsBinding,
    onResolved: (resolution) => {
      catatKanariReferensi(resolution, {
        jobId: input.jobId,
        produkId: input.productId,
        runtime: input.runtime,
      });
      if (!resolution.utama) {
        throw new GagalTanpaReferensi(pesanTanpaReferensi(resolution), resolution);
      }
    },
  });
  return { manifest: prepared.manifest, raw: prepared.raw };
}

export type AdmissionReferenceCleanupResult = {
  provenAbsent: boolean;
  attempted: number;
  deleted: number;
  failed: string[];
};

/**
 * Best-effort cleanup for a job id that definitively did not win admission.
 *
 * The absence callback MUST issue a fresh authoritative database read after
 * rollback/non-admission. False, or an exception while proving absence, is a
 * fail-closed no-op: an ambiguous commit must never lose its durable bytes.
 * Delete failures are observable but cannot turn a safe duplicate response
 * into a retry that might charge twice.
 */
export async function cleanupUnadmittedReferenceKeys(input: {
  jobId: string;
  snapshotRels: Iterable<string>;
  runtime: "admission-sqlite" | "admission-postgres-retail" | "admission-postgres-org";
  proveJobAbsent: () => Promise<boolean>;
}): Promise<AdmissionReferenceCleanupResult> {
  const keys = [...new Set(input.snapshotRels)].filter((key) => key.startsWith(`jobs/${input.jobId}/approved-references/`));
  let provenAbsent = false;
  try {
    provenAbsent = await input.proveJobAbsent();
  } catch (error) {
    console.error(`[admission-reference-cleanup] absence proof failed; retaining keys runtime=${input.runtime} job=${input.jobId}`, error);
  }
  if (!provenAbsent) return { provenAbsent: false, attempted: 0, deleted: 0, failed: [] };

  const failed: string[] = [];
  let deleted = 0;
  for (const key of keys) {
    try {
      await mediaStorage().delete(key);
      deleted++;
    } catch (error) {
      failed.push(key);
      console.error(`[admission-reference-cleanup] delete failed; orphan retained runtime=${input.runtime} job=${input.jobId} key=${key}`, error);
    }
  }
  return { provenAbsent: true, attempted: keys.length, deleted, failed };
}

/** Prune retry artifacts only after the committed row names the exact winners. */
export async function cleanupSupersededReferenceKeys(input: {
  jobId: string;
  snapshotRels: Iterable<string>;
  runtime: "admission-sqlite" | "admission-postgres-retail" | "admission-postgres-org";
  readCommittedManifest: () => Promise<string | null>;
}): Promise<{ committedManifestProven: boolean; attempted: number; deleted: number; failed: string[] }> {
  let raw: string | null = null;
  try {
    raw = await input.readCommittedManifest();
  } catch (error) {
    console.error(`[admission-reference-cleanup] committed manifest proof failed; retaining retry keys runtime=${input.runtime} job=${input.jobId}`, error);
  }
  if (!raw) return { committedManifestProven: false, attempted: 0, deleted: 0, failed: [] };

  let winners: Set<string>;
  try {
    winners = new Set(parseJobReferenceManifest(raw).references.map((ref) => ref.snapshotRel));
  } catch (error) {
    console.error(`[admission-reference-cleanup] committed manifest invalid; retaining retry keys runtime=${input.runtime} job=${input.jobId}`, error);
    return { committedManifestProven: false, attempted: 0, deleted: 0, failed: [] };
  }
  const obsolete = [...new Set(input.snapshotRels)].filter((key) =>
    key.startsWith(`jobs/${input.jobId}/approved-references/`) && !winners.has(key));
  const failed: string[] = [];
  let deleted = 0;
  for (const key of obsolete) {
    try {
      await mediaStorage().delete(key);
      deleted++;
    } catch (error) {
      failed.push(key);
      console.error(`[admission-reference-cleanup] retry-key delete failed; orphan retained runtime=${input.runtime} job=${input.jobId} key=${key}`, error);
    }
  }
  return { committedManifestProven: true, attempted: obsolete.length, deleted, failed };
}
