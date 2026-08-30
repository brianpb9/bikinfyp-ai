import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.STORAGE_MODE = "filesystem";
process.env.DB_PATH = path.join(os.tmpdir(), `racun-retail-label-e4-${process.pid}.db`);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "retail-label-e4-store-"));

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone, issueToken, cookieName } = await import("../lib/auth");
const { setMediaStorageForTests } = await import("../lib/storage");
const { setProductImageClassifierForTests } = await import("../lib/product-images");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
const { POST: addRetailPhotos } = await import("../app/api/products/[id]/photos/route");
type MediaStorage = import("../lib/storage").MediaStorage;
type HasilLabel = import("../lib/media/label-terbaca").HasilLabel;

const db = getDb();
const user = findOrCreateUserByPhone("081200000084");
const token = await issueToken(user.id, user.phone ?? "");

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  putCalls: string[] = [];
  deleteCalls: string[] = [];
  failGetKeys = new Set<string>();
  failDelete: ((key: string) => boolean) | undefined;
  async put(key: string, body: Buffer) { this.putCalls.push(key); this.values.set(key, Buffer.from(body)); }
  async delete(key: string) {
    this.deleteCalls.push(key);
    if (this.failDelete?.(key)) throw new Error(`controlled delete failure: ${key}`);
    this.values.delete(key);
  }
  async get(key: string) {
    if (this.failGetKeys.has(key)) throw new Error(`controlled resolver failure: ${key}`);
    const body = this.values.get(key); return body ? { body: Buffer.from(body), size: body.length } : null;
  }
  async stat(key: string) { const body = this.values.get(key); return body ? { size: body.length } : null; }
  async materialize() { return null; }
}

