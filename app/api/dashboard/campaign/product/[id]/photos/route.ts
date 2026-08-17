import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { createSignedUrl } from "@/lib/signed-url";
import { ALLOWED_MIME, MAX_IMAGES, MAX_IMAGE_BYTES, deleteStoredProductImages, saveUniqueProductImages, sniffMime, verifyDecodableImage } from "@/lib/product-images";
import { periksaLabelFoto } from "@/lib/media/label-terbaca";
import { pgAppendOrgProductImages, pgAudit, pgRemoveOrgProductImage, postgresRuntimeEnabled, smokeGetOrgProduct } from "@/lib/postgres/smoke-runtime";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";
import { acquirePhotoUploadSlot, readSinglePhotoMultipart } from "@/lib/capped-form-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Request.formData() buffers by design. Bound the stream ourselves first so a
// chunked multipart request cannot bypass Content-Length and exhaust memory.
const MAX_PHOTO_REQUEST_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;

async function orgProduct(orgId: string, productId: string) {
  const product = await smokeGetOrgProduct(orgId, productId);
  if (!product) throw ERR.NOT_FOUND("Produknya");
  return { product, images: JSON.parse(product.images || "[]") as string[] };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    await assertDashboardRate("photo", membership.org_id);
    const { id } = await ctx.params;
    const owned = await orgProduct(membership.org_id, id);
    const releaseUpload = await acquirePhotoUploadSlot(2, req.signal);
    try {
    const blob = await readSinglePhotoMultipart(req, { maxRequestBytes: MAX_PHOTO_REQUEST_BYTES, maxFileBytes: MAX_IMAGE_BYTES, signal: req.signal, idleTimeoutMs: 15_000, totalTimeoutMs: 30_000 });
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

    if (!owned.images.length && blobs[0]) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "org-intake-label-"));
      const tmpFile = path.join(tmpDir, "foto");
      try {
        fs.writeFileSync(tmpFile, blobs[0].data);
        const label = await periksaLabelFoto(tmpFile, owned.product.name);
        if (!label.terbaca) throw ERR.BAD_REQUEST(label.alasan!, "Product label not OCR-readable.");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    const added = await saveUniqueProductImages(id, blobs);
    let images: string[] | null;
    try {
      images = await pgAppendOrgProductImages(membership.org_id, id, added, MAX_IMAGES);
    } catch (error) {
      await deleteStoredProductImages(added);
      throw error;
    }
    if (!images) {
      await deleteStoredProductImages(added);
      throw ERR.BAD_REQUEST("Daftar fotonya baru saja berubah. Muat ulang lalu coba lagi; maksimal 8 foto.", "Concurrent photo update rejected.");
    }
    // Telemetry must never turn a committed upload into a visible 500 that
    // invites a duplicate retry.
    void pgAudit(user.id, "product.photos_added", "products", id, { org_id: membership.org_id, added: added.length, total: images.length })
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
    const images = await pgRemoveOrgProductImage(membership.org_id, id, target);
    if (!images) throw ERR.NOT_FOUND("Fotonya");
    let cleanupPending = false;
    try { await deleteStoredProductImages([target]); }
    catch { cleanupPending = true; }
    void pgAudit(user.id, "product.photo_removed", "products", id, { org_id: membership.org_id, removed: target, total: images.length })
      .catch((error) => console.error("[audit] product.photo_removed failed:", error));
    return Response.json({ product_id: id, images, image_urls: images.map((image) => createSignedUrl(image)), cleanup_failed: cleanupPending });
  } catch (error) {
    return errorResponse(error);
  }
}
