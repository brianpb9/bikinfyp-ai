import { parseJobReferenceManifest, prepareJobReferenceManifest, type JobReferenceManifest } from "./job-reference-manifest";
import { catatKanariReferensi, GagalTanpaReferensi } from "./kanari-bukti";
import { pesanTanpaReferensi, resolveApprovedReference } from "./product-truth";
import { mediaStorage } from "./storage";
import { config } from "./config";
import { getPool } from "./postgres/pool";
import type { PoolClient } from "pg";

type ProductEvidenceBoundary = "A2" | "A3" | "A5" | "A7";
type ProductOwner = { kind: "user" | "org"; id: string };
const postgresRuntimeEnabled = () =>
  process.env.RACUN_POSTGRES_SMOKE === "1" || process.env.RACUN_DB_RUNTIME === "postgres";

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

/** Serialize SQLite mutation paths with provider/setup operations. PostgreSQL
 * mutations are additionally serialized by the row lock held below. */
export async function withProductEvidenceMutationLock<T>(productId: string, mutation: () => Promise<T>): Promise<T> {
  const release = await acquireLocalProductOperation(productId);
  try { return await mutation(); } finally { release(); }
}

export type AdmissionEvidenceLease = { release(): Promise<void> };

/**
 * Keep the verified product identity stable until the provider/setup operation
 * completes. PostgreSQL holds FOR SHARE across the operation, so E5/E9 updates
 * wait. SQLite uses the same keyed lock as its E5 mutation path.
 */
export async function acquireAdmissionReferenceEvidence(input: {
  productId: string;
  owner: ProductOwner;
  boundary: ProductEvidenceBoundary;
  loadSqliteCandidateRels: () => Promise<string[]> | string[];
}): Promise<AdmissionEvidenceLease> {
  const releaseLocal = await acquireLocalProductOperation(input.productId);
  let client: PoolClient | null = null;
  let released = false;
  try {
    let candidateRels: string[];
    if (postgresRuntimeEnabled()) {
      client = await getPool(config.databaseUrl).connect();
      await client.query("BEGIN");
      const ownerColumn = input.owner.kind === "org" ? "org_id" : "user_id";
      const locked = await client.query<{ images: string }>(
        `SELECT images FROM products WHERE id=$1 AND ${ownerColumn}=$2 FOR SHARE`,
        [input.productId, input.owner.id]
      );
      if (!locked.rows[0]) throw new Error(`Admission product ${input.productId} disappeared before ${input.boundary}`);
      candidateRels = JSON.parse(locked.rows[0].images || "[]") as string[];
    } else {
      candidateRels = await input.loadSqliteCandidateRels();
    }
    await assertAdmissionReferenceEvidence({
      productId: input.productId,
      candidateRels,
      boundary: input.boundary,
    });
    return {
      async release() {
        if (released) return;
        released = true;
        try { if (client) await client.query("COMMIT"); }
        finally { client?.release(); releaseLocal(); }
      },
    };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    client?.release();
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
}): Promise<void> {
  const resolution = await resolveApprovedReference(input.candidateRels);
  catatKanariReferensi(resolution, {
    produkId: input.productId,
    runtime: `admission-preflight-${input.boundary}`,
  });
  if (!resolution.utama) {
    throw new GagalTanpaReferensi(pesanTanpaReferensi(resolution), resolution);
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
}): Promise<{ manifest: JobReferenceManifest; raw: string }> {
  const prepared = await prepareJobReferenceManifest({
    jobId: input.jobId,
    candidateRels: input.candidateRels,
    onSnapshotTarget: input.onSnapshotTarget,
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
