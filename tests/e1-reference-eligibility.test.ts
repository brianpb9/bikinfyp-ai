import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "e1-reference-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { setProductImageClassifierForTests } = await import("../lib/product-images");
const { setProductCreateDependenciesForTests } = await import("../lib/product-create-dependencies");
const { POST: createProduct } = await import("../app/api/products/route");
type MediaStorage = import("../lib/storage").MediaStorage;

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  putCalls: string[] = [];
  deleteCalls: string[] = [];
  failSidecarReads = false;
  failDeletePhoto = false;
  async put(key: string, body: Buffer) { this.putCalls.push(key); this.values.set(key, Buffer.from(body)); }
  async delete(key: string) {
    this.deleteCalls.push(key);
    if (this.failDeletePhoto && !key.endsWith(".meta.json")) throw new Error(`controlled E1 delete failure: ${key}`);
    this.values.delete(key);
  }
  async get(key: string) {
    if (this.failSidecarReads && key.endsWith(".meta.json")) throw new Error(`controlled E1 resolver failure: ${key}`);
    const body = this.values.get(key);
    return body ? { body: Buffer.from(body), size: body.length } : null;
  }
  async stat(key: string) { const body = this.values.get(key); return body ? { size: body.length } : null; }
  async materialize() { return null; }
}

after(() => {
  setProductCreateDependenciesForTests(undefined);
  setProductImageClassifierForTests(undefined);
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

const eligible = {
  jenis: "product_photo" as const,
  layakReferensi: true,
  rasioAreaTeks: 0.001,
  jumlahKata: 2,
  alasan: "foto produk layak",
};
const promotional = {
  jenis: "promotional_graphic" as const,
  layakReferensi: false,
  rasioAreaTeks: 0.4,
  jumlahKata: 12,
  alasan: "grafis promosi tidak layak jadi acuan",
};

async function run(
  label: string,
  verdicts: Array<typeof eligible | typeof promotional>,
  configure?: (storage: MemoryStorage) => void
) {
  const storage = new MemoryStorage();
  configure?.(storage);
  setMediaStorageForTests(storage);
  let classifierIndex = 0;
  setProductImageClassifierForTests(async () => verdicts[classifierIndex++] ?? verdicts.at(-1)!);
  let sqliteCreates = 0;
  let audits = 0;
  let pgCreates = 0;
  const insertedImages: string[][] = [];
  const productId = `e1-${label}-${process.pid}`;
  setProductCreateDependenciesForTests({
    getAuthUser: async () => ({ id: "user-e1" }) as never,
    uuid: () => productId,
    postgresRuntimeEnabled: () => false,
    smokeCreateProduct: async () => { pgCreates += 1; return {} as never; },
    getDb: () => ({
      prepare: () => ({
        run: (...args: unknown[]) => {
          sqliteCreates += 1;
          insertedImages.push(JSON.parse(String(args[7])) as string[]);
          return {};
        },
      }),
    }) as never,
    now: () => "2026-08-24T00:00:00.000Z",
    audit: () => { audits += 1; },
  });
  const pngs = await Promise.all(verdicts.map((_, index) =>
    sharp({ create: { width: 400, height: 400, channels: 3, background: index % 2 ? "#16a34a" : "#7c3aed" } }).png().toBuffer()
  ));
  const response = await createProduct(new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Produk ${label}`,
      price_idr: 50000,
      category: "beauty",
      images_base64: pngs.map((png) => `data:image/png;base64,${png.toString("base64")}`),
    }),
  }));
  return { response, storage, productId, sqliteCreates, pgCreates, audits, insertedImages };
}

test("E1 exported POST mewajibkan referensi layak sebelum persistence dan rollback exact", async () => {
  const accepted = await run("eligible", [eligible]);
  assert.equal(accepted.response.status, 201, await accepted.response.clone().text());
  assert.equal(accepted.sqliteCreates, 1);
  assert.equal(accepted.pgCreates, 0);
  assert.equal(accepted.audits, 1);
  const acceptedBody = await accepted.response.json() as { images: string[] };
  assert.deepEqual(accepted.insertedImages, [acceptedBody.images]);
  assert.deepEqual([...accepted.storage.values.keys()].sort(), acceptedBody.images.flatMap((rel) => [rel, `${rel}.meta.json`]).sort());

  const rejected = await run("all-promotional", [promotional, promotional]);
  assert.equal(rejected.response.status, 400, await rejected.response.clone().text());
  assert.equal((await rejected.response.json()).message_en, "No reference-eligible product photo.");
  assert.equal(rejected.sqliteCreates, 0);
  assert.equal(rejected.pgCreates, 0);
  assert.equal(rejected.audits, 0);
  assert.deepEqual([...rejected.storage.values.keys()], []);
  const rejectedPhotos = rejected.storage.putCalls.filter((key) => !key.endsWith(".meta.json"));
  assert.deepEqual([...new Set(rejected.storage.deleteCalls)].sort(), rejectedPhotos.flatMap((rel) => [rel, `${rel}.meta.json`]).sort());

  const mixed = await run("mixed", [promotional, eligible]);
  assert.equal(mixed.response.status, 201, await mixed.response.clone().text());
  const mixedBody = await mixed.response.json() as { images: string[] };
  assert.deepEqual(mixedBody.images, [
    `uploads/${mixed.productId}/0.webp`,
    `uploads/${mixed.productId}/1.webp`,
  ], "urutan exact ingestion wajib dipertahankan");
  assert.deepEqual(mixed.insertedImages, [mixedBody.images]);
  assert.equal(mixed.sqliteCreates, 1);
  assert.equal(mixed.audits, 1);
});

test("E1 resolver dan cleanup failure tetap sebelum row/audit", async () => {
  const resolverLogs: unknown[][] = [];
  const beforeResolver = console.error;
  console.error = (...args: unknown[]) => { resolverLogs.push(args); };
  let resolver: Awaited<ReturnType<typeof run>>;
  try {
    resolver = await run("resolver-error", [eligible], (storage) => { storage.failSidecarReads = true; });
  } finally {
    console.error = beforeResolver;
  }
  assert.equal(resolver.response.status, 500);
  assert.equal(resolver.sqliteCreates, 0);
  assert.equal(resolver.pgCreates, 0);
  assert.equal(resolver.audits, 0);
  assert.deepEqual([...resolver.storage.values.keys()], []);
  assert.ok(resolverLogs.some((args) => args.some((arg) => String(arg).includes("controlled E1 resolver failure"))));

  const cleanupLogs: unknown[][] = [];
  const beforeCleanup = console.error;
  console.error = (...args: unknown[]) => { cleanupLogs.push(args); };
  let cleanup: Awaited<ReturnType<typeof run>>;
  try {
    cleanup = await run("cleanup-error", [promotional], (storage) => { storage.failDeletePhoto = true; });
  } finally {
    console.error = beforeCleanup;
  }
  assert.equal(cleanup.response.status, 500);
  assert.equal(cleanup.sqliteCreates, 0);
  assert.equal(cleanup.pgCreates, 0);
  assert.equal(cleanup.audits, 0);
  assert.ok([...cleanup.storage.values.keys()].some((key) => !key.endsWith(".meta.json")), "fixture wajib meninggalkan residual foto");
  assert.ok(cleanupLogs.some((args) => args.some((arg) => String(arg).includes("E1 reference rejection cleanup failed"))));
  assert.ok(cleanupLogs.some((args) => args.some((arg) => String(arg).includes("residual storage objects may remain"))));
});
