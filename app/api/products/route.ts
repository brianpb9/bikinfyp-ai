import { ERR, errorResponse } from "@/lib/errors";
import { ensureDirs } from "@/lib/config";
import { validBrand, validPriceIdr, validProductName } from "@/lib/product-validation";
import { ALLOWED_MIME, MAX_IMAGES, MAX_IMAGE_BYTES, saveProductImages, sniffMime, verifyDecodableImage } from "@/lib/product-images";
import { parsePromoFields } from "@/lib/promo";
import { productCreateDependencies } from "@/lib/product-create-dependencies";
import { rejectAfterReferenceCheck } from "@/lib/reference-rejection-rollback";
import { merekTerdaftar, periksaLabelFoto } from "@/lib/media/label-terbaca";
import { resolveApprovedReference, pesanTanpaReferensi } from "@/lib/product-truth";
import { GagalTanpaReferensi } from "@/lib/kanari-bukti";
import { PgProductCreateFailure } from "@/lib/postgres/product-persona-script";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/products — input manual: name, price_idr, category + 1-5 foto
// (multipart form-data: field "photos"; atau JSON: images_base64[]).
export async function POST(req: Request) {
  try {
    const dependencies = productCreateDependencies();
    const user = await dependencies.getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    let name = "", priceRaw: unknown = "", category = "default", sourceUrl: string | null = null;
    let visualDesc: string | null = null;
    // Merek terkonfirmasi user (audit C9) — sumber gerbang kesetiaan merek QC-F1.
    let brandRaw: unknown = undefined;
    let promoGet: (k: string) => unknown = () => undefined;
    const blobs: { mime: string; data: Buffer }[] = [];

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      name = String(form.get("name") ?? "").trim();
      priceRaw = form.get("price_idr");
      category = String(form.get("category") ?? "default").trim();
      visualDesc = form.get("product_visual_desc") ? String(form.get("product_visual_desc")).slice(0, 200) : null;
      brandRaw = form.get("brand") ?? undefined;
      sourceUrl = form.get("source_url") ? String(form.get("source_url")) : null;
      promoGet = (k) => form.get(k) ?? undefined;
      for (const part of form.getAll("photos")) {
        if (part instanceof File && part.size > 0) {
          if (part.size > MAX_IMAGE_BYTES)
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
      brandRaw = body.brand;
      sourceUrl = body.source_url ? String(body.source_url) : null;
      promoGet = (k) => (body as Record<string, unknown>)[k];
      const b64: string[] = Array.isArray(body.images_base64) ? body.images_base64 : [];
      for (const item of b64) {
        const m = String(item).match(/^data:([\w/+.-]+);base64,(.+)$/);
        const mime = m?.[1] ?? "image/png";
        const data = Buffer.from(m?.[2] ?? String(item), "base64");
        if (data.length > MAX_IMAGE_BYTES)
          throw ERR.BAD_REQUEST("Fotonya kebesaran — maksimal 10 MB per foto ya.", "Image exceeds 10 MB.");
        blobs.push({ mime, data });
      }
    }

    const validName = validProductName(name);
    const priceIdr = validPriceIdr(priceRaw);
    const promo = parsePromoFields(promoGet);
    if (promo.promoPriceBeforeIdr !== null && priceIdr && promo.promoPriceBeforeIdr <= priceIdr)
      throw ERR.BAD_REQUEST(
        "Harga normal (sebelum diskon) harus lebih besar dari harga jual — kalau tidak, diskonnya bohong.",
        "promo_price_before_idr must exceed price_idr."
      );
    if (!validName)
      throw ERR.BAD_REQUEST("Nama produk wajib ada huruf atau angka, bukan emoji saja ya.", "Product name is required.");
    if (!priceIdr)
      throw ERR.BAD_REQUEST("Harganya wajib diisi — harga adalah bahan wajib hook videonya.", "Price is required.");
    if (blobs.length < 1 || blobs.length > MAX_IMAGES)
      throw ERR.BAD_REQUEST(`Upload fotonya dulu ya — minimal 1, maksimal ${MAX_IMAGES} foto.`, `1-${MAX_IMAGES} images required.`);

    // Validasi MIME nyata dari magic bytes (NF-SEC09)
    // Fresh disposable smoke/storage has no directory yet; create it before
    // mkdtemp verification (saveImages also calls this, but later).
    ensureDirs();
    for (const b of blobs) {
      const sniffed = sniffMime(b.data);
      if (!sniffed || !ALLOWED_MIME[sniffed])
        throw ERR.BAD_REQUEST("File-nya bukan gambar yang valid. Pakai PNG/JPG/WebP ya.", "Invalid image file.");
      if (!(await verifyDecodableImage(b.data)))
        throw ERR.BAD_REQUEST("File gambarnya rusak atau bukan foto utuh. Coba upload foto lain ya.", "Corrupt image file.");
      b.mime = sniffed;
    }

    // raw_meta.brand: alamat fallback yang dibaca merekTepercaya() (worker) —
    // kolom products.brand (migrasi 0033, sesi lain) menang begitu di-land.
    const brand = validBrand(brandRaw);
    const rawMeta = brand ? { brand } : null;
    const brandTerdaftar = merekTerdaftar({ raw_meta: rawMeta ? JSON.stringify(rawMeta) : null });

    // E1 must apply the same gate as E4/E8 to every normalized upload before
    // any storage or product-row publication. OCR execution failures retain
    // the existing fail-open policy inside periksaLabelFoto; this route does
    // not invent C6 policy.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e1-intake-label-"));
    try {
      for (const [index, blob] of blobs.entries()) {
        const tmpFile = path.join(tmpDir, `foto-${index}`);
        fs.writeFileSync(tmpFile, blob.data);
        const label = await periksaLabelFoto(tmpFile, validName, brandTerdaftar);
        if (!label.terbaca) throw ERR.LABEL_UNREADABLE(label.alasan);
        if (label.cocokMerek === false) throw ERR.BRAND_MISMATCH(label.alasan);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const id = dependencies.uuid();
    const images = await saveProductImages(id, blobs);
    const usePostgres = dependencies.postgresRuntimeEnabled();
    const expectedCreation = {
      id,
      userId: user.id,
      sourceUrl,
      name: validName,
      priceIdr,
      category,
      productVisualDesc: visualDesc,
      images,
      promoPriceBeforeIdr: promo.promoPriceBeforeIdr,
      promoEndsAt: promo.promoEndsAt,
      promoStockLeft: promo.promoStockLeft,
      rawMeta,
    };
    const resolution = await resolveApprovedReference(images).catch((resolutionError) =>
      // Resolver infrastructure errors are known to occur before DB create.
      rejectAfterReferenceCheck("E1", images, resolutionError)
    );
    if (!resolution.utama) {
      await rejectAfterReferenceCheck(
        "E1",
        images,
        new GagalTanpaReferensi(pesanTanpaReferensi(resolution), resolution),
      );
    }

    try {
      if (usePostgres) {
        await dependencies.smokeCreateProduct(user.id, { sourceUrl, name: validName, priceIdr, category, productVisualDesc: visualDesc, images, rawMeta, ...promo }, id);
      } else {
        dependencies.getDb()
          .prepare(
            "INSERT INTO products (id, user_id, source_url, name, price_idr, category, product_visual_desc, images, promo_price_before_idr, promo_ends_at, promo_stock_left, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
          )
          .run(id, user.id, sourceUrl, validName, priceIdr, category, visualDesc, JSON.stringify(images), promo.promoPriceBeforeIdr, promo.promoEndsAt, promo.promoStockLeft, rawMeta ? JSON.stringify(rawMeta) : null, dependencies.now());
      }
    } catch (creationError) {
      // A DB exception may mean COMMIT succeeded and only its
      // acknowledgement failed. Deleting storage in that state would leave a
      // durable row pointing at missing objects, so reconcile exact ID+owner+
      // immutable create data before deciding whether deletion is safe.
      let reconciliation: Awaited<ReturnType<typeof dependencies.reconcileProductCreation>>;
      try {
        reconciliation = await dependencies.reconcileProductCreation(expectedCreation, usePostgres);
      } catch (reconciliationError) {
        throw new Error(
          `E1 product create outcome unknown for ${id}; newly stored references were retained. ` +
          `Persistence failure: ${(creationError as Error).message}. ` +
          `Reconciliation failure: ${(reconciliationError as Error).message}`,
          { cause: reconciliationError },
        );
      }
      if (reconciliation === "absent") {
        const postgresRollbackProven =
          creationError instanceof PgProductCreateFailure
          && !creationError.commitAttempted
          && creationError.rollbackSucceeded;
        if (!usePostgres || postgresRollbackProven) {
          await rejectAfterReferenceCheck("E1", images, creationError);
        }
        throw new Error(
          `E1 PostgreSQL product create outcome unknown for ${id}; reconciliation observed no row, ` +
          `but references were retained because COMMIT may have been attempted or pre-COMMIT rollback was not proven.`,
          { cause: creationError },
        );
      }
      if (reconciliation === "mismatch") {
        throw new Error(
          `E1 product create reconciliation mismatch for ${id}; newly stored references were retained because the durable row does not exactly match owner and immutable create data.`,
          { cause: creationError },
        );
      }
      // exact = the transaction committed despite its failed acknowledgement.
      // Continue as success; SQLite's audit is completed idempotently below.
    }
    if (!usePostgres) {
      dependencies.auditProductCreatedOnce(user.id, id, { name: validName, category, brand: brand ?? null, promo: promo.promoPriceBeforeIdr !== null });
    }

    return Response.json({ product_id: id, name: validName, price_idr: priceIdr, category, images }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
