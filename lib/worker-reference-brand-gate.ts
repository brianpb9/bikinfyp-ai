import { ERR } from "./errors";
import { periksaLabelFoto } from "./media/label-terbaca";

/**
 * Gerbang merek terakhir di boundary worker.
 *
 * Referensi yang diperiksa harus berupa snapshot privat job yang immutable,
 * bukan path upload mutable. Hanya mismatch eksplisit yang menolak: hasil OCR
 * tidak terbaca/timeout/null mempertahankan kebijakan admission yang sudah ada.
 */
export async function assertApprovedReferenceBrands(
  referencePaths: readonly string[],
  productName: string,
  trustedBrand: string | null,
): Promise<void> {
  if (!trustedBrand) return;

  for (const referencePath of referencePaths) {
    const label = await periksaLabelFoto(referencePath, productName, trustedBrand);
    if (label.cocokMerek === false) throw ERR.BRAND_MISMATCH(label.alasan);
  }
}
