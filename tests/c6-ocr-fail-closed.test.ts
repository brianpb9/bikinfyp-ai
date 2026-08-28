import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test, { afterEach } from "node:test";
import sharp from "sharp";
import { ApiError } from "../lib/errors";
import {
  assertAuthoritativeLabelResult,
  setPeriksaLabelFotoForTests,
  type HasilLabel,
} from "../lib/media/label-terbaca";
import { setProductCreateDependenciesForTests } from "../lib/product-create-dependencies";
import { setMediaStorageForTests, type MediaStorage } from "../lib/storage";
import { POST as createProduct } from "../app/api/products/route";
import { assertAdmissionReferenceEvidence } from "../lib/job-admission-reference";
import { parseJobReferenceManifest, prepareJobReferenceManifest } from "../lib/job-reference-manifest";
import { assertApprovedReferenceBrands } from "../lib/worker-reference-brand-gate";
import { prepareInspectedProductImages, saveUniqueProductImages, setProductImageClassifierForTests } from "../lib/product-images";

const readable = (): HasilLabel => ({
  status: "READABLE", evidenceVersion: 1, terbaca: true,
  kata: ["Merek", "Produk"], cocokNama: true, cocokMerek: null,
});
const unreadable = (): HasilLabel => ({
  status: "UNREADABLE", evidenceVersion: 1, terbaca: false,
  kata: [], cocokNama: false, cocokMerek: null, alasan: "Label memang tidak terbaca.",
});
const failed = (reason = "OCR timeout"): HasilLabel => ({
  status: "OCR_FAILED", evidenceVersion: 1, terbaca: false,
  kata: [], cocokNama: false, cocokMerek: null, alasan: reason,
});

afterEach(() => {
  setPeriksaLabelFotoForTests(undefined);
  setProductCreateDependenciesForTests(undefined);
  setMediaStorageForTests(undefined);
  setProductImageClassifierForTests(undefined);
});

test("C6 tri-state keeps OCR_FAILED distinct from inspected LABEL_UNREADABLE", () => {
  assert.doesNotThrow(() => assertAuthoritativeLabelResult(readable()));
  assert.throws(
    () => assertAuthoritativeLabelResult(unreadable()),
    (error) => error instanceof ApiError && error.body.code === "LABEL_UNREADABLE" && error.body.retryable === false,
  );
  for (const verdict of [
    failed("OCR timeout"),
    failed("tesseract unavailable"),
    { ...readable(), status: undefined, evidenceVersion: undefined } as HasilLabel,
    { ...readable(), evidenceVersion: 0 } as unknown as HasilLabel,
    { ...readable(), status: "OCR_FAILED", terbaca: true } as HasilLabel,
  ]) {
    assert.throws(
      () => assertAuthoritativeLabelResult(verdict),
      (error) => error instanceof ApiError && error.body.code === "OCR_FAILED" && error.body.retryable === true,
    );
  }
});

test("E1 OCR runtime failure is HTTP OCR_FAILED before storage, DB, or audit", async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const effects = { put: 0, del: 0, db: 0, pg: 0, audit: 0 };
  const storage: MediaStorage = {
    async put() { effects.put++; }, async delete() { effects.del++; },
    async get() { return null; }, async stat() { return null; }, async materialize() { return null; },
  };
  setMediaStorageForTests(storage);
  setPeriksaLabelFotoForTests(async () => failed("OCR process timed out"));
  setProductCreateDependenciesForTests({
    getAuthUser: async () => ({ id: "user-c6" }) as never,
    now: () => "2026-08-27T00:00:00.000Z",
    uuid: () => "product-c6",
    postgresRuntimeEnabled: () => false,
    getDb: () => { effects.db++; throw new Error("DB must not be reached"); },
    smokeCreateProduct: async () => { effects.pg++; throw new Error("PG must not be reached"); },
    auditProductCreatedOnce: () => { effects.audit++; },
  });
  const response = await createProduct(new Request("http://localhost/api/products", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Produk C6", price_idr: 25_000, category: "beauty",
      product_type: "serum wajah", confirmed_product_type: "serum wajah",
      images_base64: [`data:image/png;base64,${png.toString("base64")}`],
    }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, "OCR_FAILED");
  assert.deepEqual(effects, { put: 0, del: 0, db: 0, pg: 0, audit: 0 });
});

test("admission quarantines legacy/missing OCR provenance and accepts exact readable evidence", async () => {
  const rel = "uploads/c6/packshot.webp";
  const bytes = Buffer.from("C6-PACKSHOT");
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const values = new Map<string, Buffer>();
  let writes = 0;
  setMediaStorageForTests({
    async put(key, body) { writes++; values.set(key, Buffer.from(body)); },
    async delete() { writes++; },
    async get(key) { const body = values.get(key); return body ? { body, size: body.length } : null; },
    async stat() { return null; }, async materialize() { throw new Error("admission must trust hash-bound evidence, not re-OCR mutable bytes"); },
  });
  values.set(rel, bytes);
  const base = { sha256: sha, jenis: "product_photo", layakReferensi: true, rasioAreaTeks: 0.001, jumlahKata: 2, alasan: "packshot", versiBukti: 1 };

  for (const sidecar of [base, { ...base, labelOcrStatus: "READABLE", labelOcrVersion: 0 }, { ...base, labelOcrStatus: "OCR_FAILED", labelOcrVersion: 1 }]) {
    values.set(`${rel}.meta.json`, Buffer.from(JSON.stringify(sidecar)));
    await assert.rejects(
      () => assertAdmissionReferenceEvidence({ productId: "product-c6", candidateRels: [rel], boundary: "A1" }),
      (error) => error instanceof ApiError && error.body.code === "OCR_FAILED",
    );
    assert.equal(writes, 0);
  }
  values.set(`${rel}.meta.json`, Buffer.from(JSON.stringify({ ...base, labelOcrStatus: "READABLE", labelOcrVersion: 1 })));
  await assert.doesNotReject(() => assertAdmissionReferenceEvidence({ productId: "product-c6", candidateRels: [rel], boundary: "A1" }));
  assert.equal(writes, 0);
});

