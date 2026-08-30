import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.DB_PATH = path.join(os.tmpdir(), `racun-http-mutation-w2-${process.pid}.db`);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "http-mutation-w2-store-"));

const { getDb, now, uuid } = await import("../lib/db");
const { issueToken, cookieName } = await import("../lib/auth");
const { setMediaStorageForTests } = await import("../lib/storage");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
const { setVideoProvidersForTests } = await import("../lib/providers/registry");
const { setPersonSafeReferencePhotosForTests } = await import("../lib/media/person-safe-refs");
const { setCompositeObserverForTests } = await import("../lib/media/compositor");
const { resolveApprovedReference } = await import("../lib/product-truth");
const { createJobProductSnapshotRaw, parseJobProductSnapshot } = await import("../lib/job-product-snapshot");
const { acquireAdmissionReferenceEvidence } = await import("../lib/job-admission-reference");
const { managedStagingTraceHeader, MANAGED_STAGING_TRACE_HEADER, MANAGED_STAGING_WEB_SERVICE_ID, setManagedStagingTraceAuthorizationContextForTests } = await import("../lib/staging-admission-trace");
const { DELETE: deleteRetailPhoto } = await import("../app/api/products/[id]/photos/route");
const { PATCH: patchRetailProduct } = await import("../app/api/products/[id]/route");
const { processJob, setSqliteQcRunnerForTests } = await import("../lib/worker");
type MediaStorage = import("../lib/storage").MediaStorage;

const db = getDb();
setPeriksaLabelFotoForTests(async (_path, _name, brand) => ({
  status: "READABLE", evidenceVersion: 1, terbaca: true,
  kata: ["Merek", "Produk"], cocokNama: true, cocokMerek: brand ? true : null,
}));
const sha = (body: Buffer) => crypto.createHash("sha256").update(body).digest("hex");
const tempMaterialize = fs.mkdtempSync(path.join(os.tmpdir(), "http-mutation-w2-materialize-"));

function approvedSidecar(bytes: Buffer): Buffer {
  return Buffer.from(JSON.stringify({
    sha256: sha(bytes),
    jenis: "product_photo",
    layakReferensi: true,
    rasioAreaTeks: 0.004,
    jumlahKata: 2,
    alasan: "foto produk",
    versiBukti: 1,
    labelOcrStatus: "READABLE", labelOcrVersion: 1,
  }));
}

after(() => {
  setMediaStorageForTests(undefined);
  setVideoProvidersForTests(undefined);
  setCompositeObserverForTests(undefined);
  setSqliteQcRunnerForTests(undefined);
  setPeriksaLabelFotoForTests(undefined);
  fs.rmSync(tempMaterialize, { recursive: true, force: true });
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  deleteCalls: string[] = [];
  putCalls: string[] = [];
  materializeCalls: string[] = [];
  cascade = new Map<string, string>();
  onApprovedReferencePut: ((key: string) => void | Promise<void>) | null = null;
  async put(key: string, body: Buffer) {
    this.putCalls.push(key);
    this.values.set(key, Buffer.from(body));
    if (key.includes("/approved-references/")) await this.onApprovedReferencePut?.(key);
  }
  async delete(key: string) {
    this.deleteCalls.push(key);
    this.values.delete(key);
    const also = this.cascade.get(key);
    if (also) this.values.delete(also);
  }
  async get(key: string) {
    const body = this.values.get(key);
    return body ? { body: Buffer.from(body), size: body.length } : null;
  }
  async stat(key: string) {
    const body = this.values.get(key);
    return body ? { size: body.length } : null;
  }
  async materialize(key: string) {
    this.materializeCalls.push(key);
    const body = this.values.get(key);
    if (!body) return null;
    const target = path.join(tempMaterialize, `${crypto.randomUUID()}-${path.basename(key)}`);
    fs.writeFileSync(target, body);
    return target;
  }
}

const segments = [
  { role: "hook", start: 0, end: 3, text: "Say, masa 85 ribu segini sih?", visual_direction: "x" },
  { role: "demo", start: 3, end: 10, text: "nah, teksturnya niat banget deh", visual_direction: "x" },
  { role: "cta", start: 10, end: 15, text: "linknya di keranjang kuning ya", visual_direction: "x" },
];

function confirmProductType(productId: string, actorId: string, timestamp: string) {
  db.prepare(`UPDATE products SET product_type_token='serum wajah', product_type_confirmed_token='serum wajah',
    product_type_confirmed_by=?, product_type_confirmed_at=?, product_type_version=1, product_type_state='CONFIRMED'
    WHERE id=?`).run(actorId, timestamp, productId);
  db.prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(productId);
}

async function scenario(label: string) {
  const ownerId = uuid(), intruderId = uuid(), productId = uuid(), scriptId = uuid(), jobId = uuid();
  const approvedSource = `uploads/${label}/approved.webp`;
  const approvedSecondSource = `uploads/${label}/approved-second.webp`;
  const otherSource = `uploads/${label}/other.webp`;
  const approvedBytes = Buffer.from(`APPROVED-${label}`);
  const approvedSecondBytes = Buffer.from(`APPROVED-SECOND-${label}`);
  const snapshotRel = `jobs/${jobId}/approved-references/0-${sha(approvedBytes)}.webp`;
  const snapshotRelSecond = `jobs/${jobId}/approved-references/1-${sha(approvedSecondBytes)}.webp`;
  const timestamp = now();
  for (const [id, phone] of [[ownerId, `08121${label}01`], [intruderId, `08121${label}02`]]) {
    db.prepare("INSERT INTO users (id,phone,tier,locale,created_at) VALUES (?,?,'free','id-ID',?)").run(id, phone, timestamp);
  }
  db.prepare(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,raw_meta,created_at) VALUES (?,?,?,85000,'beauty',?,?,?)"
  ).run(productId, ownerId, `Serum ${label}`, JSON.stringify([approvedSource, approvedSecondSource, otherSource]), JSON.stringify({ brand: "Merek Awal" }), timestamp);
  confirmProductType(productId, ownerId, timestamp);
  db.prepare(
    `INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
     VALUES (?,?,'H1','senang','bestie',?,'caption','[]','{}','silent_caption',?,?)`
  ).run(scriptId, productId, JSON.stringify(segments), timestamp, timestamp);
  const manifest = JSON.stringify({
    version: 2,
    references: [
      { rel: approvedSource, sha256: sha(approvedBytes), versiBukti: 1, labelOcrStatus: "READABLE", labelOcrVersion: 1, snapshotRel },
      { rel: approvedSecondSource, sha256: sha(approvedSecondBytes), versiBukti: 1, labelOcrStatus: "READABLE", labelOcrVersion: 1, snapshotRel: snapshotRelSecond },
    ],
  });
  const productSnapshot = createJobProductSnapshotRaw({ category_review_version: 1, name: `Serum ${label}`, category: "beauty", price_idr: 85_000, raw_meta: JSON.stringify({ brand: "Merek Awal" }) });
  db.prepare(
    `INSERT INTO jobs
      (id,user_id,product_id,script_id,format,quality_tier,duration_s,approved_reference_manifest,job_product_snapshot,state,created_at,state_changed_at)
     VALUES (?,?,?,?,'hands_only','silent_caption',15,?,?,'QUEUED',?,?)`
  ).run(jobId, ownerId, productId, scriptId, manifest, productSnapshot, timestamp, timestamp);
  db.prepare("UPDATE scripts SET job_id=? WHERE id=?").run(jobId, scriptId);
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES (?,?,50000,'bonus',NULL,?)").run(uuid(), ownerId, timestamp);
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES (?,?,-12000,'hold',?,?)").run(uuid(), ownerId, jobId, timestamp);
  return {
    ownerId, intruderId, productId, jobId, approvedSource, approvedSecondSource, otherSource,
    approvedBytes, approvedSecondBytes, snapshotRel, snapshotRelSecond,
    ownerToken: await issueToken(ownerId, `08121${label}01`),
    intruderToken: await issueToken(intruderId, `08121${label}02`),
  };
}

