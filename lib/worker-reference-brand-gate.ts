import { ERR } from "./errors";
import { assertAuthoritativeLabelResult, periksaLabelFoto } from "./media/label-terbaca";

/**
 * Gerbang merek terakhir di boundary worker.
 *
 * Referensi yang diperiksa harus berupa snapshot privat job yang immutable,
 * bukan path upload mutable. Hanya mismatch eksplisit yang menolak: hasil OCR
 * kegagalan OCR dan label yang benar-benar tidak terbaca tetap fail-closed.
 */
export async function assertApprovedReferenceBrands(
  referencePaths: readonly string[],
  productName: string,
  trustedBrand: string | null,
): Promise<void> {
  // Readability/OCR provenance is already mandatory in the immutable manifest.
  // Runtime OCR here is the independent brand defense and needs a brand token.
  if (!trustedBrand) return;
  for (const referencePath of referencePaths) {
    const label = await periksaLabelFoto(referencePath, productName, trustedBrand);
    assertAuthoritativeLabelResult(label);
    if (trustedBrand && label.cocokMerek === false) throw ERR.BRAND_MISMATCH(label.alasan);
  }
}
