import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.DB_PATH = path.join(os.tmpdir(), `racun-http-mutation-w2-${process.pid}.db`);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "http-mutation-w2-store-"));

const { getDb, now, uuid } = await import("../lib/db");
const { issueToken, cookieName } = await import("../lib/auth");
const { setMediaStorageForTests } = await import("../lib/storage");
const { setVideoProvidersForTests } = await import("../lib/providers/registry");
const { setPersonSafeReferencePhotosForTests } = await import("../lib/media/person-safe-refs");
const { resolveApprovedReference } = await import("../lib/product-truth");
const { createJobProductSnapshotRaw, parseJobProductSnapshot } = await import("../lib/job-product-snapshot");
const { DELETE: deleteRetailPhoto } = await import("../app/api/products/[id]/photos/route");
const { PATCH: patchRetailProduct } = await import("../app/api/products/[id]/route");
const { processJob } = await import("../lib/worker");
type MediaStorage = import("../lib/storage").MediaStorage;

const db = getDb();
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
  }));
}

after(() => {
  setMediaStorageForTests(undefined);
  setVideoProvidersForTests(undefined);
  fs.rmSync(tempMaterialize, { recursive: true, force: true });
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  deleteCalls: string[] = [];
  putCalls: string[] = [];
  materializeCalls: string[] = [];
  cascade = new Map<string, string>();
  async put(key: string, body: Buffer) { this.putCalls.push(key); this.values.set(key, Buffer.from(body)); }
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
  db.prepare(
    `INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
     VALUES (?,?,'H1','senang','bestie',?,'caption','[]','{}','silent_caption',?,?)`
  ).run(scriptId, productId, JSON.stringify(segments), timestamp, timestamp);
  const manifest = JSON.stringify({
    version: 1,
    references: [
      { rel: approvedSource, sha256: sha(approvedBytes), versiBukti: 1, snapshotRel },
      { rel: approvedSecondSource, sha256: sha(approvedSecondBytes), versiBukti: 1, snapshotRel: snapshotRelSecond },
    ],
  });
  const productSnapshot = createJobProductSnapshotRaw({ name: `Serum ${label}`, category: "beauty", raw_meta: JSON.stringify({ brand: "Merek Awal" }) });
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

async function admittedProductMutationScenario(storage: MemoryStorage) {
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
  db.prepare(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
     VALUES (?,?,'H1','senang','bestie',?,'caption','[]','{}','high_quality',?,?)`
  ).run(scriptId, productId, JSON.stringify(admissionSegments), timestamp, timestamp);
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES (?,?,50000,'bonus',?)")
    .run(uuid(), ownerId, timestamp);
  storage.values.set(approvedSource, approvedBytes);
  storage.values.set(`${approvedSource}.meta.json`, approvedSidecar(approvedBytes));
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
    name: "Nama Mutasi E3 Deterministik", price_idr: 72000, category: "food",
    product_visual_desc: "DESC-MUTASI-E3-DETERMINISTIK", brand: "Merek Mutasi E3 Deterministik",
    promo_price_before_idr: 99000, promo_ends_at: "2030-01-02T03:04:05.000Z", promo_stock_left: 7,
  };
  const forbidden = await patchRetailRequest(s.productId, s.intruderToken, mutation);
  assert.equal(forbidden.status, 404, "intruder dapat memutasi E3");
  assert.equal((db.prepare("SELECT name FROM products WHERE id=?").get(s.productId) as { name: string }).name, "Serum Admission E3");
  const response = await patchRetailRequest(s.productId, s.ownerToken, mutation);
  if (response.status !== 200) assert.fail(`PATCH E3 gagal (${response.status}): ${await response.text()}`);
  assert.deepEqual(await response.json(), {
    ok: true, product_id: s.productId, name: mutation.name, price_idr: mutation.price_idr, category: mutation.category,
  });
  const current = db.prepare(
    "SELECT name,price_idr,category,product_visual_desc,brand_brief,claims,raw_meta,promo_price_before_idr,promo_ends_at,promo_stock_left FROM products WHERE id=?"
  ).get(s.productId) as {
    name: string; price_idr: number; category: string; product_visual_desc: string | null; brand_brief: string | null;
    claims: string | null; raw_meta: string | null; promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null;
  };
  assert.equal(current.name, mutation.name); assert.equal(current.category, mutation.category);
  assert.equal(current.product_visual_desc, mutation.product_visual_desc);
  assert.equal((JSON.parse(current.raw_meta ?? "{}") as { brand?: string }).brand, mutation.brand);
  assert.equal(current.promo_price_before_idr, mutation.promo_price_before_idr);
  assert.equal(current.promo_ends_at, mutation.promo_ends_at); assert.equal(current.promo_stock_left, mutation.promo_stock_left);
  assert.deepEqual(admissionSnapshot, {
    version: 1, productName: "Serum Admission E3", category: "beauty",
    trustedBrand: { source: "products.raw_meta.brand", value: "Merek Admission E3" },
    productVisualDesc: "BOTOL-ADMISSION-E3", brandBrief: "BRIEF-ADMISSION-E3", claims: ["klaim admission E3"],
  });
  const rereadCurrent = parseJobProductSnapshot(createJobProductSnapshotRaw(current));
  assert.notDeepEqual(rereadCurrent, admissionSnapshot, "counterexample re-read current tidak berbeda dari admission");
  assert.equal(rereadCurrent.productName, mutation.name); assert.equal(rereadCurrent.trustedBrand.value, mutation.brand);

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
  assert.deepEqual(storage.deleteCalls, [s.approvedSource, `${s.approvedSource}.meta.json`], "cleanup E5 menyasar object yang salah");
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
