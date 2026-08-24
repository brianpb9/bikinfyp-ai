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
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "org-brand-e8-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { setProductImageClassifierForTests } = await import("../lib/product-images");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
const { POST: addOrgPhoto } = await import("../app/api/dashboard/campaign/product/[id]/photos/route");
const { setOrgPhotoPostDependenciesForTests } = await import("../lib/org-photo-post-dependencies");
type MediaStorage = import("../lib/storage").MediaStorage;
type HasilLabel = import("../lib/media/label-terbaca").HasilLabel;

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  putCalls: string[] = [];
  deleteCalls: string[] = [];
  failGetKeys = new Set<string>();
  failDelete: ((key: string) => boolean) | undefined;
  async put(key: string, body: Buffer) { this.putCalls.push(key); this.values.set(key, Buffer.from(body)); }
  async delete(key: string) {
    this.deleteCalls.push(key);
    if (this.failDelete?.(key)) throw new Error(`controlled E8 delete failure: ${key}`);
    this.values.delete(key);
  }
  async get(key: string) {
    if (this.failGetKeys.has(key)) throw new Error(`controlled E8 resolver failure: ${key}`);
    const body = this.values.get(key); return body ? { body: Buffer.from(body), size: body.length } : null;
  }
  async stat(key: string) { const body = this.values.get(key); return body ? { size: body.length } : null; }
  async materialize() { return null; }
}

