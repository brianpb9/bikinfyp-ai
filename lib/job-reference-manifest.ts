import path from "node:path";
import crypto from "node:crypto";
import { mediaStorage } from "./storage";
import { ambilSnapshotTersetujui, pastikanBytesTersetujui, resolveApprovedReference, type HasilResolusiReferensi, type ReferensiTersetujui } from "./product-truth";
import { MAKS_REFERENSI_PER_GENERASI } from "./product-images";
import { ERR } from "./errors";
import { canonicalReferenceRightsJson, stagingReferenceRightsRel, verifyStagingReferenceRightsBinding,
  type StagingReferenceRightsBinding, type StagingReferenceRightsReceipt } from "./staging-reference-rights";

export const REFERENCE_MANIFEST_VERSION = 2 as const;

export interface JobReferenceManifestEntry extends ReferensiTersetujui {
  /** Immutable object owned by this job, never by products.images cleanup. */
  snapshotRel: string;
}

export interface JobReferenceManifest {
  version: typeof REFERENCE_MANIFEST_VERSION;
  references: JobReferenceManifestEntry[];
  stagingReferenceRights?: { binding:StagingReferenceRightsBinding; receipt:StagingReferenceRightsReceipt };
}

export class UnsafeLegacyReferenceSnapshot extends Error {
  readonly code = "REF_MANIFEST_LEGACY_UNSAFE";
}

function validReference(value: unknown): value is JobReferenceManifestEntry {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.rel === "string" && ref.rel.length > 0
    && typeof ref.sha256 === "string" && /^[0-9a-f]{64}$/.test(ref.sha256)
    && typeof ref.versiBukti === "number" && Number.isInteger(ref.versiBukti) && ref.versiBukti > 0
    && ref.labelOcrStatus === "READABLE" && ref.labelOcrVersion === 1
    && typeof ref.snapshotRel === "string" && ref.snapshotRel.startsWith("jobs/") && ref.snapshotRel.length > 10;
}

export function parseJobReferenceManifest(raw: string): JobReferenceManifest {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("REF_MANIFEST_INVALID: manifest referensi job bukan JSON sah."); }
  const manifest = value as Partial<JobReferenceManifest> | null;
  if (manifest && Array.isArray(manifest.references)
      && (manifest.version !== REFERENCE_MANIFEST_VERSION
        || manifest.references.some((ref) => (ref as Partial<JobReferenceManifestEntry>).labelOcrStatus !== "READABLE"
          || (ref as Partial<JobReferenceManifestEntry>).labelOcrVersion !== 1))) {
    throw ERR.OCR_FAILED("Manifest referensi belum memiliki provenance OCR label yang sah; job dikarantina sebelum provider.");
  }
  if (!manifest || manifest.version !== REFERENCE_MANIFEST_VERSION
      || !Array.isArray(manifest.references) || manifest.references.length === 0
      || manifest.references.length > MAKS_REFERENSI_PER_GENERASI
      || !manifest.references.every(validReference)) {
    throw new Error("REF_MANIFEST_INVALID: bentuk manifest referensi job tidak sah.");
  }
  return { version: REFERENCE_MANIFEST_VERSION, references: manifest.references,
    ...(manifest.stagingReferenceRights ? {stagingReferenceRights:manifest.stagingReferenceRights} : {}) };
}

/**
 * Prepare immutable, job-owned reference bytes before a job becomes visible.
 *
 * Storage and the application database cannot share a transaction. The safe
 * ordering is therefore storage-first: a database row may be absent after a
 * crash (leaving harmless orphan objects), but a committed manifest must never
 * point at bytes that were not durably written. Keys are deterministic, so a
 * bounded admission retry with the same job id is an idempotent overwrite.
 * Callers MUST NOT delete these keys when a database commit result is
 * ambiguous. Orphan collection needs a grace period and a fresh authoritative
 * database absence check.
 */
