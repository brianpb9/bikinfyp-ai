import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.SCRIPT_LLM = "0";
process.env.DB_PATH = `/tmp/racun-neutral-w2-packshot-${process.pid}.db`;
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "neutral-w2-packshot-store-"));

const { getDb, now, uuid } = await import("../lib/db");
const { generateScripts } = await import("../lib/script-engine");
const { CAMPAIGN_TEMPLATES } = await import("../lib/templates");
const { setMediaStorageForTests } = await import("../lib/storage");
const { setVideoProvidersForTests } = await import("../lib/providers/registry");
const { processJob, setSqliteQcRunnerForTests } = await import("../lib/worker");
const { createJobProductSnapshotRaw } = await import("../lib/job-product-snapshot");
const { neutralStoryAdsIdentityChecks } = await import("../lib/media/qc");
const { PACKSHOT_EKOR_DTK } = await import("../lib/media/packshot-asli");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
type MediaStorage = import("../lib/storage").MediaStorage;
type QcInput = import("../lib/media/qc").QcInput;

const db = getDb();
const sha = (body: Buffer) => crypto.createHash("sha256").update(body).digest("hex");

function makePng(): Buffer {
  const file = path.join(process.env.STORAGE_DIR!, "source.png");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=720x720", "-frames:v", "1", file]);
  return fs.readFileSync(file);
}

function sidecar(body: Buffer): Buffer {
  return Buffer.from(JSON.stringify({
    sha256: sha(body), jenis: "product_photo", layakReferensi: true,
    rasioAreaTeks: 0, jumlahKata: 0, alasan: "foto produk", versiBukti: 1,
    labelOcrStatus: "READABLE", labelOcrVersion: 1,
  }));
}

function memoryStorage(values: Map<string, Buffer>) {
  const puts: string[] = [];
  const storage: MediaStorage = {
    async put(key, body) { values.set(key, body); puts.push(key); },
    async delete(key) { values.delete(key); },
    async get(key) { const body = values.get(key); return body ? { body, size: body.length } : null; },
    async stat(key) { const body = values.get(key); return body ? { size: body.length } : null; },
    async materialize(key) {
      const body = values.get(key);
      if (!body) return null;
      const out = path.join(process.env.STORAGE_DIR!, "materialized", crypto.createHash("sha1").update(key).digest("hex") + path.extname(key));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body);
      return out;
    },
  };
  return { storage, puts };
}

