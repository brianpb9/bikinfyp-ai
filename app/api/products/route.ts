import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit } from "@/lib/db";
import { config, ensureDirs } from "@/lib/config";
import { mediaStorage } from "@/lib/storage";
import { validPriceIdr, validProductName } from "@/lib/product-validation";
import { postgresRuntimeEnabled, smokeCreateProduct } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // NF-SEC09

async function verifyDecodableImage(data: Buffer, mime: string): Promise<boolean> {
  // Magic bytes saja masih bisa dipalsukan. `sharp` memverifikasi struktur
  // decoder di proses Node web, sehingga staging native tidak bergantung pada
  // Python/Pillow (yang memang hanya kontrak container worker).
  try {
    const info = await sharp(data, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    return Boolean(info.width && info.height);
  } catch {
    return false;
  }
}

function sniffMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  return null;
}

async function saveImages(productId: string, blobs: { mime: string; data: Buffer }[]): Promise<string[]> {
  ensureDirs();
  const dir = path.join(config.storageDir, "uploads", productId);
  fs.mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const ext = ALLOWED_MIME[blobs[i].mime] ?? ".png";
    let rel = path.join("uploads", productId, `${i}${ext}`).split(path.sep).join("/");
    let abs = path.join(config.storageDir, rel);
    let normalized: Buffer | null = null;
    // Normalisasi sisi panjang ≤1600px ke WebP (BR-01.5): hemat kuota upload
    // ke model tanpa mengandalkan CSS untuk mengecilkan byte foto kamera. Ini
    // sengaja memakai sharp agar web Render native tidak membutuhkan Pillow.
    try {
      normalized = await sharp(blobs[i].data, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      rel = path.join("uploads", productId, `${i}.webp`).split(path.sep).join("/");
      abs = path.join(config.storageDir, rel);
    } catch {
      /* kompresi gagal tidak fatal — file asli tetap dipakai */
    }
    fs.writeFileSync(abs, normalized ?? blobs[i].data);
    await mediaStorage().put(rel, fs.readFileSync(abs), rel.endsWith(".webp") ? "image/webp" : blobs[i].mime);
    if (config.storageMode === "r2") fs.rmSync(abs, { force: true });
    rels.push(rel);
  }
  return rels;
}

// POST /api/products — input manual: name, price_idr, category + 1-5 foto
// (multipart form-data: field "photos"; atau JSON: images_base64[]).
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    let name = "", priceRaw: unknown = "", category = "default", sourceUrl: string | null = null;
    let visualDesc: string | null = null;
    const blobs: { mime: string; data: Buffer }[] = [];

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      name = String(form.get("name") ?? "").trim();
      priceRaw = form.get("price_idr");
      category = String(form.get("category") ?? "default").trim();
      visualDesc = form.get("product_visual_desc") ? String(form.get("product_visual_desc")).slice(0, 200) : null;
      sourceUrl = form.get("source_url") ? String(form.get("source_url")) : null;
      for (const part of form.getAll("photos")) {
        if (part instanceof File && part.size > 0) {
          if (part.size > MAX_BYTES)
            throw ERR.BAD_REQUEST("Fotonya kebesaran — maksimal 10 MB per foto ya.", "Image exceeds 10 MB.");
          blobs.push({ mime: part.type, data: Buffer.from(await part.arrayBuffer()) });
        }
      }
    } else {
      const body = await req.json().catch(() => ({}));
      name = String(body.name ?? "").trim();
      priceRaw = body.price_idr;
      category = String(body.category ?? "default").trim();
      visualDesc = body.product_visual_desc ? String(body.product_visual_desc).slice(0, 200) : null;
      sourceUrl = body.source_url ? String(body.source_url) : null;
      const b64: string[] = Array.isArray(body.images_base64) ? body.images_base64 : [];
      for (const item of b64) {
        const m = String(item).match(/^data:([\w/+.-]+);base64,(.+)$/);
        const mime = m?.[1] ?? "image/png";
        const data = Buffer.from(m?.[2] ?? String(item), "base64");
        if (data.length > MAX_BYTES)
          throw ERR.BAD_REQUEST("Fotonya kebesaran — maksimal 10 MB per foto ya.", "Image exceeds 10 MB.");
        blobs.push({ mime, data });
      }
    }

    const validName = validProductName(name);
    const priceIdr = validPriceIdr(priceRaw);
    if (!validName)
      throw ERR.BAD_REQUEST("Nama produk wajib ada huruf atau angka, bukan emoji saja ya.", "Product name is required.");
    if (!priceIdr)
      throw ERR.BAD_REQUEST("Harganya wajib diisi — harga adalah bahan wajib hook videonya.", "Price is required.");
    if (blobs.length < 1 || blobs.length > MAX_IMAGES)
      throw ERR.BAD_REQUEST("Upload fotonya dulu ya — minimal 1, maksimal 5 foto.", "1-5 images required.");

    // Validasi MIME nyata dari magic bytes (NF-SEC09)
    // Fresh disposable smoke/storage has no directory yet; create it before
    // mkdtemp verification (saveImages also calls this, but later).
    ensureDirs();
    for (const b of blobs) {
      const sniffed = sniffMime(b.data);
      if (!sniffed || !ALLOWED_MIME[sniffed])
        throw ERR.BAD_REQUEST("File-nya bukan gambar yang valid. Pakai PNG/JPG/WebP ya.", "Invalid image file.");
      if (!(await verifyDecodableImage(b.data, sniffed)))
        throw ERR.BAD_REQUEST("File gambarnya rusak atau bukan foto utuh. Coba upload foto lain ya.", "Corrupt image file.");
      b.mime = sniffed;
    }

    const id = uuid();
    const images = await saveImages(id, blobs);
    if (postgresRuntimeEnabled()) {
      await smokeCreateProduct(user.id, { sourceUrl, name: validName, priceIdr, category, productVisualDesc: visualDesc, images }, id);
    } else {
      getDb()
        .prepare(
          "INSERT INTO products (id, user_id, source_url, name, price_idr, category, product_visual_desc, images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
        )
        .run(id, user.id, sourceUrl, validName, priceIdr, category, visualDesc, JSON.stringify(images), null, now());
      audit(user.id, "product.created", "products", id, { name: validName, category });
    }

    return Response.json({ product_id: id, name: validName, price_idr: priceIdr, category, images }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