function deleteRequest(productId: string, target: string, token: string) {
  return deleteRetailPhoto(new Request(`http://localhost/api/products/${productId}/photos`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(token)}` },
    body: JSON.stringify({ path: target }),
  }), { params: Promise.resolve({ id: productId }) });
}

function currentImages(productId: string): string[] {
  const row = db.prepare("SELECT images FROM products WHERE id=?").get(productId) as { images: string };
  return JSON.parse(row.images) as string[];
}

async function admittedProductMutationScenario(
  storage: MemoryStorage,
  configureBeforeAdmission?: (input: { productId: string; ownerId: string }) => void
) {
  const ownerId = uuid(), intruderId = uuid(), productId = uuid(), scriptId = uuid();
  const approvedSource = `uploads/e3-${process.pid}/approved.webp`;
  const approvedBytes = Buffer.from("APPROVED-E3-C9");
  const timestamp = now();
  const admissionSegments = [
    { role: "hook", start: 0, end: 4, text: "Bestie kenapa rutinitas pagiku sekarang jauh lebih praktis?", visual_direction: "x" },
    { role: "demo", start: 4, end: 11, text: "Makanya Serum Admission E3 ringan dan mudah diratakan", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "Kalau penasaran cek keranjang sekarang ya", visual_direction: "x" },
  ];
  for (const [id, phone] of [[ownerId, "081230000031"], [intruderId, "081230000032"]]) {
    db.prepare("INSERT INTO users (id,phone,tier,locale,created_at) VALUES (?,?,'free','id-ID',?)").run(id, phone, timestamp);
  }
  db.prepare(
    `INSERT INTO products
      (id,user_id,name,price_idr,category,images,raw_meta,product_visual_desc,brand_brief,claims,created_at)
     VALUES (?,?,?,85000,'beauty',?,?,?,?,?,?)`
  ).run(productId, ownerId, "Serum Admission E3", JSON.stringify([approvedSource]), JSON.stringify({ brand: "Merek Admission E3" }),
    "BOTOL-ADMISSION-E3", "BRIEF-ADMISSION-E3", JSON.stringify(["klaim admission E3"]), timestamp);
  confirmProductType(productId, ownerId, timestamp);
  db.prepare(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
     VALUES (?,?,'H1','senang','bestie',?,'caption','[]','{}','high_quality',?,?)`
  ).run(scriptId, productId, JSON.stringify(admissionSegments), timestamp, timestamp);
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES (?,?,50000,'bonus',?)")
    .run(uuid(), ownerId, timestamp);
  storage.values.set(approvedSource, approvedBytes);
  storage.values.set(`${approvedSource}.meta.json`, approvedSidecar(approvedBytes));
  configureBeforeAdmission?.({ productId, ownerId });
  setMediaStorageForTests(storage);
  const ownerToken = await issueToken(ownerId, "081230000031");
  const intruderToken = await issueToken(intruderId, "081230000032");
  const { POST } = await import("../app/api/jobs/route");
  const admission = await POST(new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(ownerToken)}` },
    body: JSON.stringify({ script_id: scriptId, format: "hands_only", quality_tier: "high_quality", duration_s: 15 }),
  }));
  if (admission.status !== 201) assert.fail(`admission E3 gagal (${admission.status}): ${await admission.text()}`);
  const admitted = await admission.json() as { job_id: string };
  return { ownerId, intruderId, productId, jobId: admitted.job_id, approvedSource, approvedBytes, ownerToken, intruderToken };
}

async function rawAdmissionCandidate(storage: MemoryStorage, label: string, creditIdr: number) {
  const ownerId = uuid(), productId = uuid(), scriptId = uuid();
  const approvedSource = `uploads/admission-${label}/approved.webp`;
  const approvedBytes = Buffer.from(`APPROVED-${label}`);
  const timestamp = now();
  const phone = `08124${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  db.prepare("INSERT INTO users (id,phone,tier,locale,created_at) VALUES (?,?,'free','id-ID',?)")
    .run(ownerId, phone, timestamp);
  db.prepare(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,raw_meta,created_at) VALUES (?,?,?,85000,'beauty',?,?,?)"
  ).run(productId, ownerId, "Serum Admission E3", JSON.stringify([approvedSource]), JSON.stringify({ brand: "Merek Admission" }), timestamp);
  confirmProductType(productId, ownerId, timestamp);
  db.prepare(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
     VALUES (?,?,'H1','senang','bestie',?,'caption','[]','{}','high_quality',?,?)`
  ).run(scriptId, productId, JSON.stringify([
    { role: "hook", start: 0, end: 4, text: "Bestie kenapa rutinitas pagiku sekarang jauh lebih praktis?", visual_direction: "x" },
    { role: "demo", start: 4, end: 11, text: "Makanya Serum Admission E3 ringan dan mudah diratakan", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "Kalau penasaran cek keranjang sekarang ya", visual_direction: "x" },
  ]), timestamp, timestamp);
  if (creditIdr > 0) {
    db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES (?,?,?,'bonus',?)")
      .run(uuid(), ownerId, creditIdr, timestamp);
  }
  storage.values.set(approvedSource, approvedBytes);
  storage.values.set(`${approvedSource}.meta.json`, approvedSidecar(approvedBytes));
  setMediaStorageForTests(storage);
  const token = await issueToken(ownerId, phone);
  const { POST } = await import("../app/api/jobs/route");
  const submit = (extraBody: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) => POST(new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(token)}`, ...extraHeaders },
    body: JSON.stringify({ script_id: scriptId, format: "hands_only", quality_tier: "high_quality", duration_s: 15, ...extraBody }),
  }));
  return { ownerId, productId, scriptId, token, approvedSource, submit };
}