test("W1/W2 manifest parser quarantines v1 or forged OCR provenance before provider", () => {
  const ref = { rel: "uploads/c6/packshot.webp", sha256: "a".repeat(64), versiBukti: 1, snapshotRel: `jobs/${"b".repeat(36)}/approved-references/0.webp` };
  for (const raw of [
    JSON.stringify({ version: 1, references: [ref] }),
    JSON.stringify({ version: 2, references: [{ ...ref, labelOcrStatus: "READABLE", labelOcrVersion: 0 }] }),
    JSON.stringify({ version: 2, references: [{ ...ref, labelOcrStatus: "OCR_FAILED", labelOcrVersion: 1 }] }),
  ]) {
    assert.throws(
      () => parseJobReferenceManifest(raw),
      (error) => error instanceof ApiError && error.body.code === "OCR_FAILED",
    );
  }
  assert.doesNotThrow(() => parseJobReferenceManifest(JSON.stringify({
    version: 2, references: [{ ...ref, labelOcrStatus: "READABLE", labelOcrVersion: 1 }],
  })));
});

test("W1/W2 independent worker brand gate preserves OCR_FAILED and LABEL_UNREADABLE", async () => {
  setPeriksaLabelFotoForTests(async () => failed("worker OCR timeout"));
  await assert.rejects(
    () => assertApprovedReferenceBrands(["/immutable/ref.webp"], "Produk C6", "Merek"),
    (error) => error instanceof ApiError && error.body.code === "OCR_FAILED" && error.body.retryable === true,
  );
  setPeriksaLabelFotoForTests(async () => unreadable());
  await assert.rejects(
    () => assertApprovedReferenceBrands(["/immutable/ref.webp"], "Produk C6", "Merek"),
    (error) => error instanceof ApiError && error.body.code === "LABEL_UNREADABLE" && error.body.retryable === false,
  );
  setPeriksaLabelFotoForTests(async () => ({ ...readable(), cocokMerek: true }));
  await assert.doesNotReject(() => assertApprovedReferenceBrands(["/immutable/ref.webp"], "Produk C6", "Merek"));
});

test("OCR inspects the exact normalized bytes bound to sidecar and manifest SHA", async () => {
  const original = await sharp({ create: { width: 641, height: 377, channels: 3, background: "#fafafa" } }).png().toBuffer();
  const values = new Map<string, Buffer>();
  setMediaStorageForTests({
    async put(key, body) { values.set(key, Buffer.from(body)); },
    async delete(key) { values.delete(key); },
    async get(key) { const body = values.get(key); return body ? { body, size: body.length } : null; },
    async stat(key) { const body = values.get(key); return body ? { size: body.length } : null; },
    async materialize() { return null; },
  });
  setProductImageClassifierForTests(async () => ({
    jenis: "product_photo", layakReferensi: true, rasioAreaTeks: 0,
    jumlahKata: 0, alasan: "fixture product photo", versiBukti: 1,
  }));
  let inspectedSha = "";
  const blobs = [{ mime: "image/png", data: original }];
  const inspected = await prepareInspectedProductImages(blobs, async (normalizedPath) => {
    inspectedSha = crypto.createHash("sha256").update(fs.readFileSync(normalizedPath)).digest("hex");
    return readable();
  });
  const [rel] = await saveUniqueProductImages("product-c6-exact", blobs, inspected);
  const stored = values.get(rel)!;
  const storedSha = crypto.createHash("sha256").update(stored).digest("hex");
  const sidecar = JSON.parse(values.get(`${rel}.meta.json`)!.toString("utf8")) as { sha256: string };
  const prepared = await prepareJobReferenceManifest({ jobId: "job-c6-exact", candidateRels: [rel] });
  assert.notEqual(crypto.createHash("sha256").update(original).digest("hex"), storedSha, "fixture must actually normalize bytes");
  assert.equal(inspectedSha, storedSha);
  assert.equal(sidecar.sha256, storedSha);
  assert.equal(prepared.manifest.references[0].sha256, storedSha);
});

test("all ingestion/admission/worker sources place C6 guards before effects", () => {
  for (const file of [
    "app/api/products/route.ts",
    "app/api/products/[id]/photos/route.ts",
    "app/api/dashboard/campaign/product/[id]/photos/route.ts",
  ]) {
    const source = fs.readFileSync(file, "utf8");
    const gate = source.indexOf("assertAuthoritativeLabelResult(label)");
    const persistence = Math.min(...["saveProductImages(", "saveUniqueProductImages("].map((needle) => {
      const at = source.indexOf(needle); return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    }));
    assert.ok(gate > 0 && persistence > gate, `${file} can persist before canonical OCR verdict`);
  }
  const admission = fs.readFileSync("lib/job-admission-reference.ts", "utf8");
  assert.match(admission, /failedOcr[\s\S]+ERR\.OCR_FAILED/);
  for (const worker of ["lib/worker.ts", "lib/postgres/worker.ts"]) {
    const source = fs.readFileSync(worker, "utf8");
    assert.ok(source.indexOf("requireCurrentJobEvidence(") < source.indexOf("generateVideoWithFailover("), `${worker} provider precedes manifest OCR proof`);
  }
});