after(() => {
  setPeriksaLabelFotoForTests(undefined);
  setProductImageClassifierForTests(undefined);
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

const LABEL_VALID: HasilLabel = {
  terbaca: true, kata: ["Merek", "Terdaftar"], cocokNama: true, cocokMerek: true,
};

function createProduct(label: string): { id: string; existing: string[] } {
  const id = uuid();
  const existing = [`uploads/${id}/existing.webp`];
  db.prepare(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,raw_meta,created_at) VALUES (?,?,?,85000,'beauty',?,?,?)"
  ).run(id, user.id, `Serum ${label}`, JSON.stringify(existing), JSON.stringify({ brand: "Merek Terdaftar" }), now());
  return { id, existing };
}

function imagesFor(productId: string): string[] {
  const row = db.prepare("SELECT images FROM products WHERE id=?").get(productId) as { images: string };
  return JSON.parse(row.images) as string[];
}

function auditCount(productId: string): number {
  return (db.prepare(
    "SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='product.photos_added'"
  ).get(productId) as { n: number }).n;
}

async function requestAdd(productId: string, photos: Buffer[]) {
  const form = new FormData();
  photos.forEach((photo, index) => {
    const bytes = new Uint8Array(photo.length); bytes.set(photo);
    form.append("photos", new File([bytes], `photo-${index}.png`, { type: "image/png" }));
  });
  return addRetailPhotos(new Request(`http://localhost/api/products/${productId}/photos`, {
    method: "POST", headers: { cookie: `${cookieName()}=${encodeURIComponent(token)}` }, body: form,
  }), { params: Promise.resolve({ id: productId }) });
}

test("E4 exported POST memeriksa setiap foto tambahan dan menolak batch secara atomik", async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#16a34a" } }).png().toBuffer();
  setProductImageClassifierForTests(async () => ({
    jenis: "product_photo", layakReferensi: true, rasioAreaTeks: 0.001, jumlahKata: 2, alasan: "fixture produk",
  }));

  const run = async (label: string, verdicts: HasilLabel[], expectedStatus: number) => {
    const product = createProduct(label);
    const storage = new MemoryStorage();
    setMediaStorageForTests(storage);
    const brands: Array<string | null | undefined> = [];
    const tempFiles: string[] = [];
    setPeriksaLabelFotoForTests(async (fotoPath, _productName, brand) => {
      tempFiles.push(fotoPath); brands.push(brand);
      return verdicts[tempFiles.length - 1] ?? LABEL_VALID;
    });
    const response = await requestAdd(product.id, verdicts.map(() => png));
    assert.equal(response.status, expectedStatus, `${label}: ${await response.clone().text()}`);
    assert.deepEqual(brands, verdicts.map(() => "Merek Terdaftar"), `${label}: brand tidak diteruskan per blob`);
    assert.ok(tempFiles.every((file) => !fs.existsSync(file) && !fs.existsSync(path.dirname(file))), `${label}: temp tidak bersih`);
    return { product, storage, response };
  };

  const accepted = await run("valid-additional", [LABEL_VALID, LABEL_VALID], 200);
  assert.equal(accepted.storage.putCalls.length, 4, "dua foto sah wajib menghasilkan dua bytes + dua sidecar");
  assert.equal(imagesFor(accepted.product.id).length, 3, "foto #2+ produk existing tidak ditambahkan");

  const unreadableFirst = await run("unreadable-first", [{
    terbaca: false, kata: [], cocokNama: false, cocokMerek: null, alasan: "",
  }], 400);
  assert.deepEqual(await unreadableFirst.response.json(), {
    code: "LABEL_UNREADABLE",
    message_id: "Label produknya belum terbaca. Upload foto yang lebih terang dan fokus ya.",
    message_en: "Product label not OCR-readable.",
    retryable: false,
  });
  assert.deepEqual(imagesFor(unreadableFirst.product.id), unreadableFirst.product.existing);
  assert.deepEqual(unreadableFirst.storage.putCalls, []); assert.deepEqual(unreadableFirst.storage.deleteCalls, []);
  assert.equal(auditCount(unreadableFirst.product.id), 0);

  const unreadable = await run("unreadable-second", [LABEL_VALID, {
    terbaca: false, kata: [], cocokNama: false, cocokMerek: null, alasan: "foto kedua tidak terbaca",
  }], 400);
  assert.deepEqual(await unreadable.response.json(), {
    code: "LABEL_UNREADABLE", message_id: "foto kedua tidak terbaca",
    message_en: "Product label not OCR-readable.", retryable: false,
  });
  assert.deepEqual(imagesFor(unreadable.product.id), unreadable.product.existing);
  assert.deepEqual(unreadable.storage.putCalls, []); assert.deepEqual(unreadable.storage.deleteCalls, []);
  assert.equal(auditCount(unreadable.product.id), 0);

  const wrongBrandFirst = await run("wrong-brand-first", [{
    terbaca: true, kata: ["Merek", "Lain"], cocokNama: true, cocokMerek: false, alasan: " ",
  }], 400);
  assert.deepEqual(await wrongBrandFirst.response.json(), {
    code: "BRAND_MISMATCH",
    message_id: "Merek pada foto tidak cocok dengan merek produk. Upload foto produk dengan merek yang benar ya.",
    message_en: "Product label does not match the registered brand.",
    retryable: false,
  });
  assert.deepEqual(imagesFor(wrongBrandFirst.product.id), wrongBrandFirst.product.existing);
  assert.deepEqual(wrongBrandFirst.storage.putCalls, []); assert.deepEqual(wrongBrandFirst.storage.deleteCalls, []);
  assert.equal(auditCount(wrongBrandFirst.product.id), 0);

  const wrongBrand = await run("wrong-brand-second", [LABEL_VALID, {
    terbaca: true, kata: ["Merek", "Lain"], cocokNama: true, cocokMerek: false, alasan: "merek foto kedua salah",
  }], 400);
  assert.deepEqual(await wrongBrand.response.json(), {
    code: "BRAND_MISMATCH", message_id: "merek foto kedua salah",
    message_en: "Product label does not match the registered brand.", retryable: false,
  });
  assert.deepEqual(imagesFor(wrongBrand.product.id), wrongBrand.product.existing);
  assert.deepEqual(wrongBrand.storage.putCalls, []); assert.deepEqual(wrongBrand.storage.deleteCalls, []);
  assert.equal(auditCount(wrongBrand.product.id), 0);

  const mixedLaterInvalid = await run("mixed-later-invalid", [LABEL_VALID, LABEL_VALID, {
    terbaca: false, kata: [], cocokNama: false, cocokMerek: null, alasan: "foto terakhir tidak terbaca",
  }], 400);
  assert.deepEqual(await mixedLaterInvalid.response.json(), {
    code: "LABEL_UNREADABLE", message_id: "foto terakhir tidak terbaca",
    message_en: "Product label not OCR-readable.", retryable: false,
  });
  assert.deepEqual(imagesFor(mixedLaterInvalid.product.id), mixedLaterInvalid.product.existing);
  assert.deepEqual(mixedLaterInvalid.storage.putCalls, []); assert.deepEqual(mixedLaterInvalid.storage.deleteCalls, []);
  assert.equal(auditCount(mixedLaterInvalid.product.id), 0);
});