after(() => {
  setOrgPhotoPostDependenciesForTests(undefined);
  setPeriksaLabelFotoForTests(undefined);
  setProductImageClassifierForTests(undefined);
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

const LABEL_VALID: HasilLabel = {
  terbaca: true, kata: ["Merek", "Org"], cocokNama: true, cocokMerek: true,
};

test("E8 exported POST meneruskan merek terdaftar dan menolak brand salah tanpa efek", async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#2563eb" } }).png().toBuffer();
  setProductImageClassifierForTests(async () => ({
    jenis: "product_photo", layakReferensi: true, rasioAreaTeks: 0.001, jumlahKata: 2, alasan: "fixture produk org",
  }));

  const run = async (label: string, rawMeta: string, verdict: HasilLabel, expectedStatus: number) => {
    const storage = new MemoryStorage();
    setMediaStorageForTests(storage);
    const productId = `e8-${label}-${process.pid}`;
    let slotReleases = 0;
    let appendCalls = 0;
    let auditCalls = 0;
    const seenBrands: Array<string | null | undefined> = [];
    const tempFiles: string[] = [];
    setPeriksaLabelFotoForTests(async (fotoPath, _productName, brand) => {
      assert.equal(fs.existsSync(fotoPath), true, `${label}: file temp wajib ada selama pemeriksaan`);
      tempFiles.push(fotoPath);
      seenBrands.push(brand);
      return verdict;
    });
    setOrgPhotoPostDependenciesForTests({
      postgresRuntimeEnabled: () => true,
      requireOrgContextApi: async () => ({
        user: { id: "user-e8" },
        membership: { org_id: "org-e8" },
      }) as never,
      assertDashboardRate: async () => undefined,
      smokeGetOrgProduct: async () => ({
        id: productId,
        name: `Serum ${label}`,
        images: "[]",
        raw_meta: rawMeta,
      }) as never,
      acquirePhotoUploadSlot: async () => () => { slotReleases += 1; },
      readSinglePhotoMultipart: async () => ({ mime: "image/png", data: png }),
      pgAppendOrgProductImages: async (_orgId, _id, added) => {
        appendCalls += 1;
        return added;
      },
      pgAudit: async () => { auditCalls += 1; },
    });

    const response = await addOrgPhoto(new Request(`http://localhost/api/dashboard/campaign/product/${productId}/photos`, {
      method: "POST",
    }), { params: Promise.resolve({ id: productId }) });
    assert.equal(response.status, expectedStatus, `${label}: ${await response.clone().text()}`);
    assert.equal(slotReleases, 1, `${label}: permit upload bocor`);
    assert.equal(tempFiles.length, 1, `${label}: policy foto pertama berubah`);
    assert.ok(tempFiles.every((file) => !fs.existsSync(file) && !fs.existsSync(path.dirname(file))), `${label}: temp tidak bersih`);
    return { response, storage, appendCalls, auditCalls, seenBrands };
  };

  const wrongBrand = await run("wrong-brand", JSON.stringify({ brand: "Merek Org" }), {
    terbaca: true,
    kata: ["Merek", "Lain"],
    cocokNama: true,
    cocokMerek: false,
    alasan: "merek foto tidak cocok",
  }, 400);
  assert.deepEqual(seenKeys(wrongBrand.storage), [], "brand salah tidak boleh menulis bytes/sidecar");
  assert.deepEqual(wrongBrand.storage.deleteCalls, [], "brand salah terjadi sebelum rollback storage diperlukan");
  assert.equal(wrongBrand.appendCalls, 0, "brand salah tidak boleh memutasi daftar foto");
  assert.equal(wrongBrand.auditCalls, 0, "brand salah tidak boleh menulis audit sukses");
  assert.deepEqual(wrongBrand.seenBrands, ["Merek Org"]);
  assert.equal((await wrongBrand.response.json()).message_en, "Product label does not match the registered brand.");

  const validBrand = await run("valid-brand", JSON.stringify({ brand: " Merek Org " }), LABEL_VALID, 200);
  assert.deepEqual(validBrand.seenBrands, ["Merek Org"]);
  assert.equal(validBrand.storage.putCalls.length, 2, "control valid wajib menyimpan foto dan sidecar");
  assert.equal(validBrand.appendCalls, 1);
  assert.equal(validBrand.auditCalls, 1);

  const nullBrand = await run("null-brand", "{}", { ...LABEL_VALID, cocokMerek: null }, 200);
  assert.deepEqual(nullBrand.seenBrands, [null]);
  assert.equal(nullBrand.storage.putCalls.length, 2, "tanpa brand terdaftar tetap mempertahankan perilaku lama");
  assert.equal(nullBrand.appendCalls, 1);
  assert.equal(nullBrand.auditCalls, 1);
});

test("E8 resolver menolak produk tanpa referensi dan rollback exact sebelum PG append/audit", async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#9333ea" } }).png().toBuffer();

  const run = async (
    label: string,
    classifier: { jenis: "product_photo" | "promotional_graphic"; layakReferensi: boolean; rasioAreaTeks: number; jumlahKata: number; alasan: string },
    includeExisting = false,
    configure?: (storage: MemoryStorage, productId: string, existing: string[]) => void
  ) => {
    const productId = `e8-ref-${label}-${process.pid}`;
    const existing = includeExisting ? [`uploads/${productId}/existing.webp`] : [];
    const unrelated = `uploads/unrelated-${productId}/keep.webp`;
    const storage = new MemoryStorage();
    if (existing[0]) storage.values.set(existing[0], Buffer.from("existing-object-must-survive"));
    storage.values.set(unrelated, Buffer.from("unrelated-object-must-survive"));
    configure?.(storage, productId, existing);
    setMediaStorageForTests(storage);
    setProductImageClassifierForTests(async () => classifier);
    let slotReleases = 0;
    let appendCalls = 0;
    let auditCalls = 0;
    const tempFiles: string[] = [];
    setPeriksaLabelFotoForTests(async (fotoPath) => {
      tempFiles.push(fotoPath);
      return LABEL_VALID;
    });
    setOrgPhotoPostDependenciesForTests({
      postgresRuntimeEnabled: () => true,
      requireOrgContextApi: async () => ({ user: { id: "user-e8" }, membership: { org_id: "org-e8" } }) as never,
      assertDashboardRate: async () => undefined,
      smokeGetOrgProduct: async () => ({
        id: productId,
        name: `Serum ${label}`,
        images: JSON.stringify(existing),
        raw_meta: JSON.stringify({ brand: "Merek Org" }),
      }) as never,
      acquirePhotoUploadSlot: async () => () => { slotReleases += 1; },
      readSinglePhotoMultipart: async () => ({ mime: "image/png", data: png }),
      pgAppendOrgProductImages: async (_orgId, _id, added) => {
        appendCalls += 1;
        return [...existing, ...added];
      },
      pgAudit: async () => { auditCalls += 1; },
    });
    const response = await addOrgPhoto(new Request(`http://localhost/api/dashboard/campaign/product/${productId}/photos`, {
      method: "POST",
    }), { params: Promise.resolve({ id: productId }) });
    const added = storage.putCalls.find((key) => !key.endsWith(".meta.json"));
    assert.ok(added, `${label}: ingestion tidak menulis foto baru`);
    assert.equal(slotReleases, 1, `${label}: permit upload bocor`);
    assert.equal(tempFiles.length, existing.length ? 0 : 1, `${label}: policy foto pertama berubah`);
    assert.ok(tempFiles.every((file) => !fs.existsSync(file) && !fs.existsSync(path.dirname(file))), `${label}: temp tidak bersih`);
    return { response, productId, existing, unrelated, storage, added, appendCalls, auditCalls };
  };

  const promotional = {
    jenis: "promotional_graphic" as const,
    layakReferensi: false,
    rasioAreaTeks: 0.35,
    jumlahKata: 14,
    alasan: "grafis promosi org tidak layak jadi acuan",
  };
  const rejected = await run("rejected", promotional);
  assert.equal(rejected.response.status, 400, await rejected.response.clone().text());
  assert.equal((await rejected.response.json()).message_en, "No reference-eligible product photo.");
  assert.equal(rejected.appendCalls, 0);
  assert.equal(rejected.auditCalls, 0);
  assert.deepEqual([...new Set(rejected.storage.deleteCalls)].sort(), [rejected.added, `${rejected.added}.meta.json`].sort());
  assert.deepEqual(seenKeys(rejected.storage), [rejected.unrelated]);

  const preserved = await run("preserve-existing", promotional, true);
  assert.equal(preserved.response.status, 400);
  assert.equal(preserved.appendCalls, 0);
  assert.equal(preserved.auditCalls, 0);
  assert.deepEqual(seenKeys(preserved.storage), [preserved.existing[0], preserved.unrelated].sort());

  const resolverLogs: unknown[][] = [];
  const errorBeforeResolver = console.error;
  console.error = (...args: unknown[]) => { resolverLogs.push(args); };
  let resolverFailure: Awaited<ReturnType<typeof run>>;
  try {
    resolverFailure = await run("resolver-error", promotional, true, (storage, _productId, existing) => {
      storage.failGetKeys.add(`${existing[0]}.meta.json`);
    });
  } finally {
    console.error = errorBeforeResolver;
  }
  assert.equal(resolverFailure.response.status, 500);
  assert.equal(resolverFailure.appendCalls, 0);
  assert.equal(resolverFailure.auditCalls, 0);
  assert.deepEqual(seenKeys(resolverFailure.storage), [resolverFailure.existing[0], resolverFailure.unrelated].sort());
  assert.ok(resolverLogs.some((args) => args.some((arg) => String(arg).includes("controlled E8 resolver failure"))));

  const cleanupLogs: unknown[][] = [];
  const errorBeforeCleanup = console.error;
  console.error = (...args: unknown[]) => { cleanupLogs.push(args); };
  let cleanupFailure: Awaited<ReturnType<typeof run>>;
  try {
    cleanupFailure = await run("cleanup-error", promotional, false, (storage, productId) => {
      storage.failDelete = (key) => key.startsWith(`uploads/${productId}/`) && !key.endsWith(".meta.json");
    });
  } finally {
    console.error = errorBeforeCleanup;
  }
  assert.equal(cleanupFailure.response.status, 500);
  assert.equal(cleanupFailure.appendCalls, 0);
  assert.equal(cleanupFailure.auditCalls, 0);
  assert.equal(cleanupFailure.storage.values.has(cleanupFailure.added), true, "fault fixture wajib meninggalkan residual");
  assert.equal(cleanupFailure.storage.values.has(cleanupFailure.unrelated), true);
  assert.ok(cleanupLogs.some((args) => args.some((arg) => String(arg).includes("E8 reference rejection cleanup failed"))));
  assert.ok(cleanupLogs.some((args) => args.some((arg) => String(arg).includes("residual storage objects may remain"))));

  const accepted = await run("eligible", {
    jenis: "product_photo",
    layakReferensi: true,
    rasioAreaTeks: 0.001,
    jumlahKata: 2,
    alasan: "foto produk org layak",
  });
  assert.equal(accepted.response.status, 200, await accepted.response.clone().text());
  assert.equal(accepted.appendCalls, 1);
  assert.equal(accepted.auditCalls, 1);
  assert.equal(accepted.storage.values.has(accepted.added), true);
  assert.equal(accepted.storage.values.has(`${accepted.added}.meta.json`), true);
  assert.equal(accepted.storage.values.has(accepted.unrelated), true);
});

function seenKeys(storage: MemoryStorage): string[] {
  return [...storage.values.keys()].sort();
}