function patchRetailRequest(productId: string, token: string, body: Record<string, unknown>) {
  return patchRetailProduct(new Request(`http://localhost/api/products/${productId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: productId }) });
}

function noPaidSideEffects(jobId: string, storage: MemoryStorage) {
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...(args as [])) as { n: number }).n;
  assert.equal(count("SELECT COUNT(*) n FROM outputs WHERE job_id=?", jobId), 0);
  assert.equal(count("SELECT COUNT(*) n FROM credit_ledger WHERE job_id=? AND type IN ('capture','regen')", jobId), 0);
  const job = db.prepare("SELECT state,provider_video,provider_voice,output_url,cost_actual_idr FROM jobs WHERE id=?").get(jobId) as Record<string, unknown>;
  assert.ok(["FAILED", "REFUNDED"].includes(String(job.state)), `job berhenti di state aktif ${String(job.state)}`);
  assert.equal(job.provider_video, null); assert.equal(job.provider_voice, null);
  assert.equal(job.output_url, null); assert.equal(job.cost_actual_idr, 0);
  assert.deepEqual(storage.putCalls.filter((key) => !key.includes("/approved-references/")), [],
    `worker meninggalkan output object storage: ${JSON.stringify(storage.putCalls)}`);
}

function inspectDemoOverlay(videoPath: string, label: string, atSec: number): { ocr: string; cropSha: string; cropBytes: number } {
  assert.ok(fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0, `compositor tidak menghasilkan video ${label}`);
  const frame = path.join(tempMaterialize, `${label}-demo.png`);
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-ss", String(atSec), "-i", videoPath,
    "-frames:v", "1", "-vf", "crop=iw:ih*0.25:0:ih*0.55,scale=1440:-1", frame,
  ]);
  const body = fs.readFileSync(frame);
  assert.ok(body.length > 0, `crop frame demo kosong ${label}`);
  return {
    ocr: execFileSync("tesseract", [frame, "stdout", "-l", "eng", "--psm", "6"], { encoding: "utf8" })
      .replace(/\s+/g, " ").trim(),
    cropSha: sha(body),
    cropBytes: body.length,
  };
}

test("E3 HTTP PATCH + resume W2 non-optional memakai snapshot admission", async (t) => {
  const storage = new MemoryStorage();
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls++; throw new Error("E3 C9 tidak boleh jaringan"); }) as typeof fetch;
  setPersonSafeReferencePhotosForTests(async (photoPaths) => ({ safe: [...photoPaths], cropped: 0, dropped: 0, resized: 0 }));
  t.after(() => {
    globalThis.fetch = originalFetch;
    setMediaStorageForTests(undefined);
    setVideoProvidersForTests(undefined);
    setPersonSafeReferencePhotosForTests(undefined);
  });
  const s = await admittedProductMutationScenario(storage);
  const snapshotRaw = (db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(s.jobId) as { job_product_snapshot: string }).job_product_snapshot;
  const admissionSnapshot = parseJobProductSnapshot(snapshotRaw);

  const mutation = {
    name: "Nama Mutasi E3 Deterministik", price_idr: 72000, category: "beauty",
    product_visual_desc: "DESC-MUTASI-E3-DETERMINISTIK", brand: "Merek Mutasi E3 Deterministik",
    promo_price_before_idr: 99000, promo_ends_at: "2030-01-02T03:04:05.000Z", promo_stock_left: 7,
  };
  const forbidden = await patchRetailRequest(s.productId, s.intruderToken, mutation);
  assert.equal(forbidden.status, 404, "intruder dapat memutasi E3");
  assert.equal((db.prepare("SELECT name FROM products WHERE id=?").get(s.productId) as { name: string }).name, "Serum Admission E3");
  const response = await patchRetailRequest(s.productId, s.ownerToken, mutation);
  if (response.status !== 200) assert.fail(`PATCH E3 gagal (${response.status}): ${await response.text()}`);
  const confirmation = db.prepare(`SELECT product_type_token,product_type_confirmed_by,
    product_type_confirmed_at,product_type_version,product_type_state FROM products WHERE id=?`)
    .get(s.productId) as { product_type_token: string; product_type_confirmed_by: string; product_type_confirmed_at: string; product_type_version: number; product_type_state: string };
  assert.deepEqual(await response.json(), {
    ok: true, product_id: s.productId, name: mutation.name, price_idr: mutation.price_idr, category: mutation.category,
    product_type: "serum wajah",
    product_type_confirmation: {
      state: "CONFIRMED", actor_id: confirmation.product_type_confirmed_by,
      confirmed_at: confirmation.product_type_confirmed_at, version: 1, provenance: "USER_SELF_ASSERTION",
    },
    category_review: {
      state: "CLEAR", reason: null, reviewed_by: null, reviewed_role: null, reviewed_at: null, version: 1,
    },
  });
  const auditMeta = JSON.parse((db.prepare(
    "SELECT meta FROM audit_log WHERE entity_id=? AND action='product.updated' ORDER BY created_at DESC LIMIT 1"
  ).get(s.productId) as { meta: string }).meta) as Record<string, unknown>;
  assert.deepEqual({
    product_type: auditMeta.product_type, state: auditMeta.product_type_state,
    provenance: auditMeta.product_type_confirmation, actor: auditMeta.product_type_confirmed_by,
    confirmed_at: auditMeta.product_type_confirmed_at, version: auditMeta.product_type_version,
  }, {
    product_type: "serum wajah", state: "CONFIRMED", provenance: "USER_SELF_ASSERTION",
    actor: confirmation.product_type_confirmed_by, confirmed_at: confirmation.product_type_confirmed_at, version: 1,
  });
  const current = db.prepare(
    "SELECT name,price_idr,category,product_visual_desc,brand_brief,claims,raw_meta,promo_price_before_idr,promo_ends_at,promo_stock_left FROM products WHERE id=?"
  ).get(s.productId) as {
    name: string; price_idr: number; category: string; product_visual_desc: string | null; brand_brief: string | null;
    claims: string | null; raw_meta: string | null; promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null;
  };
  assert.equal(current.name, mutation.name); assert.equal(current.category, mutation.category); assert.equal(current.price_idr, mutation.price_idr);
  assert.equal(current.product_visual_desc, mutation.product_visual_desc);
  assert.equal((JSON.parse(current.raw_meta ?? "{}") as { brand?: string }).brand, mutation.brand);
  assert.equal(current.promo_price_before_idr, mutation.promo_price_before_idr);
  assert.equal(current.promo_ends_at, mutation.promo_ends_at); assert.equal(current.promo_stock_left, mutation.promo_stock_left);
  assert.deepEqual(admissionSnapshot, {
    version: 4, productName: "Serum Admission E3", category: "beauty", categoryReviewVersion: 1, priceIdr: 85_000,
    promoPriceBeforeIdr: null, promoEndsAt: null, promoStockLeft: null,
    trustedBrand: { source: "products.raw_meta.brand", value: "Merek Admission E3" },
    productVisualDesc: "BOTOL-ADMISSION-E3", brandBrief: "BRIEF-ADMISSION-E3", claims: ["klaim admission E3"],
  });
  const rereadCurrent = parseJobProductSnapshot(createJobProductSnapshotRaw({...current, category_review_version: 1}));
  assert.notDeepEqual(rereadCurrent, admissionSnapshot, "counterexample re-read current tidak berbeda dari admission");
  assert.equal(rereadCurrent.productName, mutation.name); assert.equal(rereadCurrent.priceIdr, mutation.price_idr); assert.equal(rereadCurrent.trustedBrand.value, mutation.brand);

  let providerCalls = 0; let prompt = "";
  setVideoProvidersForTests([{ name: "e3-c9-observer", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate(spec: { shots: { prompt: string }[] }) {
      providerCalls++; prompt = spec.shots.map((shot) => shot.prompt).join("\n"); throw new Error("observer stop");
    } } as never]);
  storage.putCalls.length = 0; // admission snapshot writes are setup, not worker output.
  await processJob(s.jobId);
  assert.equal(providerCalls, 1, "E3 proof tidak mencapai provider");
  assert.match(prompt, /Serum Admission E3/); assert.match(prompt, /BOTOL-ADMISSION-E3/); assert.match(prompt, /BRIEF-ADMISSION-E3/);
  assert.doesNotMatch(prompt, /Nama Mutasi E3 Deterministik|DESC-MUTASI-E3-DETERMINISTIK/);
  assert.equal((db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(s.jobId) as { job_product_snapshot: string }).job_product_snapshot, snapshotRaw);
  assert.equal(networkCalls, 0, "E3 C9 menyentuh jaringan");
  noPaidSideEffects(s.jobId, storage);
});

test("C9 E3→W2: gain/removal setelah admission tidak mengubah promo frame snapshot", async (t) => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls++; throw new Error("C9 compositor W2 tidak boleh jaringan"); }) as typeof fetch;
  setPersonSafeReferencePhotosForTests(async (photoPaths) => ({ safe: [...photoPaths], cropped: 0, dropped: 0, resized: 0 }));
  t.after(() => {
    globalThis.fetch = originalFetch;
    setMediaStorageForTests(undefined);
    setVideoProvidersForTests(undefined);
    setPersonSafeReferencePhotosForTests(undefined);
    setCompositeObserverForTests(undefined);
    setSqliteQcRunnerForTests(undefined);
  });

  const renderedCrops = new Map<string, string>();
  for (const variant of ["gain", "remove"] as const) {
    const storage = new MemoryStorage();
    const s = await admittedProductMutationScenario(
      storage,
      variant === "remove"
        ? ({ productId }) => db.prepare(
            "UPDATE products SET promo_price_before_idr=110000,promo_ends_at='2031-01-02T03:04:05.000Z',promo_stock_left=11 WHERE id=?"
          ).run(productId)
        : undefined
    );
    const snapshotRaw = (db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(s.jobId) as { job_product_snapshot: string }).job_product_snapshot;
    const admissionSnapshot = parseJobProductSnapshot(snapshotRaw);
    assert.equal(admissionSnapshot.productName, "Serum Admission E3");
    assert.equal(admissionSnapshot.priceIdr, 85_000);
    assert.deepEqual({
      before: admissionSnapshot.promoPriceBeforeIdr,
      ends: admissionSnapshot.promoEndsAt,
      stock: admissionSnapshot.promoStockLeft,
    }, variant === "gain"
      ? { before: null, ends: null, stock: null }
      : { before: 110_000, ends: "2031-01-02T03:04:05.000Z", stock: 11 });

    const mutation = variant === "gain"
      ? {
          name: "Nama Mutasi Promo Gain E3", price_idr: 72_000, category: "beauty",
          product_visual_desc: "DESC-MUTASI-PROMO-GAIN-E3", brand: "Merek Mutasi Promo Gain E3",
          promo_price_before_idr: 99_000, promo_ends_at: "2031-02-03T04:05:06.000Z", promo_stock_left: 7,
        }
      : {
          name: "Nama Mutasi Promo Remove E3", price_idr: 72_000, category: "beauty",
          product_visual_desc: "DESC-MUTASI-PROMO-REMOVE-E3", brand: "Merek Mutasi Promo Remove E3",
          promo_price_before_idr: null, promo_ends_at: null, promo_stock_left: null,
        };
    const response = await patchRetailRequest(s.productId, s.ownerToken, mutation);
    if (response.status !== 200) assert.fail(`PATCH promo E3 ${variant} gagal (${response.status}): ${await response.text()}`);
    const live = db.prepare(
      "SELECT promo_price_before_idr,promo_ends_at,promo_stock_left FROM products WHERE id=?"
    ).get(s.productId) as { promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null };
    assert.deepEqual(live, variant === "gain"
      ? { promo_price_before_idr: 99_000, promo_ends_at: "2031-02-03T04:05:06.000Z", promo_stock_left: 7 }
      : { promo_price_before_idr: null, promo_ends_at: null, promo_stock_left: null });

    let providerPrompt = "";
    setVideoProvidersForTests([{ name: `mock-c9-w2-${variant}`, async healthCheck() { return true; }, estimateCost() { return 0; },
      async generate(spec: { shots: { prompt: string; durationSec: number }[] }, outDir: string) {
        providerPrompt = spec.shots.map((shot) => shot.prompt).join("\n");
        return spec.shots.map((shot, index) => {
          const filePath = path.join(outDir, `c9-${variant}-${index}.mp4`);
          execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
            `color=c=gray:s=360x640:r=24:d=${shot.durationSec}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", filePath]);
          return { filePath, durationSec: shot.durationSec, costIdr: 0 };
        });
      } } as never]);
    let compositorInput: import("../lib/media/compositor").CompositeInput | null = null;
    let demoAtSec = 0;
    setCompositeObserverForTests((input) => {
      compositorInput = { ...input };
      demoAtSec = (input.demoRange[0] + input.demoRange[1]) / 2;
    });
    let rendered = { ocr: "", cropSha: "", cropBytes: 0 };
    setSqliteQcRunnerForTests(async (input) => {
      rendered = inspectDemoOverlay(input.filePath, `w2-${variant}`, demoAtSec);
      console.log(`[c9-rendered-frame] ${JSON.stringify({ runtime: "W2", variant, demoAtSec, ...rendered })}`);
      throw new Error(`C9_RENDERED_FRAME_OBSERVED_${variant.toUpperCase()}`);
    });
    storage.putCalls.length = 0;
    await processJob(s.jobId);

    assert.match(providerPrompt, /Serum Admission E3/);
    assert.match(providerPrompt, /BOTOL-ADMISSION-E3/);
    assert.doesNotMatch(providerPrompt, /Nama Mutasi Promo|DESC-MUTASI-PROMO/);
    const observed = compositorInput as unknown as import("../lib/media/compositor").CompositeInput;
    assert.ok(observed, `W2 ${variant} tidak mencapai compositeVideo`);
    assert.equal(observed.mode, "vo");
    if (variant === "gain") {
      assert.equal(observed.priceInCaptionMode, false);
      assert.equal(observed.priceText, "Cuma Rp85.000");
      assert.match(rendered.ocr, /Rp.{0,2}[8S]?5[:.]000/i, `frame gain tidak mempertahankan no-promo admission: ${rendered.ocr}`);
      assert.doesNotMatch(rendered.ocr, />|%|s.d.?|Feb/i, `frame gain membaca promo live: ${rendered.ocr}`);
    } else {
      assert.equal(observed.priceInCaptionMode, false);
      assert.equal(observed.priceText, "Rp110.000 > Rp85.000\n-23% · s.d. 2 Jan");
      assert.match(rendered.ocr, /Rp110.{0,3}000.{0,4}Rp.{0,2}[8S]?5[:.]000/i, `frame removal kehilangan dua harga admission: ${rendered.ocr}`);
      assert.match(rendered.ocr, /23.{0,4}%/i, `frame removal kehilangan diskon admission: ${rendered.ocr}`);
      assert.match(rendered.ocr, /s.d.?\S*\s*2\)?\s*Jan/i, `frame removal kehilangan deadline admission: ${rendered.ocr}`);
    }
    assert.equal((db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(s.jobId) as { job_product_snapshot: string }).job_product_snapshot, snapshotRaw);
    const count = (sql: string) => (db.prepare(sql).get(s.jobId) as { n: number }).n;
    assert.equal(count("SELECT COUNT(*) n FROM outputs WHERE job_id=?"), 0);
    assert.equal(count("SELECT COUNT(*) n FROM credit_ledger WHERE job_id=? AND type IN ('capture','regen')"), 0);
    const job = db.prepare("SELECT state,provider_video,provider_voice,output_url,cost_actual_idr FROM jobs WHERE id=?").get(s.jobId) as {
      state: string; provider_video: string | null; provider_voice: string | null; output_url: string | null; cost_actual_idr: number;
    };
    assert.ok(["FAILED", "REFUNDED"].includes(job.state), `W2 ${variant} berhenti di ${job.state}`);
    assert.equal(job.output_url, null);
    assert.equal(job.provider_video, `mock-c9-w2-${variant}`);
    assert.match(job.provider_voice ?? "", /^mock-voice-/);
    assert.equal(job.cost_actual_idr, 300, "biaya fixture voice lokal berubah; ini bukan provider berbayar/network");
    assert.deepEqual(storage.putCalls.filter((key) => !key.includes("/approved-references/")), [],
      `W2 ${variant} menulis output storage sebelum sentinel QC pasca-render`);
    setCompositeObserverForTests(undefined);
    setSqliteQcRunnerForTests(undefined);
    assert.ok(rendered.cropBytes > 1_000, `crop frame demo ${variant} tidak substantif`);
    renderedCrops.set(variant, rendered.cropSha);
  }
  assert.notEqual(renderedCrops.get("gain"), renderedCrops.get("remove"),
    "crop frame no-promo/promo admission identik");
  assert.equal(networkCalls, 0, "counterexample C9 W2 menyentuh jaringan");
});

