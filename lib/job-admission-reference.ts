import { parseJobReferenceManifest, prepareJobReferenceManifest, type JobReferenceManifest } from "./job-reference-manifest";
import { catatKanariReferensi, GagalTanpaReferensi } from "./kanari-bukti";
import { pesanTanpaReferensi } from "./product-truth";
import { mediaStorage } from "./storage";

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
