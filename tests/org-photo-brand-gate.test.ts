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
  async put(key: string, body: Buffer) { this.putCalls.push(key); this.values.set(key, Buffer.from(body)); }
  async delete(key: string) { this.deleteCalls.push(key); this.values.delete(key); }
  async get(key: string) { const body = this.values.get(key); return body ? { body: Buffer.from(body), size: body.length } : null; }
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

function seenKeys(storage: MemoryStorage): string[] {
  return [...storage.values.keys()].sort();
}
