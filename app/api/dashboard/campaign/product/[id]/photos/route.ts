import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { createSignedUrl } from "@/lib/signed-url";
import { ALLOWED_MIME, MAX_IMAGES, MAX_IMAGE_BYTES, bacaMetaGambar, deleteStoredProductImages, referensiLayak, saveUniqueProductImages, sniffMime, verifyDecodableImage } from "@/lib/product-images";
import { merekTerdaftar, periksaLabelFoto } from "@/lib/media/label-terbaca";
import { pgAudit, pgRemoveOrgProductImage, postgresRuntimeEnabled, smokeGetOrgProduct } from "@/lib/postgres/smoke-runtime";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";
import { orgPhotoPostDependencies } from "@/lib/org-photo-post-dependencies";
import { withProductEvidenceMutationLock } from "@/lib/job-admission-reference";
import { rejectAfterReferenceCheck } from "@/lib/reference-rejection-rollback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Request.formData() buffers by design. Bound the stream ourselves first so a
// chunked multipart request cannot bypass Content-Length and exhaust memory.
const MAX_PHOTO_REQUEST_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;

async function orgProduct(
  orgId: string,
  productId: string,
  getProduct = smokeGetOrgProduct
) {
  // Keep the production ownership lookup explicit; the alternate branch only
  // exists for the deterministic exported-POST boundary test.
  const product = getProduct === smokeGetOrgProduct
    ? await smokeGetOrgProduct(orgId, productId)
    : await getProduct(orgId, productId);
  if (!product) throw ERR.NOT_FOUND("Produknya");
  return { product, images: JSON.parse(product.images || "[]") as string[] };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const dependencies = orgPhotoPostDependencies();
    if (!dependencies.postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await dependencies.requireOrgContextApi(req);
    await dependencies.assertDashboardRate("photo", membership.org_id);
    const { id } = await ctx.params;
    const owned = await orgProduct(membership.org_id, id, dependencies.smokeGetOrgProduct);
    const releaseUpload = await dependencies.acquirePhotoUploadSlot(2, req.signal);
    try {
    const blob = await dependencies.readSinglePhotoMultipart(req, { maxRequestBytes: MAX_PHOTO_REQUEST_BYTES, maxFileBytes: MAX_IMAGE_BYTES, signal: req.signal, idleTimeoutMs: 15_000, totalTimeoutMs: 30_000 });
    const blobs = [blob];
    if (owned.images.length + blobs.length > MAX_IMAGES) {
      throw ERR.BAD_REQUEST(`Total foto maksimal ${MAX_IMAGES} — produk ini sudah punya ${owned.images.length}.`, "Too many photos.");
    }
    for (const blob of blobs) {
      const mime = sniffMime(blob.data);
      if (!mime || !ALLOWED_MIME[mime]) throw ERR.BAD_REQUEST("File-nya bukan gambar yang valid. Pakai PNG/JPG/WebP ya.", "Invalid image file.");
      if (!(await verifyDecodableImage(blob.data))) throw ERR.BAD_REQUEST("File gambarnya rusak atau bukan foto utuh. Coba upload foto lain ya.", "Corrupt image file.");
      blob.mime = mime;
    }

    for (const blob of blobs) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "org-intake-label-"));
      const tmpFile = path.join(tmpDir, "foto");
      try {
        fs.writeFileSync(tmpFile, blob.data);
        const label = await periksaLabelFoto(tmpFile, owned.product.name, merekTerdaftar(owned.product));
        if (!label.terbaca) throw ERR.LABEL_UNREADABLE(label.alasan);
        if (label.cocokMerek === false) {
          throw ERR.BRAND_MISMATCH(label.alasan);
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    const added = await saveUniqueProductImages(id, blobs);
    try {
      const semua = [...owned.images, ...added];
      const layak = await referensiLayak(semua);
      if (layak.length === 0) {
        const metaBaru = await Promise.all(added.map((rel) => bacaMetaGambar(rel)));
        const sebab = metaBaru.find((meta) => meta && !meta.layakReferensi)?.alasan
          ?? "Belum ada foto produk yang bisa dipakai jadi acuan.";
        throw ERR.BAD_REQUEST(
          `${sebab} Butuh minimal satu foto produk polos supaya videonya punya acuan yang benar.`,
          "No reference-eligible product photo."
        );
      }
    } catch (referenceError) {
      await rejectAfterReferenceCheck("E8", added, referenceError);
    }
    let images: string[] | null;
    try {
      images = await dependencies.pgAppendOrgProductImages(membership.org_id, id, owned.images, added, MAX_IMAGES);
    } catch (error) {
      await deleteStoredProductImages(added);
      throw error;
    }
    if (!images) {
      return await rejectAfterReferenceCheck(
        "E8",
        added,
        ERR.BAD_REQUEST(
          "Daftar fotonya baru saja berubah. Muat ulang lalu coba lagi; maksimal 8 foto.",
          "Concurrent photo update rejected."
        )
      );
    }
    // Telemetry must never turn a committed upload into a visible 500 that
    // invites a duplicate retry.
    void dependencies.pgAudit(user.id, "product.photos_added", "products", id, { org_id: membership.org_id, added: added.length, total: images.length })
      .catch((error) => console.error("[audit] product.photos_added failed:", error));
    return Response.json({ product_id: id, images, image_urls: images.map((image) => createSignedUrl(image)) });
    } finally {
      releaseUpload();
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    await assertDashboardRate("photo", membership.org_id);
    const { id } = await ctx.params;
    const owned = await orgProduct(membership.org_id, id);
    const body = await req.json().catch(() => ({}));
    const target = String(body.path ?? "");
    if (!owned.images.includes(target)) throw ERR.NOT_FOUND("Fotonya");
    const { images, cleanupPending } = await withProductEvidenceMutationLock(id, async (lockClient) => {
      const images = await pgRemoveOrgProductImage(membership.org_id, id, target, lockClient);
      if (!images) throw ERR.NOT_FOUND("Fotonya");
      let cleanupPending = false;
      try { await deleteStoredProductImages([target]); }
      catch { cleanupPending = true; }
      return { images, cleanupPending };
    });
    void pgAudit(user.id, "product.photo_removed", "products", id, { org_id: membership.org_id, removed: target, total: images.length })
      .catch((error) => console.error("[audit] product.photo_removed failed:", error));
    return Response.json({ product_id: id, images, image_urls: images.map((image) => createSignedUrl(image)), cleanup_failed: cleanupPending });
  } catch (error) {
    return errorResponse(error);
  }
}
