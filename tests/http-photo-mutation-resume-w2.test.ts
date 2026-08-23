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
const { createJobProductSnapshotRaw } = await import("../lib/job-product-snapshot");
const { DELETE: deleteRetailPhoto } = await import("../app/api/products/[id]/photos/route");
const { processJob } = await import("../lib/worker");
type MediaStorage = import("../lib/storage").MediaStorage;

const db = getDb();
const sha = (body: Buffer) => crypto.createHash("sha256").update(body).digest("hex");
const tempMaterialize = fs.mkdtempSync(path.join(os.tmpdir(), "http-mutation-w2-materialize-"));

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

function noPaidSideEffects(jobId: string, storage: MemoryStorage) {
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...(args as [])) as { n: number }).n;
  assert.equal(count("SELECT COUNT(*) n FROM outputs WHERE job_id=?", jobId), 0);
  assert.equal(count("SELECT COUNT(*) n FROM credit_ledger WHERE job_id=? AND type IN ('capture','regen')", jobId), 0);
  const job = db.prepare("SELECT state,provider_video,provider_voice,output_url,cost_actual_idr FROM jobs WHERE id=?").get(jobId) as Record<string, unknown>;
  assert.ok(["FAILED", "REFUNDED"].includes(String(job.state)), `job berhenti di state aktif ${String(job.state)}`);
  assert.equal(job.provider_video, null); assert.equal(job.provider_voice, null);
  assert.equal(job.output_url, null); assert.equal(job.cost_actual_idr, 0);
  assert.deepEqual(storage.putCalls, [], `worker meninggalkan object storage: ${JSON.stringify(storage.putCalls)}`);
}

test("E5 HTTP DELETE non-approved + resume W2 tetap memakai snapshot job berurutan", async (t) => {
  const s = await scenario("stable");
  const storage = new MemoryStorage();
  storage.values.set(s.approvedSource, s.approvedBytes);
  storage.values.set(`${s.approvedSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.approvedSecondSource, s.approvedSecondBytes);
  storage.values.set(`${s.approvedSecondSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.otherSource, Buffer.from("OTHER"));
  storage.values.set(`${s.otherSource}.meta.json`, Buffer.from("meta"));
  storage.values.set(s.snapshotRel, s.approvedBytes);
  storage.values.set(s.snapshotRelSecond, s.approvedSecondBytes);
  setMediaStorageForTests(storage); t.after(() => setMediaStorageForTests(undefined));

  const forbidden = await deleteRequest(s.productId, s.approvedSource, s.intruderToken);
  assert.equal(forbidden.status, 404, "user lain dapat menghapus foto retail owner");
  assert.deepEqual(currentImages(s.productId), [s.approvedSource, s.approvedSecondSource, s.otherSource]);

  const response = await deleteRequest(s.productId, s.otherSource, s.ownerToken);
  const body = await response.json() as { images: string[] };
  assert.equal(response.status, 200);
  assert.deepEqual(body.images, [s.approvedSource, s.approvedSecondSource]);
  assert.deepEqual(currentImages(s.productId), body.images, "response E5 bukan daftar pasca-mutasi otoritatif");
  assert.equal(storage.values.has(s.otherSource), false);
  assert.equal(storage.values.has(s.snapshotRel), true, "cleanup E5 menghapus object privat job");

  let providerCalls = 0; let providerHash = "";
  setVideoProvidersForTests([{ name: "e5-observer", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate(spec: { shots: { imageRefPath: string }[] }) {
      providerCalls++;
      providerHash = sha(fs.readFileSync(spec.shots[0].imageRefPath));
      throw new Error("observer stop");
    } } as never]);
  await processJob(s.jobId);
  assert.equal(providerCalls, 1, "resume W2 tidak mencapai provider observer");
  assert.equal(providerHash, sha(s.approvedBytes), "resume memilih current list, bukan snapshot job lama");
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
