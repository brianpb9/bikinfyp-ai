import { deleteStoredProductImages } from "./product-images";

export type ReferenceBoundary = "E4" | "E8";

/**
 * Rollback exact object baru setelah resolver/no-reference menolak ingestion.
 * Cleanup sukses mempertahankan error asli. Cleanup gagal menjadi 500
 * observable; caller belum boleh append list atau audit sebelum helper ini
 * selesai.
 */
export async function rejectAfterReferenceCheck(
  boundary: ReferenceBoundary,
  added: string[],
  referenceError: unknown
): Promise<never> {
  try {
    await deleteStoredProductImages(added);
  } catch (cleanupError) {
    const referenceMessage = referenceError instanceof Error ? referenceError.message : String(referenceError);
    const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    throw new Error(
      `${boundary} reference rejection cleanup failed for ${added.length} newly added image(s); ` +
      `the existing product list was not changed, but residual storage objects may remain. ` +
      `Reference failure: ${referenceMessage}. Cleanup failure: ${cleanupMessage}`,
      { cause: cleanupError }
    );
  }
  throw referenceError;
}