test("admission W2 -> queue delay -> E5 hapus source tetap memakai bytes admission tanpa install worker", async (t) => {
  const storage = new MemoryStorage();
  const s = await admittedProductMutationScenario(storage);
  setPersonSafeReferencePhotosForTests(async (photoPaths) => ({ safe: [...photoPaths], cropped: 0, dropped: 0, resized: 0 }));
  t.after(() => {
    setMediaStorageForTests(undefined);
    setPersonSafeReferencePhotosForTests(undefined);
  });
  const before = db.prepare(
    "SELECT approved_reference_manifest FROM jobs WHERE id=?"
  ).get(s.jobId) as { approved_reference_manifest: string };
  assert.ok(before.approved_reference_manifest, "admission W2 commit tanpa manifest");
  const manifest = JSON.parse(before.approved_reference_manifest) as {
    references: { rel: string; snapshotRel: string; sha256: string }[];
  };
  assert.deepEqual(manifest.references.map((ref) => ref.rel), [s.approvedSource]);
  const snapshotRel = manifest.references[0].snapshotRel;
  assert.deepEqual(storage.values.get(snapshotRel), s.approvedBytes, "bytes job-owned tidak siap saat admission commit");

  const deleted = await deleteRequest(s.productId, s.approvedSource, s.ownerToken);
  assert.equal(deleted.status, 200);
  assert.equal(storage.values.has(s.approvedSource), false, "E5 tidak menghapus source produk aktual");
  assert.equal(storage.values.has(snapshotRel), true, "E5 menghapus bytes privat admission");

  storage.putCalls.length = 0;
  let providerCalls = 0; let providerHash = "";
  setVideoProvidersForTests([{ name: "admission-e5-w2-observer", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate(spec: { shots: { imageRefPath: string }[] }) {
      providerCalls++;
      providerHash = sha(fs.readFileSync(spec.shots[0].imageRefPath));
      throw new Error("observer stop");
    } } as never]);
  await processJob(s.jobId);
  const transitions = db.prepare("SELECT meta FROM audit_log WHERE entity_id=? AND action='job.transition' ORDER BY created_at").all(s.jobId) as { meta: string }[];
  assert.equal(providerCalls, 1, `first W2 tidak mencapai provider: ${JSON.stringify(transitions)}`);
  assert.equal(providerHash, sha(s.approvedBytes), "first W2 tidak memakai bytes admission");
  assert.equal(storage.putCalls.filter((key) => key.includes("/approved-references/")).length, 0,
    "first W2 meng-install ulang manifest yang seharusnya sudah ada");
  const after = db.prepare("SELECT approved_reference_manifest FROM jobs WHERE id=?").get(s.jobId) as { approved_reference_manifest: string };
  assert.equal(after.approved_reference_manifest, before.approved_reference_manifest, "worker mengganti manifest admission");
  noPaidSideEffects(s.jobId, storage);
});

