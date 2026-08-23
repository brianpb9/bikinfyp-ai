import path from "node:path";
import { mediaStorage } from "./storage";
import { ambilSnapshotTersetujui, pastikanBytesTersetujui, resolveApprovedReference, type HasilResolusiReferensi, type ReferensiTersetujui } from "./product-truth";
import { MAKS_REFERENSI_PER_GENERASI } from "./product-images";

export const REFERENCE_MANIFEST_VERSION = 1 as const;

export interface JobReferenceManifest {
  version: typeof REFERENCE_MANIFEST_VERSION;
  references: ReferensiTersetujui[];
}

export class UnsafeLegacyReferenceSnapshot extends Error {
  readonly code = "REF_MANIFEST_LEGACY_UNSAFE";
}

function validReference(value: unknown): value is ReferensiTersetujui {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.rel === "string" && ref.rel.length > 0
    && typeof ref.sha256 === "string" && /^[0-9a-f]{64}$/.test(ref.sha256)
    && typeof ref.versiBukti === "number" && Number.isInteger(ref.versiBukti) && ref.versiBukti > 0;
}

export function parseJobReferenceManifest(raw: string): JobReferenceManifest {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("REF_MANIFEST_INVALID: manifest referensi job bukan JSON sah."); }
  const manifest = value as Partial<JobReferenceManifest> | null;
  if (!manifest || manifest.version !== REFERENCE_MANIFEST_VERSION
      || !Array.isArray(manifest.references) || manifest.references.length === 0
      || manifest.references.length > MAKS_REFERENSI_PER_GENERASI
      || !manifest.references.every(validReference)) {
    throw new Error("REF_MANIFEST_INVALID: bentuk manifest referensi job tidak sah.");
  }
  return { version: REFERENCE_MANIFEST_VERSION, references: manifest.references };
}

export async function loadOrCreateJobReferenceManifest(input: {
  existingRaw: string | null;
  candidateRels: string[];
  onResolved?: (resolution: HasilResolusiReferensi) => void;
  /** Atomic CAS. Null means a legacy job already has provider/output evidence. */
  persistIfAbsentAndSafe: (candidateRaw: string) => Promise<string | null>;
}): Promise<{ manifest: JobReferenceManifest; resolution: HasilResolusiReferensi | null }> {
  if (input.existingRaw) {
    return { manifest: parseJobReferenceManifest(input.existingRaw), resolution: null };
  }

  const resolution = await resolveApprovedReference(input.candidateRels);
  input.onResolved?.(resolution);
  if (!resolution.utama) {
    throw new Error("REF_MANIFEST_EMPTY: tidak ada referensi tersetujui untuk dipatok pada job.");
  }
  const candidate: JobReferenceManifest = {
    version: REFERENCE_MANIFEST_VERSION,
    references: resolution.tersetujui.slice(0, MAKS_REFERENSI_PER_GENERASI),
  };
  const persistedRaw = await input.persistIfAbsentAndSafe(JSON.stringify(candidate));
  if (!persistedRaw) {
    throw new UnsafeLegacyReferenceSnapshot(
      "REF_MANIFEST_LEGACY_UNSAFE: job lama sudah punya jejak provider/output; provenance tidak dapat dibuktikan, jadi worker gagal tertutup."
    );
  }
  // CAS yang kalah wajib memakai pemenang dari database, bukan kandidatnya.
  return { manifest: parseJobReferenceManifest(persistedRaw), resolution };
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
  const dir = path.join(workDir, "ref-tersetujui");
  const snapshots: string[] = [];
  for (const ref of manifest.references) {
    const source = await mediaStorage().materialize(ref.rel).catch(() => null);
    if (!source) {
      throw new Error(`REF_MISSING: referensi yang dipatok ${ref.rel} tidak ada; job dihentikan sebelum provider.`);
    }
    await pastikanBytesTersetujui(source, ref);
    snapshots.push(await ambilSnapshotTersetujui(source, ref, dir));
  }
  return snapshots;
}
