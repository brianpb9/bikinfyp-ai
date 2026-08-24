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
  async put(key: string, body: Buffer) { this.putCalls.push(key); this.values.set(key, Buffer.from(body)); }
  async delete(key: string) { this.deleteCalls.push(key); this.values.delete(key); }
  async get(key: string) { const body = this.values.get(key); return body ? { body: Buffer.from(body), size: body.length } : null; }
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

  const unreadable = await run("unreadable-second", [LABEL_VALID, {
    terbaca: false, kata: [], cocokNama: false, cocokMerek: null, alasan: "foto kedua tidak terbaca",
  }], 400);
  assert.deepEqual(imagesFor(unreadable.product.id), unreadable.product.existing);
  assert.deepEqual(unreadable.storage.putCalls, []); assert.deepEqual(unreadable.storage.deleteCalls, []);
  assert.equal(auditCount(unreadable.product.id), 0);

  const wrongBrand = await run("wrong-brand-second", [LABEL_VALID, {
    terbaca: true, kata: ["Merek", "Lain"], cocokNama: true, cocokMerek: false, alasan: "merek foto kedua salah",
  }], 400);
  assert.deepEqual(imagesFor(wrongBrand.product.id), wrongBrand.product.existing);
  assert.deepEqual(wrongBrand.storage.putCalls, []); assert.deepEqual(wrongBrand.storage.deleteCalls, []);
  assert.equal(auditCount(wrongBrand.product.id), 0);

  const mixedLaterInvalid = await run("mixed-later-invalid", [LABEL_VALID, LABEL_VALID, {
    terbaca: false, kata: [], cocokNama: false, cocokMerek: null, alasan: "foto terakhir tidak terbaca",
  }], 400);
  assert.deepEqual(imagesFor(mixedLaterInvalid.product.id), mixedLaterInvalid.product.existing);
  assert.deepEqual(mixedLaterInvalid.storage.putCalls, []); assert.deepEqual(mixedLaterInvalid.storage.deleteCalls, []);
  assert.equal(auditCount(mixedLaterInvalid.product.id), 0);
});
