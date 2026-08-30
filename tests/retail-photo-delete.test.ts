import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.STORAGE_MODE = "filesystem";
process.env.DB_PATH = path.join(os.tmpdir(), `racun-test-retail-photo-delete-${process.pid}.db`);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "retail-photo-delete-store-"));

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone, issueToken, cookieName } = await import("../lib/auth");
const { setMediaStorageForTests } = await import("../lib/storage");
const { deleteStoredProductImages } = await import("../lib/product-images");
const { appendRetailProductImages, removeRetailProductImage } = await import("../lib/retail-product-images");
const { DELETE: deletePhoto } = await import("../app/api/products/[id]/photos/route");
type MediaStorage = import("../lib/storage").MediaStorage;

const db = getDb();
const user = findOrCreateUserByPhone("081200000055");
const token = await issueToken(user.id, user.phone ?? "");

class StorageMemori implements MediaStorage {
  readonly values = new Map<string, Buffer>();
  readonly deleteCalls: string[] = [];
  sebelumDelete?: (key: string) => void;
  gagalUntuk = new Set<string>();

  async put(key: string, body: Buffer) { this.values.set(key, Buffer.from(body)); }
  async delete(key: string) {
    this.deleteCalls.push(key);
    this.sebelumDelete?.(key);
    if (this.gagalUntuk.has(key)) throw new Error(`storage menolak delete ${key}`);
    this.values.delete(key);
  }
  async get(key: string) {
    const body = this.values.get(key);
    return body ? { body, size: body.length } : null;
  }
  async stat(key: string) {
    const body = this.values.get(key);
    return body ? { size: body.length } : null;
  }
  async materialize() { return null; }
}

function siapkanProduk(images: string[]) {
  const id = uuid();
  db.prepare(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, user.id, "Serum E5", 85000, "beauty", JSON.stringify(images), now());
  return id;
}

