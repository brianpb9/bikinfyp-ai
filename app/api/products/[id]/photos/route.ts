import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, audit, type ProductRow } from "@/lib/db";
import { createSignedUrl } from "@/lib/signed-url";
import { ALLOWED_MIME, MAX_IMAGES, MAX_IMAGE_BYTES, saveProductImages, sniffMime, verifyDecodableImage } from "@/lib/product-images";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/products/[id]/photos — TAMBAH foto ke produk yang sudah ada
// (multipart field "photos"), maks total 5. Dipakai kartu konfirmasi S2 saat
// foto dari link gagal/kurang — sebelum 2026-08-06 kartu konfirmasi tidak
// punya jalur upload sama sekali dan user buntu.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (postgresRuntimeEnabled())
      throw ERR.BAD_REQUEST("Tambah foto belum tersedia di lingkungan ini.", "photo append not available on postgres runtime yet.");
    const { id } = await ctx.params;
    const db = getDb();
    const product = db.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(id, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Produknya");

    const existing = JSON.parse(product.images || "[]") as string[];
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

    const added = await saveProductImages(id, blobs, existing.length);
    const images = [...existing, ...added];
    db.prepare("UPDATE products SET images = ? WHERE id = ?").run(JSON.stringify(images), id);
    audit(user.id, "product.photos_added", "products", id, { added: added.length, total: images.length });
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
// (keputusan Brian 2026-08-06: foto hasil ekstrak harus bisa di-X kalau tidak
// dipakai — mis. banner toko yang ikut terunduh). File storage dibiarkan
// (best-effort orphan; path tetap privat di balik signed URL + owner check).
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (postgresRuntimeEnabled())
      throw ERR.BAD_REQUEST("Hapus foto belum tersedia di lingkungan ini.", "photo delete not available on postgres runtime yet.");
    const { id } = await ctx.params;
    const db = getDb();
    const product = db.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(id, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Produknya");

    const body = await req.json().catch(() => ({}));
    const target = String(body.path ?? "");
    const existing = JSON.parse(product.images || "[]") as string[];
    if (!existing.includes(target)) throw ERR.NOT_FOUND("Fotonya");
    const images = existing.filter((p) => p !== target);
    db.prepare("UPDATE products SET images = ? WHERE id = ?").run(JSON.stringify(images), id);
    audit(user.id, "product.photo_removed", "products", id, { removed: target, total: images.length });
    return Response.json({
      product_id: id,
      images,
      image_urls: images.map((rel) => createSignedUrl(rel)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