test("SQLite admission mengulang bounded saat exact images berubah sebelum INSERT", async (t) => {
  const storage = new MemoryStorage();
  const secondRel = `uploads/sqlite-admission-race-${process.pid}/second.webp`;
  const secondBytes = Buffer.from("SQLITE-ADMISSION-RACE-SECOND");
  let firstPreparedKey = "";
  const s = await admittedProductMutationScenario(storage, ({ productId }) => {
    storage.values.set(secondRel, secondBytes);
    storage.values.set(`${secondRel}.meta.json`, approvedSidecar(secondBytes));
    storage.onApprovedReferencePut = (key) => {
      storage.onApprovedReferencePut = null;
      firstPreparedKey = key;
      db.prepare("UPDATE products SET images=? WHERE id=?").run(JSON.stringify([secondRel]), productId);
    };
  });
  t.after(() => setMediaStorageForTests(undefined));

  const row = db.prepare(
    "SELECT approved_reference_manifest FROM jobs WHERE id=?"
  ).get(s.jobId) as { approved_reference_manifest: string };
  const manifest = JSON.parse(row.approved_reference_manifest) as { references: { rel: string; snapshotRel: string }[] };
  assert.deepEqual(manifest.references.map((ref) => ref.rel), [secondRel],
    "admission commit memakai candidate images sebelum mutation race");
  assert.deepEqual(storage.values.get(manifest.references[0].snapshotRel), secondBytes);
  assert.ok(firstPreparedKey && firstPreparedKey !== manifest.references[0].snapshotRel,
    "fixture tidak memicu re-prepare dengan key deterministik berbeda");
  assert.equal(storage.values.has(firstPreparedKey), false,
    "successful re-prepare meninggalkan snapshot attempt lama");
  assert.deepEqual(
    new Set([...storage.values.keys()].filter((key) => key.startsWith(`jobs/${s.jobId}/approved-references/`))),
    new Set(manifest.references.map((ref) => ref.snapshotRel)),
    "retained key job bukan persis committed manifest"
  );
  const holds = (db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE job_id=? AND type='hold'").get(s.jobId) as { n: number }).n;
  assert.equal(holds, 1, "bounded re-prepare membuat hold ganda");
});

test("A1 SQLite menolak quarantine yang menyelip setelah precheck tanpa job atau hold", async (t) => {
  const storage = new MemoryStorage();
  const s = await rawAdmissionCandidate(storage, `type-quarantine-${process.pid}`, 50_000);
  t.after(() => setMediaStorageForTests(undefined));
  let mutated = false;
  storage.onApprovedReferencePut = () => {
    if (mutated) return;
    mutated = true;
    db.prepare("UPDATE products SET product_type_state='QUARANTINED' WHERE id=?").run(s.productId);
  };

  const response = await s.submit();
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { code: string }).code, "PRODUCT_TYPE_CONFIRMATION_REQUIRED");
  assert.equal(mutated, true, "fixture tidak memutasi C2 setelah precheck");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE product_id=?").get(s.productId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND type='hold'").get(s.ownerId) as { n: number }).n, 0);
  assert.deepEqual(
    [...storage.values.keys()].filter((key) => key.includes("/approved-references/")),
    [],
    "C2 race rejection meninggalkan prepared snapshot",
  );
});

