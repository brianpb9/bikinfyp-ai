import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, audit, type ProductRow } from "@/lib/db";
import { createSignedUrl } from "@/lib/signed-url";
import { ALLOWED_MIME, MAX_IMAGES, MAX_IMAGE_BYTES, saveProductImages, sniffMime, verifyDecodableImage } from "@/lib/product-images";
import { pgAudit, pgSetProductImages, postgresRuntimeEnabled, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { periksaLabelFoto } from "@/lib/media/label-terbaca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ambil produk milik user + daftar fotonya, lintas runtime (fix 2026-08-06
// malam: versi awal menggembok pg -> tombol tambah/hapus foto MATI di
// production yang memang Postgres).
async function ownedProduct(userId: string, productId: string): Promise<{ product: ProductRow; images: string[] } | null> {
  const product = postgresRuntimeEnabled()
    ? await smokeGetProduct(userId, productId)
    : (getDb().prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(productId, userId) as ProductRow | undefined);
  if (!product) return null;
  // Produk organisasi WAJIB lewat dashboard (RBAC belanja + gerbang review
  // scene + library org). Lihat pastikanBukanProdukOrg.
  pastikanBukanProdukOrg(product);
  return { product, images: JSON.parse(product.images || "[]") as string[] };
}

async function persistImages(userId: string, productId: string, images: string[]): Promise<void> {
  if (postgresRuntimeEnabled()) await pgSetProductImages(userId, productId, images);
  else getDb().prepare("UPDATE products SET images = ? WHERE id = ?").run(JSON.stringify(images), productId);
}

async function auditBoth(userId: string, action: string, productId: string, meta: Record<string, unknown>): Promise<void> {
  if (postgresRuntimeEnabled()) await pgAudit(userId, action, "products", productId, meta);
  else audit(userId, action, "products", productId, meta);
}

// POST /api/products/[id]/photos — TAMBAH foto ke produk yang sudah ada
// (multipart field "photos"), maks total 5. Dipakai kartu konfirmasi S2 saat
// foto dari link gagal/kurang.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const owned = await ownedProduct(user.id, id);
    if (!owned) throw ERR.NOT_FOUND("Produknya");
    const existing = owned.images;

    const form = await req.formData();
    const blobs: { mime: string; data: Buffer }[] = [];
    for (const part of form.getAll("photos")) {
      if (part instanceof File && part.size > 0) {
        if (part.size > MAX_IMAGE_BYTES)
          throw ERR.BAD_REQUEST("Fotonya kebesaran — maksimal 10 MB per foto ya.", "Image exceeds 10 MB.");
        blobs.push({ mime: part.type, data: Buffer.from(await part.arrayBuffer()) });
      }
    }
    if (blobs.length === 0) throw ERR.BAD_REQUEST("Tidak ada foto yang dikirim.", "No photos in request.");
    if (existing.length + blobs.length > MAX_IMAGES)
      throw ERR.BAD_REQUEST(`Total foto maksimal ${MAX_IMAGES} — produk ini sudah punya ${existing.length}.`, "Too many photos.");

    for (const b of blobs) {
      const sniffed = sniffMime(b.data);
      if (!sniffed || !ALLOWED_MIME[sniffed])
        throw ERR.BAD_REQUEST("File-nya bukan gambar yang valid. Pakai PNG/JPG/WebP ya.", "Invalid image file.");
      if (!(await verifyDecodableImage(b.data)))
        throw ERR.BAD_REQUEST("File gambarnya rusak atau bukan foto utuh. Coba upload foto lain ya.", "Corrupt image file.");
      b.mime = sniffed;
    }

    // GERBANG LABEL — sebelum foto disimpan, jauh sebelum kredit ditahan.
    //
    // QC-10 memeriksa label di VIDEO HASIL, yaitu setelah provider dibayar.
    // Kalau foto sumbernya sendiri tidak terbaca, videonya tidak akan pernah
    // lolos, dan penggunanya membayar untuk kegagalan yang sudah bisa
    // diketahui di sini.
    //
    // Diperiksa hanya untuk foto PERTAMA produk (yang jadi referensi utama);
    // foto tambahan boleh berupa sudut lain yang labelnya tidak menghadap.
    if (existing.length === 0 && blobs[0]) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "intake-label-"));
      const tmpFile = path.join(tmpDir, "foto");
      try {
        fs.writeFileSync(tmpFile, blobs[0].data);
        const label = await periksaLabelFoto(tmpFile, owned.product.name);
        if (!label.terbaca) throw ERR.BAD_REQUEST(label.alasan!, "Product label not OCR-readable.");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    const added = await saveProductImages(id, blobs, existing.length);
    const images = [...existing, ...added];
    await persistImages(user.id, id, images);
    await auditBoth(user.id, "product.photos_added", id, { added: added.length, total: images.length });
    return Response.json({
      product_id: id,
      images,
      image_urls: images.map((rel) => createSignedUrl(rel)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/products/[id]/photos {path} — buang satu foto dari produk
// (tombol ✕ di S2). File storage dibiarkan (orphan best-effort; path tetap
// privat di balik signed URL + owner check).
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const owned = await ownedProduct(user.id, id);
    if (!owned) throw ERR.NOT_FOUND("Produknya");

    const body = await req.json().catch(() => ({}));
    const target = String(body.path ?? "");
    if (!owned.images.includes(target)) throw ERR.NOT_FOUND("Fotonya");
    const images = owned.images.filter((p) => p !== target);
    await persistImages(user.id, id, images);
    await auditBoth(user.id, "product.photo_removed", id, { removed: target, total: images.length });
    return Response.json({
      product_id: id,
      images,
      image_urls: images.map((rel) => createSignedUrl(rel)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