test("E4 rollback referensi membersihkan hanya object baru dan membuat kegagalan cleanup terlihat", async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#7c3aed" } }).png().toBuffer();
  setPeriksaLabelFotoForTests(async () => LABEL_VALID);

  const run = async (
    label: string,
    classifier: { jenis: "product_photo" | "promotional_graphic"; layakReferensi: boolean; rasioAreaTeks: number; jumlahKata: number; alasan: string },
    configure?: (storage: MemoryStorage, product: { id: string; existing: string[] }) => void
  ) => {
    const product = createProduct(label);
    const storage = new MemoryStorage();
    const unrelated = `uploads/unrelated-${product.id}/keep.webp`;
    storage.values.set(product.existing[0], Buffer.from("existing-object-must-survive"));
    storage.values.set(unrelated, Buffer.from("unrelated-object-must-survive"));
    configure?.(storage, product);
    setMediaStorageForTests(storage);
    setProductImageClassifierForTests(async () => classifier);
    const response = await requestAdd(product.id, [png]);
    const added = storage.putCalls.find((key) => !key.endsWith(".meta.json"));
    assert.ok(added, `${label}: ingestion tidak menulis foto baru`);
    return { product, storage, response, added, unrelated };
  };

  const promotional = {
    jenis: "promotional_graphic" as const,
    layakReferensi: false,
    rasioAreaTeks: 0.35,
    jumlahKata: 14,
    alasan: "grafis promosi tidak layak jadi acuan",
  };
  const rejected = await run("reference-rejected", promotional);
  assert.equal(rejected.response.status, 400, await rejected.response.clone().text());
  assert.equal((await rejected.response.json()).message_en, "No reference-eligible product photo.");
  assert.deepEqual(imagesFor(rejected.product.id), rejected.product.existing);
  assert.equal(auditCount(rejected.product.id), 0);
  assert.deepEqual(
    [...new Set(rejected.storage.deleteCalls)].sort(),
    [rejected.added, `${rejected.added}.meta.json`, `${rejected.added}.rights.json`, `${rejected.added}.rights.json.revoked.json`].sort(),
    "normal rejection wajib membersihkan exact foto baru + sidecar"
  );
  assert.deepEqual([...rejected.storage.values.keys()].sort(), [rejected.product.existing[0], rejected.unrelated].sort());

  const resolverLogs: unknown[][] = [];
  const consoleErrorBeforeResolver = console.error;
  console.error = (...args: unknown[]) => { resolverLogs.push(args); };
  let resolverError: Awaited<ReturnType<typeof run>>;
  try {
    resolverError = await run("resolver-error", promotional, (storage, product) => {
      storage.failGetKeys.add(`${product.existing[0]}.meta.json`);
    });
  } finally {
    console.error = consoleErrorBeforeResolver;
  }
  assert.equal(resolverError.response.status, 500, "resolver failure harus tetap non-success");
  assert.deepEqual(imagesFor(resolverError.product.id), resolverError.product.existing);
  assert.equal(auditCount(resolverError.product.id), 0);
  assert.deepEqual([...resolverError.storage.values.keys()].sort(), [resolverError.product.existing[0], resolverError.unrelated].sort());
  assert.ok(resolverLogs.some((args) => args.some((arg) => String(arg).includes("controlled resolver failure"))));

  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  let cleanupFailure: Awaited<ReturnType<typeof run>>;
  try {
    cleanupFailure = await run("cleanup-failure", promotional, (storage, product) => {
      storage.failDelete = (key) => key.startsWith(`uploads/${product.id}/`) && !key.endsWith(".meta.json") && key !== product.existing[0];
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(cleanupFailure.response.status, 500, "cleanup failure tidak boleh menyamar sebagai sukses atomik");
  assert.deepEqual(imagesFor(cleanupFailure.product.id), cleanupFailure.product.existing);
  assert.equal(auditCount(cleanupFailure.product.id), 0);
  assert.equal(cleanupFailure.storage.values.has(cleanupFailure.product.existing[0]), true);
  assert.equal(cleanupFailure.storage.values.has(cleanupFailure.unrelated), true);
  assert.equal(cleanupFailure.storage.values.has(cleanupFailure.added), true, "fault fixture wajib meninggalkan residual yang dilaporkan");
  assert.ok(
    logged.some((args) => args.some((arg) => String(arg).includes("residual storage objects may remain"))),
    "risiko residual cleanup tidak terlihat di log operator"
  );

  const accepted = await run("eligible-control", {
    jenis: "product_photo",
    layakReferensi: true,
    rasioAreaTeks: 0.001,
    jumlahKata: 2,
    alasan: "foto produk layak",
  });
  assert.equal(accepted.response.status, 200, await accepted.response.clone().text());
  assert.deepEqual(imagesFor(accepted.product.id), [...accepted.product.existing, accepted.added]);
  assert.equal(auditCount(accepted.product.id), 1);
  assert.equal(accepted.storage.values.has(accepted.product.existing[0]), true);
  assert.equal(accepted.storage.values.has(accepted.unrelated), true);
  assert.equal(accepted.storage.values.has(accepted.added), true);
  assert.equal(accepted.storage.values.has(`${accepted.added}.meta.json`), true);
});