test("A1 locked C2 recheck rejects quarantine before creator persona, audit, and trace nonce", async (t) => {
  const oldAuthSecret = process.env.AUTH_SECRET;
  const secret = "c2-race-managed-staging-secret-32-bytes";
  process.env.AUTH_SECRET = secret;
  t.after(() => {
    if (oldAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = oldAuthSecret;
    setManagedStagingTraceAuthorizationContextForTests(undefined);
  });
  const storage = new MemoryStorage();
  const s = await rawAdmissionCandidate(storage, `type-effects-race-${process.pid}`, 50_000);
  t.after(() => setMediaStorageForTests(undefined));
  const lease = await acquireAdmissionReferenceEvidence({
    productId: s.productId,
    owner: { kind: "user", id: s.ownerId },
    boundary: "A7",
    loadSqliteCandidateRels: () => [s.approvedSource],
  });

  const liveSha = "a".repeat(40);
  const traceNow = Date.now();
  setManagedStagingTraceAuthorizationContextForTests({ env: {
    NODE_ENV: "production",
    RACUN_DEPLOY_ENV: "staging",
    RENDER_SERVICE_ID: MANAGED_STAGING_WEB_SERVICE_ID,
    RENDER_GIT_COMMIT: liveSha,
    AUTH_SECRET: secret,
  }, nowMs: traceNow });
  const nonce = "d".repeat(32);
  const trace = managedStagingTraceHeader(secret, liveSha, {
    userId: s.ownerId,
    scriptId: s.scriptId,
    format: "hands_only",
    qualityTier: "high_quality",
    durationS: 15,
  }, { nonce, nowMs: traceNow });

  let settled = false;
  const admission = s.submit(
    { creator_category: "hijaber" },
    { [MANAGED_STAGING_TRACE_HEADER]: trace },
  ).finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false, "admission did not reach the shared product lock");
  db.prepare("UPDATE products SET product_type_state='QUARANTINED' WHERE id=?").run(s.productId);
  await lease.release();

  const response = await admission;
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { code: string }).code, "PRODUCT_TYPE_CONFIRMATION_REQUIRED");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM personas WHERE user_id=?").get(s.ownerId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE actor=? AND action='persona.created'").get(s.ownerId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE product_id=?").get(s.productId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND type='hold'").get(s.ownerId) as { n: number }).n, 0);
  // The supplied capability is valid. A Redis nonce claim would surface as a
  // queue dependency error in this isolated SQLite fixture; the C2 response
  // proves rejection occurred before that call.
});

