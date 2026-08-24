import { prepareJobReferenceManifest, type JobReferenceManifest } from "./job-reference-manifest";
import { catatKanariReferensi, GagalTanpaReferensi } from "./kanari-bukti";
import { pesanTanpaReferensi } from "./product-truth";

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
}): Promise<{ manifest: JobReferenceManifest; raw: string }> {
  const prepared = await prepareJobReferenceManifest({
    jobId: input.jobId,
    candidateRels: input.candidateRels,
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