function requestHapus(productId: string, target: string) {
  return deletePhoto(
    new Request(`http://localhost/api/products/${productId}/photos`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        cookie: `${cookieName()}=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({ path: target }),
    }),
    { params: Promise.resolve({ id: productId }) }
  );
}

function daftarFoto(productId: string): string[] {
  const row = db.prepare("SELECT images FROM products WHERE id = ?").get(productId) as { images: string };
  return JSON.parse(row.images) as string[];
}

test("E5 DELETE: persist list terjadi sebelum foto+sidecar target dibersihkan; foto lain utuh", async (t) => {
  const target = "uploads/e5-target/0.webp";
  const lain = "uploads/e5-target/1.webp";
  const productId = siapkanProduk([target, lain]);
  const storage = new StorageMemori();
  for (const key of [target, `${target}.meta.json`, `${target}.rights.json`, `${target}.rights.json.revoked.json`, lain, `${lain}.meta.json`]) {
    storage.values.set(key, Buffer.from(key));
  }
  let seluruhDeleteSesudahPersist = true;
  storage.sebelumDelete = () => {
    seluruhDeleteSesudahPersist &&= JSON.stringify(daftarFoto(productId)) === JSON.stringify([lain]);
  };
  setMediaStorageForTests(storage);
  t.after(() => setMediaStorageForTests(undefined));

  const response = await requestHapus(productId, target);
  const body = await response.json() as { images: string[]; cleanup_failed: boolean };

  assert.equal(response.status, 200);
  assert.deepEqual(body.images, [lain]);
  assert.equal(body.cleanup_failed, false);
  assert.deepEqual(daftarFoto(productId), [lain], "daftar DB tidak mempersist penghapusan target");
  assert.equal(seluruhDeleteSesudahPersist, true, "storage dibersihkan sebelum daftar DB berhasil dipersist");
  assert.deepEqual(
    storage.deleteCalls.sort(),
    [target, `${target}.meta.json`, `${target}.rights.json`, `${target}.rights.json.revoked.json`].sort(),
    "cleanup harus menyasar tepat foto target, sidecar teknis, dan receipt haknya"
  );
  assert.equal(storage.values.has(target), false);
  assert.equal(storage.values.has(`${target}.meta.json`), false);
  assert.equal(storage.values.has(`${target}.rights.json`), false);
  assert.equal(storage.values.has(`${target}.rights.json.revoked.json`), false);
  assert.equal(storage.values.has(lain), true, "foto yang tidak dihapus ikut hilang");
  assert.equal(storage.values.has(`${lain}.meta.json`), true, "sidecar foto lain ikut hilang");
});

test("E5 DELETE: cleanup gagal tetap observable dan tidak mengembalikan entry DB", async (t) => {
  const target = "uploads/e5-gagal/0.webp";
  const lain = "uploads/e5-gagal/1.webp";
  const productId = siapkanProduk([target, lain]);
  const storage = new StorageMemori();
  for (const key of [target, `${target}.meta.json`, lain, `${lain}.meta.json`]) {
    storage.values.set(key, Buffer.from(key));
  }
  storage.gagalUntuk.add(target);
  setMediaStorageForTests(storage);
  t.after(() => setMediaStorageForTests(undefined));
  const consoleErrorAsli = console.error;
  const logError: unknown[][] = [];
  console.error = (...args: unknown[]) => { logError.push(args); };
  t.after(() => { console.error = consoleErrorAsli; });

  const response = await requestHapus(productId, target);
  const body = await response.json() as { images: string[]; cleanup_failed: boolean };

  assert.equal(response.status, 200, "cleanup best-effort tidak boleh mengubah delete DB menjadi 500");
  assert.deepEqual(body.images, [lain]);
  assert.equal(body.cleanup_failed, true, "kegagalan cleanup tidak terlihat oleh client");
  assert.deepEqual(daftarFoto(productId), [lain], "entry DB hidup lagi sesudah cleanup gagal");
  assert.equal(storage.deleteCalls.filter((key) => key === target).length, 3, "helper tidak menjalankan kontrak retry");
  assert.ok(logError.some((args) => String(args[0]).includes(target)), "kegagalan cleanup tidak tercatat di log helper");
  assert.equal(storage.values.has(target), true, "fixture gagal-delete tidak benar-benar mempertahankan target");
  assert.equal(storage.values.has(`${target}.meta.json`), false, "sidecar yang bisa dibersihkan ikut ditinggalkan");
  assert.equal(storage.values.has(lain), true);
  assert.equal(storage.values.has(`${lain}.meta.json`), true);
});

test("E5 DELETE: foto terakhir tetap boleh dihapus menjadi daftar kosong", async (t) => {
  const target = "uploads/e5-terakhir/0.webp";
  const productId = siapkanProduk([target]);
  const storage = new StorageMemori();
  storage.values.set(target, Buffer.from("foto"));
  storage.values.set(`${target}.meta.json`, Buffer.from("sidecar"));
  setMediaStorageForTests(storage);
  t.after(() => setMediaStorageForTests(undefined));

  const response = await requestHapus(productId, target);
  const body = await response.json() as { images: string[]; cleanup_failed: boolean };

  assert.equal(response.status, 200);
  assert.deepEqual(body.images, []);
  assert.equal(body.cleanup_failed, false);
  assert.deepEqual(daftarFoto(productId), [], "semantik lama mengizinkan penghapusan foto terakhir");
  assert.deepEqual([...storage.values.keys()], [], "foto terakhir dan sidecar tidak dibersihkan");
});

test("E5 DELETE paralel: dua target berbeda hilang dari DB sebelum storage dibersihkan", async (t) => {
  const targetA = "uploads/e5-race/a.webp";
  const targetB = "uploads/e5-race/b.webp";
  const lain = "uploads/e5-race/c.webp";
  const productId = siapkanProduk([targetA, targetB, lain]);
  const storage = new StorageMemori();
  for (const key of [targetA, targetB, lain]) {
    storage.values.set(key, Buffer.from(key));
    storage.values.set(`${key}.meta.json`, Buffer.from(`meta:${key}`));
  }
  const daftarSaatCleanup: string[][] = [];
  storage.sebelumDelete = () => { daftarSaatCleanup.push(daftarFoto(productId)); };
  setMediaStorageForTests(storage);
  t.after(() => setMediaStorageForTests(undefined));

  const [responseA, responseB] = await Promise.all([
    requestHapus(productId, targetA),
    requestHapus(productId, targetB),
  ]);

  assert.equal(responseA.status, 200);
  assert.equal(responseB.status, 200);
  assert.deepEqual(daftarFoto(productId), [lain], "stale delete menghidupkan kembali target lain");
  assert.ok(
    daftarSaatCleanup.every((images) => !images.includes(targetA) || !images.includes(targetB)),
    "cleanup storage dimulai sebelum salah satu mutasi DB atomik selesai"
  );
  for (const target of [targetA, targetB]) {
    assert.equal(storage.values.has(target), false);
    assert.equal(storage.values.has(`${target}.meta.json`), false);
  }
  assert.equal(storage.values.has(lain), true);
  assert.equal(storage.values.has(`${lain}.meta.json`), true);
});

test("E4/E5 add-delete paralel memakai daftar otoritatif dan tidak resurrect target", async (t) => {
  const target = "uploads/e5-add-delete/target.webp";
  const lain = "uploads/e5-add-delete/lain.webp";
  const added = "uploads/e5-add-delete/uuid-baru.webp";
  const productId = siapkanProduk([target, lain]);
  const targetReverse = "uploads/e5-add-delete/target-reverse.webp";
  const lainReverse = "uploads/e5-add-delete/lain-reverse.webp";
  const addedReverse = "uploads/e5-add-delete/uuid-reverse.webp";
  const productIdReverse = siapkanProduk([targetReverse, lainReverse]);
  const storage = new StorageMemori();
  for (const key of [target, lain, added, targetReverse, lainReverse, addedReverse]) {
    storage.values.set(key, Buffer.from(key));
    storage.values.set(`${key}.meta.json`, Buffer.from(`meta:${key}`));
  }
  setMediaStorageForTests(storage);
  t.after(() => setMediaStorageForTests(undefined));

  const [hasilAdd, hasilDelete] = await Promise.all([
    appendRetailProductImages(user.id, productId, [added], 8),
    removeRetailProductImage(user.id, productId, target),
  ]);
  const [hasilDeleteReverse, hasilAddReverse] = await Promise.all([
    removeRetailProductImage(user.id, productIdReverse, targetReverse),
    appendRetailProductImages(user.id, productIdReverse, [addedReverse], 8),
  ]);

  assert.ok(hasilAdd, "append atomik ditolak oleh fixture yang masih di bawah batas");
  assert.ok(hasilDelete, "delete atomik tidak menemukan target fixture");
  assert.ok(hasilDeleteReverse);
  assert.ok(hasilAddReverse);
  assert.deepEqual(daftarFoto(productId), [lain, added], "append stale resurrect target yang sudah dihapus");
  assert.deepEqual(
    daftarFoto(productIdReverse),
    [lainReverse, addedReverse],
    "hasil berubah saat serialisasi delete menang lebih dulu"
  );
  assert.equal(storage.values.has(target), true, "storage dibersihkan sebelum kedua mutasi DB selesai");
  assert.equal(storage.values.has(targetReverse), true, "storage reverse dibersihkan sebelum kedua mutasi DB selesai");
  await deleteStoredProductImages([target, targetReverse]);
  assert.equal(storage.values.has(target), false);
  assert.equal(storage.values.has(`${target}.meta.json`), false);
  assert.equal(storage.values.has(added), true);
  assert.equal(storage.values.has(`${added}.meta.json`), true);
  assert.equal(storage.values.has(addedReverse), true);
  assert.equal(storage.values.has(`${addedReverse}.meta.json`), true);
});

test("E5 DELETE: kegagalan audit pasca-commit tercatat tanpa false 500", async (t) => {
  const target = "uploads/e5-audit/target.webp";
  const lain = "uploads/e5-audit/lain.webp";
  const productId = siapkanProduk([target, lain]);
  const storage = new StorageMemori();
  for (const key of [target, `${target}.meta.json`, lain, `${lain}.meta.json`]) {
    storage.values.set(key, Buffer.from(key));
  }
  setMediaStorageForTests(storage);
  t.after(() => setMediaStorageForTests(undefined));
  db.exec(`CREATE TRIGGER retail_photo_audit_failure
    BEFORE INSERT ON audit_log BEGIN SELECT RAISE(FAIL, 'audit sink down'); END`);
  t.after(() => db.exec("DROP TRIGGER IF EXISTS retail_photo_audit_failure"));
  const consoleErrorAsli = console.error;
  const logError: unknown[][] = [];
  console.error = (...args: unknown[]) => { logError.push(args); };
  t.after(() => { console.error = consoleErrorAsli; });

  const response = await requestHapus(productId, target);
  const body = await response.json() as { images: string[]; cleanup_failed: boolean };
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(response.status, 200, "audit pasca-commit mengubah delete sukses menjadi false 500");
  assert.deepEqual(body.images, [lain]);
  assert.equal(body.cleanup_failed, false);
  assert.deepEqual(daftarFoto(productId), [lain]);
  assert.ok(logError.some((args) => String(args[0]).includes("product.photo_removed failed")), "audit gagal tidak tercatat");
});

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
});