test("E3 ordinary SQLite menunggu evidence lease lalu mempertahankan reconfirmation terbaru", async (t) => {
  const storage = new MemoryStorage();
  const s = await rawAdmissionCandidate(storage, `e3-c2-lock-${process.pid}`, 50_000);
  t.after(() => setMediaStorageForTests(undefined));
  const lease = await acquireAdmissionReferenceEvidence({
    productId: s.productId,
    owner: { kind: "user", id: s.ownerId },
    boundary: "A7",
    loadSqliteCandidateRels: () => [s.approvedSource],
  });
  let settled = false;
  const paused = patchRetailRequest(s.productId, s.token, { name: "Detail ordinary sesudah lock" })
    .finally(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "E3 tidak menunggu product evidence lock");

  const latestAt = "2026-08-27T12:34:56.000Z";
  db.prepare(`UPDATE products SET product_type_token='serum terbaru', product_type_confirmed_token='serum terbaru',
    product_type_confirmed_at=?, product_type_state='CONFIRMED' WHERE id=?`).run(latestAt, s.productId);
  await lease.release();
  const response = await paused;
  assert.equal(response.status, 200, await response.text());
  const row = db.prepare(`SELECT name,product_type_token,product_type_confirmed_token,product_type_confirmed_at
    FROM products WHERE id=?`).get(s.productId) as Record<string, unknown>;
  assert.deepEqual(row, {
    name: "Detail ordinary sesudah lock", product_type_token: "serum terbaru",
    product_type_confirmed_token: "serum terbaru", product_type_confirmed_at: latestAt,
  });
});

test("storage preparation gagal sebelum job, hold, dan queue visibility SQLite", async (t) => {
  const storage = new MemoryStorage();
  let productId = "", ownerId = "";
  await assert.rejects(
    () => admittedProductMutationScenario(storage, (ids) => {
      ({ productId, ownerId } = ids);
      storage.onApprovedReferencePut = () => { throw new Error("injected admission storage failure"); };
    }),
    /admission E3 gagal \(500\)/
  );
  t.after(() => setMediaStorageForTests(undefined));
  assert.ok(productId && ownerId, "fixture gagal mencapai preparation boundary");
  const jobs = (db.prepare("SELECT COUNT(*) n FROM jobs WHERE product_id=?").get(productId) as { n: number }).n;
  const holds = (db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND type='hold'").get(ownerId) as { n: number }).n;
  assert.equal(jobs, 0, "storage failure meninggalkan job visible");
  assert.equal(holds, 0, "storage failure meninggalkan hold");
  assert.deepEqual([...storage.values.keys()].filter((key) => key.includes("/approved-references/")), [],
    "PUT yang gagal sesudah menulis bytes meninggalkan orphan walau jobId terbukti absent");
});

test("SQLite saldo known-insufficient ditolak sebelum PUT, job, dan hold", async (t) => {
  const storage = new MemoryStorage();
  const s = await rawAdmissionCandidate(storage, `insufficient-${process.pid}`, 0);
  t.after(() => setMediaStorageForTests(undefined));
  const response = await s.submit();
  assert.equal(response.status, 402);
  assert.equal((await response.json() as { code: string }).code, "INSUFFICIENT_CREDITS");
  assert.equal(storage.putCalls.filter((key) => key.includes("/approved-references/")).length, 0,
    "saldo insufficient sudah menulis snapshot storage");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE product_id=?").get(s.productId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND type='hold'").get(s.ownerId) as { n: number }).n, 0);
});

test("dua admission SQLite konkuren menyisakan hanya object milik job pemenang", async (t) => {
  const storage = new MemoryStorage();
  const s = await rawAdmissionCandidate(storage, `duplicate-${process.pid}`, 50_000);
  t.after(() => setMediaStorageForTests(undefined));
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const released = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  let prepared = 0;
  storage.onApprovedReferencePut = async () => {
    if (++prepared === 1) {
      firstStarted();
      await released;
    }
  };

  const firstPromise = s.submit();
  await started;
  const secondPromise = s.submit();
  // A1 now shares the product-operation lock with C2 quarantine. The second
  // admission must wait, then observe the first durable winner as a duplicate
  // without preparing its own storage prefix.
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseFirst();
  const [firstResponse, secondResponse] = await Promise.all([firstPromise, secondPromise]);
  const responses = [firstResponse, secondResponse];
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ job_id: string; duplicate?: boolean }>));
  assert.equal(new Set(bodies.map((body) => body.job_id)).size, 1, "dua request tidak menunjuk satu pemenang");
  assert.equal(bodies.filter((body) => body.duplicate).length, 1);
  const winnerId = bodies[0].job_id;
  const row = db.prepare("SELECT approved_reference_manifest FROM jobs WHERE id=?").get(winnerId) as { approved_reference_manifest: string };
  const winnerKeys = new Set((JSON.parse(row.approved_reference_manifest) as { references: { snapshotRel: string }[] }).references.map((ref) => ref.snapshotRel));
  const retainedKeys = [...storage.values.keys()].filter((key) => key.includes("/approved-references/"));
  assert.deepEqual(new Set(retainedKeys), winnerKeys, "object prefix admission yang kalah masih tertinggal");
  assert.equal(prepared, 1, "serialized duplicate masih menyiapkan object admission kedua");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE product_id=?").get(s.productId) as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND type='hold'").get(s.ownerId) as { n: number }).n, 1);
});

test("SQLite images berubah sampai retry habis membersihkan seluruh prepared prefix", async (t) => {
  const storage = new MemoryStorage();
  const s = await rawAdmissionCandidate(storage, `exhausted-${process.pid}`, 50_000);
  t.after(() => setMediaStorageForTests(undefined));
  const first = `uploads/admission-exhausted-${process.pid}/first.webp`;
  const second = `uploads/admission-exhausted-${process.pid}/second.webp`;
  for (const [rel, bytes] of [[first, Buffer.from("EXHAUSTED-FIRST")], [second, Buffer.from("EXHAUSTED-SECOND")]] as const) {
    storage.values.set(rel, bytes);
    storage.values.set(`${rel}.meta.json`, approvedSidecar(bytes));
  }
  db.prepare("UPDATE products SET images=? WHERE id=?").run(JSON.stringify([first]), s.productId);
  let mutation = 0;
  storage.onApprovedReferencePut = () => {
    const next = mutation++ % 2 === 0 ? second : first;
    db.prepare("UPDATE products SET images=? WHERE id=?").run(JSON.stringify([next]), s.productId);
  };
  const response = await s.submit();
  assert.equal(response.status, 400);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE product_id=?").get(s.productId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND type='hold'").get(s.ownerId) as { n: number }).n, 0);
  assert.deepEqual([...storage.values.keys()].filter((key) => key.includes("/approved-references/")), [],
    "retry exhaustion meninggalkan prepared keys walau jobId terbukti absent");
});

