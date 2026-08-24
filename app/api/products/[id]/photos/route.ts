import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, audit, type ProductRow } from "@/lib/db";
import { createSignedUrl } from "@/lib/signed-url";
import { ALLOWED_MIME, MAX_IMAGES, MAX_IMAGE_BYTES, deleteStoredProductImages, saveUniqueProductImages, sniffMime, verifyDecodableImage } from "@/lib/product-images";
import { pgAudit, postgresRuntimeEnabled, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { periksaLabelFoto, merekTerdaftar } from "@/lib/media/label-terbaca";
import { referensiLayak, bacaMetaGambar } from "@/lib/product-images";
import { appendRetailProductImages, removeRetailProductImage } from "@/lib/retail-product-images";

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
    // SETIAP blob baru diperiksa sebelum satu pun byte/sidecar/list/audit
    // dipersist. Foto #2+ tidak boleh menjadi jalan memutar gerbang merek.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "intake-label-"));
    try {
      for (const [index, blob] of blobs.entries()) {
        const tmpFile = path.join(tmpDir, `foto-${index}`);
        fs.writeFileSync(tmpFile, blob.data);
        // Merek TERDAFTAR ikut — sumber yang sama dengan QC-F1
        // (products.raw_meta.brand), bukan tebakan dari nama produk.
        const label = await periksaLabelFoto(tmpFile, owned.product.name, merekTerdaftar(owned.product));
        if (!label.terbaca) throw ERR.BAD_REQUEST(label.alasan!, "Product label not OCR-readable.");
        // LUBANG YANG DITUTUP 20 Agu: sampai hari itu hasil kecocokan merek
        // dihitung lalu DIBUANG — hanya `terbaca` yang diperiksa. Karena itu
        // foto AI berlabel "bdodpgeer" lolos jadi referensi dan ikut ke lima
        // render berbayar. Label yang terbaca tapi bukan merek penjualnya
        // sendiri bukan foto produknya.
        if (label.cocokMerek === false) {
          throw ERR.BAD_REQUEST(label.alasan!, "Product label does not match the registered brand.");
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // UUID keys avoid object overwrite when two uploads observed the same
    // starting list length. Publication into the list remains atomic below.
    const added = await saveUniqueProductImages(id, blobs);

    // WIZARD BUTUH MINIMAL SATU FOTO PRODUK YANG LAYAK JADI ACUAN.
    //
    // Grafis promosi boleh disimpan di pustaka — penjual memang memakainya
    // untuk hal lain — tapi ia tidak pernah jadi referensi render. Yang
    // ditolak di sini keadaan "produk ini tidak punya SATU pun foto yang bisa
    // dipakai", karena itu berarti setiap render sesudahnya dijamin memakai
    // bahan yang salah.
    const semua = [...existing, ...added];
    const layak = await referensiLayak(semua);
    if (layak.length === 0) {
      const metaBaru = await Promise.all(added.map((rel) => bacaMetaGambar(rel)));
      const sebab = metaBaru.find((m) => m && !m.layakReferensi)?.alasan
        ?? "Belum ada foto produk yang bisa dipakai jadi acuan.";
      throw ERR.BAD_REQUEST(
        `${sebab} Butuh minimal satu foto produk polos supaya videonya punya acuan yang benar.`,
        "No reference-eligible product photo."
      );
    }
    const images = await appendRetailProductImages(user.id, id, added, MAX_IMAGES);
    if (!images) {
      await deleteStoredProductImages(added);
      throw ERR.BAD_REQUEST("Daftar fotonya baru saja berubah. Muat ulang lalu coba lagi; maksimal 8 foto.", "Concurrent photo update rejected.");
    }
    // Telemetry pasca-commit tidak boleh menghasilkan false 500 dan mengundang
    // retry yang menggandakan mutasi.
    void auditBoth(user.id, "product.photos_added", id, { added: added.length, total: images.length })
      .catch((error) => console.error("[audit] product.photos_added failed:", error));
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
// (tombol ✕ di S2). Daftar DB dipersist DULU, baru foto+sidecar dibersihkan
// best-effort. Kegagalan cleanup tidak boleh menghidupkan lagi entry yang sudah
// dihapus dari daftar; client mendapat flag yang sama dengan jalur org E9.
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
    const images = await removeRetailProductImage(user.id, id, target);
    if (!images) throw ERR.NOT_FOUND("Fotonya");
    let cleanupPending = false;
    try { await deleteStoredProductImages([target]); }
    catch { cleanupPending = true; }
    void auditBoth(user.id, "product.photo_removed", id, { removed: target, total: images.length })
      .catch((error) => console.error("[audit] product.photo_removed failed:", error));
    return Response.json({
      product_id: id,
      images,
      image_urls: images.map((rel) => createSignedUrl(rel)),
      cleanup_failed: cleanupPending,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