async function setupJob(sourceRel: string, storage: MediaStorage): Promise<string> {
  const userId = uuid();
  db.prepare("INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(userId, `0812${String(Math.random()).slice(2, 10)}`, `${userId}@test.local`, "W2", "free", "id-ID", now());
  const productId = uuid();
  const product = {
    name: "Serum Uji", category: "beauty", price_idr: 189000,
    raw_meta: JSON.stringify({ brand: "Serum" }), product_visual_desc: "botol biru",
    brand_brief: null, claims: "[]",
  };
  db.prepare(`INSERT INTO products
    (id,user_id,name,price_idr,category,images,raw_meta,product_visual_desc,brand_brief,claims,
     product_type_token,product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,
     product_type_version,product_type_state,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      productId, userId, product.name, product.price_idr, product.category, JSON.stringify([sourceRel]),
      product.raw_meta, product.product_visual_desc, product.brand_brief, product.claims,
      "serum wajah", "serum wajah", userId, "2026-08-27T00:00:00.000Z", 1, "CONFIRMED", now(),
    );
  db.prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(productId);
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-meja-kosong")!;
  const [script] = await generateScripts({
    product: { id: productId, name: product.name, category: product.category, price_idr: product.price_idr },
    register: "netral", qualityTier: "silent_caption", durationSec: template.durationSec,
    contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
  });
  const scriptId = uuid();
  db.prepare(`INSERT INTO scripts
    (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,hook_level,approved_by_user_at,created_at)
    VALUES (@id,@product,@hook,'netral',@register,@segments,@caption,@hashtags,@validation,'silent_caption','normal',@approved,@created)`).run({
      id: scriptId, product: productId, hook: script.hook_family, register: script.register,
      segments: JSON.stringify(script.segments), caption: String(script.caption ?? ""),
      hashtags: typeof script.hashtags === "string" ? script.hashtags : JSON.stringify(script.hashtags ?? []),
      validation: JSON.stringify({ admisi: {
        contentType: "ads", templateId: template.id, format: "ads", durationSec: template.durationSec,
      } }), approved: now(), created: now(),
    });
  const jobId = uuid();
  const source = await storage.get(sourceRel);
  assert.ok(source, "fixture admission source must exist");
  const sourceSha = sha(source.body);
  const snapshotRel = `jobs/${jobId}/approved-references/0-${sourceSha}${path.extname(sourceRel)}`;
  await storage.put(snapshotRel, source.body);
  const manifestRaw = JSON.stringify({
    version: 2,
    references: [{
      rel: sourceRel,
      sha256: sourceSha,
      versiBukti: 1,
      labelOcrStatus: "READABLE",
      labelOcrVersion: 1,
      snapshotRel,
    }],
  });
  db.prepare(`INSERT INTO jobs
    (id,user_id,product_id,script_id,format,quality_tier,duration_s,job_product_snapshot,approved_reference_manifest,state,created_at,state_changed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      jobId, userId, productId, scriptId, "ads", "silent_caption", template.durationSec,
      createJobProductSnapshotRaw(product), manifestRaw, "QUEUED", now(), now(),
    );
  db.prepare("UPDATE scripts SET job_id=? WHERE id=?").run(jobId, scriptId);
  return jobId;
}

function installProvider(deleteReferenceAfterGenerate: boolean) {
  setVideoProvidersForTests([{
    name: "mock-r25-w2",
    async healthCheck() { return true; },
    estimateCost() { return 0; },
    async generate(spec, outDir) {
      const assets = spec.shots.map((shot, index) => {
        const filePath = path.join(outDir, `r25-shot-${index}.mp4`);
        execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
          `color=c=gray:s=360x640:r=24:d=${shot.durationSec}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", filePath]);
        return { filePath, durationSec: shot.durationSec, costIdr: 0 };
      });
      if (deleteReferenceAfterGenerate) {
        const ref = spec.shots.find((shot) => shot.imageRefPath)?.imageRefPath;
        if (ref) fs.rmSync(ref, { force: true });
        else {
          // Neutral shots deliberately carry no refs; remove the immutable
          // local snapshot discovered beside the provider output.
          fs.rmSync(path.join(outDir, "ref-tersetujui"), { recursive: true, force: true });
        }
      }
      return assets;
    },
  }]);
}

test("processJob W2 mengirim file packshot final + tail + sidik matching ke QC dan dapat READY", async (t) => {
  const source = makePng();
  const sourceRel = "uploads/r25-w2/product.png";
  const mem = memoryStorage(new Map([[sourceRel, source], [`${sourceRel}.meta.json`, sidecar(source)]]));
  setMediaStorageForTests(mem.storage);
  setPeriksaLabelFotoForTests(async () => ({
    status: "READABLE", evidenceVersion: 1, terbaca: true,
    kata: ["Serum"], cocokNama: true, cocokMerek: true,
  }));
  installProvider(false);
  t.after(() => { setMediaStorageForTests(); setVideoProvidersForTests(); setSqliteQcRunnerForTests(); setPeriksaLabelFotoForTests(); });
  const jobId = await setupJob(sourceRel, mem.storage);
  let observed = 0;
  setSqliteQcRunnerForTests(async (input: QcInput) => {
    observed++;
    assert.match(input.filePath, /output-packshot\.mp4$/);
    assert.equal(input.ekorDisengajaSec, PACKSHOT_EKOR_DTK);
    assert.equal(input.packshotSidik, sha(source));
    assert.ok(input.refImagePath && fs.existsSync(input.refImagePath));
    assert.match(input.refImagePath!, /\/ref-tersetujui\/[0-9a-f]{64}\.png$/);
    assert.equal(sha(fs.readFileSync(input.refImagePath!)), input.packshotSidik);
    return { passed: true, checks: [], checked_at: new Date().toISOString() };
  });
  await processJob(jobId);
  assert.equal(observed, 1);
  assert.equal((db.prepare("SELECT state FROM jobs WHERE id=?").get(jobId) as { state: string }).state, "READY");
});

test("processJob W2 append gagal: QC-10 fail tertutup dan job tidak READY", async (t) => {
  const source = makePng();
  const sourceRel = "uploads/r25-w2/fail.png";
  const mem = memoryStorage(new Map([[sourceRel, source], [`${sourceRel}.meta.json`, sidecar(source)]]));
  setMediaStorageForTests(mem.storage);
  setPeriksaLabelFotoForTests(async () => ({
    status: "READABLE", evidenceVersion: 1, terbaca: true,
    kata: ["Serum"], cocokNama: true, cocokMerek: true,
  }));
  installProvider(true);
  t.after(() => { setMediaStorageForTests(); setVideoProvidersForTests(); setSqliteQcRunnerForTests(); setPeriksaLabelFotoForTests(); });
  const jobId = await setupJob(sourceRel, mem.storage);
  let observed = 0;
  setSqliteQcRunnerForTests(async (input: QcInput) => {
    observed++;
    assert.equal(input.packshotSidik, undefined);
    assert.equal(input.ekorDisengajaSec, 0);
    assert.doesNotMatch(input.filePath, /output-packshot\.mp4$/);
    const check = neutralStoryAdsIdentityChecks(input)[0];
    return { passed: false, checks: [check], checked_at: new Date().toISOString() };
  });
  await processJob(jobId);
  assert.equal(observed, 2, "QC retry wajib tetap fail, bukan melewati append yang hilang");
  const state = (db.prepare("SELECT state FROM jobs WHERE id=?").get(jobId) as { state: string }).state;
  assert.ok(["FAILED", "REFUNDED"].includes(state), `append gagal berakhir ${state}`);
});