test("E5 HTTP DELETE approved source + resume W2 tetap memakai snapshot job berurutan", async (t) => {
  const s = await scenario("stable");
  const storage = new MemoryStorage();
  storage.values.set(s.approvedSource, s.approvedBytes);
  storage.values.set(`${s.approvedSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.approvedSecondSource, s.approvedSecondBytes);
  storage.values.set(`${s.approvedSecondSource}.meta.json`, approvedSidecar(s.approvedSecondBytes));
  storage.values.set(s.otherSource, Buffer.from("OTHER"));
  storage.values.set(`${s.otherSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.snapshotRel, s.approvedBytes);
  storage.values.set(s.snapshotRelSecond, s.approvedSecondBytes);
  setMediaStorageForTests(storage); t.after(() => setMediaStorageForTests(undefined));

  const forbidden = await deleteRequest(s.productId, s.approvedSource, s.intruderToken);
  assert.equal(forbidden.status, 404, "user lain dapat menghapus foto retail owner");
  assert.deepEqual(currentImages(s.productId), [s.approvedSource, s.approvedSecondSource, s.otherSource]);

  const response = await deleteRequest(s.productId, s.approvedSource, s.ownerToken);
  const body = await response.json() as { images: string[]; cleanup_failed: boolean };
  assert.equal(response.status, 200);
  assert.equal(body.cleanup_failed, false);
  assert.deepEqual(body.images, [s.approvedSecondSource, s.otherSource]);
  assert.deepEqual(currentImages(s.productId), body.images, "response E5 bukan daftar pasca-mutasi otoritatif");
  assert.equal(storage.values.has(s.approvedSource), false, "approved source E5 tidak dibersihkan");
  assert.equal(storage.values.has(`${s.approvedSource}.meta.json`), false, "sidecar approved source E5 tidak dibersihkan");
  assert.deepEqual(storage.deleteCalls, [s.approvedSource, `${s.approvedSource}.meta.json`, `${s.approvedSource}.rights.json`, `${s.approvedSource}.rights.json.revoked.json`], "cleanup E5 menyasar object yang salah");
  assert.equal(storage.values.has(s.approvedSecondSource), true, "approved source kedua ikut terhapus");
  assert.equal(storage.values.has(`${s.approvedSecondSource}.meta.json`), true, "sidecar approved kedua ikut terhapus");
  assert.equal(storage.values.has(s.snapshotRel), true, "cleanup E5 menghapus object privat job");

  const currentResolution = await resolveApprovedReference(currentImages(s.productId));
  assert.equal(currentResolution.utama?.rel, s.approvedSecondSource, "resolver canonical tidak memilih source #2 dari daftar pasca-DELETE");
  assert.equal(currentResolution.utama?.sha256, sha(s.approvedSecondBytes), "resolver canonical memilih identitas bytes source #2 yang salah");
  assert.deepEqual(currentResolution.tersetujui.map((ref) => ref.rel), [s.approvedSecondSource], "daftar current-policy pasca-DELETE bukan counterexample tunggal source #2");

  let providerCalls = 0; let providerHash = "";
  setVideoProvidersForTests([{ name: "e5-observer", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate(spec: { shots: { imageRefPath: string }[] }) {
      providerCalls++;
      providerHash = sha(fs.readFileSync(spec.shots[0].imageRefPath));
      throw new Error("observer stop");
    } } as never]);
  await processJob(s.jobId);
  assert.equal(providerCalls, 1, "resume W2 tidak mencapai provider observer");
  assert.equal(providerHash, sha(s.approvedBytes), "resume memilih approved kedua dari current list, bukan snapshot job lama");
  assert.deepEqual(storage.materializeCalls.slice(0, 2), [s.snapshotRel, s.snapshotRelSecond], "urutan manifest W2 berubah saat resume");
  noPaidSideEffects(s.jobId, storage);
});

test("E5 HTTP DELETE yang membuat object manifest hilang gagal tertutup sebelum provider", async (t) => {
  const s = await scenario("missing");
  const storage = new MemoryStorage();
  storage.values.set(s.approvedSource, s.approvedBytes);
  storage.values.set(`${s.approvedSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.approvedSecondSource, s.approvedSecondBytes);
  storage.values.set(`${s.approvedSecondSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.otherSource, Buffer.from("OTHER"));
  storage.values.set(`${s.otherSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.snapshotRel, s.approvedBytes);
  storage.values.set(s.snapshotRelSecond, s.approvedSecondBytes);
  // Storage seam models an object lifecycle/cascade fault during the actual
  // E5 cleanup call; DB mutation still happens only through the HTTP handler.
  storage.cascade.set(s.approvedSource, s.snapshotRel);
  setMediaStorageForTests(storage); t.after(() => setMediaStorageForTests(undefined));
  let providerCalls = 0;
  setVideoProvidersForTests([{ name: "must-not-run", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate() { providerCalls++; throw new Error("provider called"); } } as never]);

  const response = await deleteRequest(s.productId, s.approvedSource, s.ownerToken);
  const body = await response.json() as { images: string[] };
  assert.equal(response.status, 200);
  assert.deepEqual(body.images, [s.approvedSecondSource, s.otherSource]);
  assert.deepEqual(currentImages(s.productId), body.images);
  assert.equal(storage.values.has(s.snapshotRel), false, "fixture tidak benar-benar menghilangkan object manifest");

  await processJob(s.jobId);
  assert.equal(providerCalls, 0, "manifest missing mencapai provider");
  noPaidSideEffects(s.jobId, storage);
  const audit = db.prepare("SELECT meta FROM audit_log WHERE entity_id=? AND action='job.transition' ORDER BY created_at").all(s.jobId) as { meta: string }[];
  assert.ok(audit.some((row) => row.meta.includes("REF_MISSING")), "alasan truthful REF_MISSING tidak tercatat");
});

test("guard: bukti C12 memanggil handler E5 dan resume W2 nyata", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(source, /DELETE: deleteRetailPhoto/);
  assert.match(source, /await deleteRequest/);
  assert.match(source, /await processJob\(s\.jobId\)/);
});