export async function prepareJobReferenceManifest(input: {
  jobId: string;
  candidateRels: string[];
  onResolved?: (resolution: HasilResolusiReferensi) => void;
  /** Admission callers track attempted deterministic keys for safe rollback. */
  onSnapshotTarget?: (snapshotRel: string) => void;
  stagingReferenceRightsBinding?: StagingReferenceRightsBinding | null;
}): Promise<{ manifest: JobReferenceManifest; raw: string; resolution: HasilResolusiReferensi }> {
  const resolution = await resolveApprovedReference(input.candidateRels);
  input.onResolved?.(resolution);
  if (!resolution.utama) {
    throw new Error("REF_MANIFEST_EMPTY: tidak ada referensi tersetujui untuk dipatok pada job.");
  }
  const references: JobReferenceManifestEntry[] = [];
  for (const [index, ref] of resolution.tersetujui.slice(0, MAKS_REFERENSI_PER_GENERASI).entries()) {
    // Resolver's get and this get are intentionally separate. The second read
    // is the exact byte sequence copied into immutable job-owned storage.
    const object = await mediaStorage().get(ref.rel);
    if (!object) throw new Error(`REF_MISSING: referensi ${ref.rel} hilang sebelum snapshot durable dibuat.`);
    const actual = crypto.createHash("sha256").update(object.body).digest("hex");
    if (actual !== ref.sha256) {
      throw new Error(`REF_HASH_MISMATCH: isi ${ref.rel} berubah sebelum snapshot durable dibuat.`);
    }
    const ext = path.posix.extname(ref.rel);
    const snapshotRel = path.posix.join("jobs", input.jobId, "approved-references", `${index}-${ref.sha256}${ext}`);
    input.onSnapshotTarget?.(snapshotRel);
    await mediaStorage().put(snapshotRel, object.body);
    references.push({ ...ref, snapshotRel });
  }
  let stagingReferenceRights:JobReferenceManifest["stagingReferenceRights"];
  const primary=references[0];
  if (input.stagingReferenceRightsBinding) {
    if (references.length !== 1) throw new Error("STAGING_REFERENCE_RIGHTS_REQUIRES_SOLE_REFERENCE");
    const receipt=await verifyStagingReferenceRightsBinding({binding:input.stagingReferenceRightsBinding,
      referenceRel:primary.rel,now:new Date().toISOString()});
    stagingReferenceRights={binding:input.stagingReferenceRightsBinding,receipt};
  } else {
    for (const reference of references) {
      if (await mediaStorage().get(stagingReferenceRightsRel(reference.rel))) {
        throw new Error("STAGING_REFERENCE_RIGHTS_BINDING_MISSING");
      }
    }
  }
  const manifest: JobReferenceManifest = { version: REFERENCE_MANIFEST_VERSION, references,
    ...(stagingReferenceRights ? {stagingReferenceRights} : {}) };
  const raw = JSON.stringify(manifest);
  return { manifest, raw, resolution };
}

/**
 * Men-materialize SELURUH manifest dan memverifikasi bytes. Worker memanggil
 * ini pada awal attempt dan mengulanginya di setiap boundary provider serta
 * sebelum output/capture; snapshot privat job menjadi satu-satunya path yang
 * boleh diteruskan ke pipeline.
 */
export async function materializeJobReferenceManifest(
  manifest: JobReferenceManifest,
  workDir: string
): Promise<string[]> {
  await verifyJobReferenceManifestRights(manifest);
  const dir = path.join(workDir, "ref-tersetujui");
  const snapshots: string[] = [];
  for (const ref of manifest.references) {
    // Do not collapse infrastructure exceptions into not-found. A thrown R2
    // auth/network/I/O error is retryable infrastructure failure; only null is
    // the provenance error REF_MISSING.
    const source = await mediaStorage().materialize(ref.snapshotRel);
    if (!source) {
      throw new Error(`REF_MISSING: snapshot durable untuk ${ref.rel} tidak ada; job dihentikan sebelum provider.`);
    }
    await pastikanBytesTersetujui(source, ref);
    snapshots.push(await ambilSnapshotTersetujui(source, ref, dir));
  }
  return snapshots;
}

export async function verifyJobReferenceManifestRights(manifest: JobReferenceManifest): Promise<void> {
  if (manifest.stagingReferenceRights) {
    if (manifest.references.length !== 1) throw new Error("STAGING_REFERENCE_RIGHTS_REQUIRES_SOLE_REFERENCE");
    const verified=await verifyStagingReferenceRightsBinding({binding:manifest.stagingReferenceRights.binding,
      referenceRel:manifest.references[0].rel,now:new Date().toISOString()});
    if (canonicalReferenceRightsJson(verified) !== canonicalReferenceRightsJson(manifest.stagingReferenceRights.receipt)) {
      throw new Error("STAGING_REFERENCE_RIGHTS_MANIFEST_MISMATCH");
    }
  }
}

export function assertReferencePublicationPermitted(manifest:JobReferenceManifest):void {
  if (manifest.stagingReferenceRights?.receipt.publication_permitted === false) {
    throw new Error("STAGING_REFERENCE_PUBLICATION_FORBIDDEN");
  }
}
