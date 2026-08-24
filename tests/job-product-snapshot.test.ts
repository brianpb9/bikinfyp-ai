import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createJobProductSnapshotRaw,
  loadOrCreateJobProductSnapshot,
  parseJobProductSnapshot,
  UnsafeLegacyProductSnapshot,
} from "../lib/job-product-snapshot";
import { deriveStoryAdsIdentity, isStructuredStoryAds } from "../lib/script-engine/story-os-ads";

const awal = {
  productName: "Serum Awal",
  category: "beauty",
  priceIdr: 89_000,
  trustedBrand: { source: "products.raw_meta.brand" as const, value: "Merek Sah" },
  productVisualDesc: "botol amber",
  brandBrief: "tenang dan faktual",
  claims: ["tekstur ringan"],
};

test("snapshot dibuat sekali dan mutation candidate tidak mengubah retry", async () => {
  let durable: string | null = null;
  const first = await loadOrCreateJobProductSnapshot({
    existingRaw: null,
    candidate: awal,
    persistIfAbsentAndSafe: async (raw) => (durable ??= raw),
  });
  const retry = await loadOrCreateJobProductSnapshot({
    existingRaw: durable,
    candidate: () => assert.fail("resume mengevaluasi kolom produk mutasi walau snapshot durable sudah ada"),
    persistIfAbsentAndSafe: async () => assert.fail("retry menulis ulang snapshot"),
  });
  assert.deepEqual(retry, first);
});

test("dua create konkuren kembali dengan satu pemenang durable", async () => {
  let durable: string | null = null;
  let writes = 0;
  const cas = async (raw: string) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!durable) { durable = raw; writes++; }
    return durable;
  };
  const [a, b] = await Promise.all([
    loadOrCreateJobProductSnapshot({ existingRaw: null, candidate: awal, persistIfAbsentAndSafe: cas }),
    loadOrCreateJobProductSnapshot({ existingRaw: null, candidate: { ...awal, productName: "Pesaing" }, persistIfAbsentAndSafe: cas }),
  ]);
  assert.equal(writes, 1);
  assert.deepEqual(a, b);
});

test("snapshot invalid gagal tertutup", () => {
  assert.throws(() => parseJobProductSnapshot("{}"), /PRODUCT_SNAPSHOT_INVALID/);
  assert.throws(() => parseJobProductSnapshot(JSON.stringify({ ...awal, version: 2, claims: [7] })), /PRODUCT_SNAPSHOT_INVALID/);
  assert.throws(() => parseJobProductSnapshot(JSON.stringify({ ...awal, version: 2, trustedBrand: { source: "guessed", value: "X" } })), /PRODUCT_SNAPSHOT_INVALID/);
  const { priceIdr: _missing, ...legacyWithoutPrice } = awal;
  const legacyRaw = JSON.stringify({ ...legacyWithoutPrice, version: 1 });
  assert.deepEqual(parseJobProductSnapshot(legacyRaw), { ...legacyWithoutPrice, version: 1, priceIdr: null });
  assert.throws(() => parseJobProductSnapshot(legacyRaw, { requirePrice: true }), UnsafeLegacyProductSnapshot);
});

test("snapshot v1 hanya kompatibel untuk non-Story-Ads; v2 tetap membawa harga", async () => {
  const { priceIdr: _missing, ...legacyWithoutPrice } = awal;
  const legacyRaw = JSON.stringify({ ...legacyWithoutPrice, version: 1 });
  const nonAds = await loadOrCreateJobProductSnapshot({
    existingRaw: legacyRaw, candidate: () => assert.fail("resume v1 non-Ads membaca row mutable"),
    persistIfAbsentAndSafe: async () => assert.fail("resume v1 non-Ads menulis ulang snapshot durable"),
  });
  assert.equal(nonAds.version, 1); assert.equal(nonAds.priceIdr, null);
  await assert.rejects(() => loadOrCreateJobProductSnapshot({
    existingRaw: legacyRaw, requirePrice: true,
    candidate: () => assert.fail("Story Ads v1 mencoba backfill harga dari row mutable"),
    persistIfAbsentAndSafe: async () => assert.fail("Story Ads v1 menimpa snapshot durable"),
  }), UnsafeLegacyProductSnapshot);
  const v2 = parseJobProductSnapshot(JSON.stringify({ ...awal, version: 2 }), { requirePrice: true });
  assert.equal(v2.version, 2); assert.equal(v2.priceIdr, 89_000);
});

test("A6 identity: talking_head + template job null tetap Story Ads dari snapshot admisi", () => {
  const identity = deriveStoryAdsIdentity(
    { contentType: "ads", templateId: "ads-unboxing-pov" },
    { format: "talking_head", templateId: null }
  );
  assert.deepEqual(identity, {
    contentType: "ads", templateId: "ads-unboxing-pov", durationSec: null,
  });
  assert.equal(isStructuredStoryAds(identity), true);
  const { priceIdr: _missing, ...legacyWithoutPrice } = awal;
  assert.throws(() => parseJobProductSnapshot(
    JSON.stringify({ ...legacyWithoutPrice, version: 1 }),
    { requirePrice: isStructuredStoryAds(identity) }
  ), UnsafeLegacyProductSnapshot);
});

test("template snapshot admisi menang atas kolom job yang menyimpang", () => {
  assert.deepEqual(
    deriveStoryAdsIdentity(
      { contentType: "ads", templateId: "ads-meja-kosong" },
      { format: "ads", templateId: "promo-terbatas", durationSec: 15 }
    ),
    { contentType: "ads", templateId: "ads-meja-kosong", durationSec: 15 }
  );
});

test("admission builder membekukan seluruh metadata dari bentuk row database", () => {
  const raw = createJobProductSnapshotRaw({
    name: "Serum Admission", category: "beauty", price_idr: 91_000,
    raw_meta: JSON.stringify({ brand: "Merek Admission", ignored: "bukan sumber" }),
    product_visual_desc: "botol amber", brand_brief: "faktual",
    claims: JSON.stringify(["ringan", "tanpa pewangi"]),
  });
  assert.deepEqual(parseJobProductSnapshot(raw), {
    version: 2, productName: "Serum Admission", category: "beauty", priceIdr: 91_000,
    trustedBrand: { source: "products.raw_meta.brand", value: "Merek Admission" },
    productVisualDesc: "botol amber", brandBrief: "faktual",
    claims: ["ringan", "tanpa pewangi"],
  });
  assert.throws(() => createJobProductSnapshotRaw({ name: "X", category: "Y", price_idr: 1, claims: "{}" }), /SOURCE_INVALID/);
});

test("legacy dengan jejak provider tanpa snapshot ditolak", async () => {
  await assert.rejects(
    () => loadOrCreateJobProductSnapshot({ existingRaw: null, candidate: awal, persistIfAbsentAndSafe: async () => null }),
    UnsafeLegacyProductSnapshot
  );
});

test("A6 memvalidasi product snapshot sebelum approve, regen ledger, reset, dan enqueue", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/api/dashboard/campaign/job/[jobId]/route.ts"),
    "utf8"
  );
  const guard = source.indexOf("parseJobProductSnapshot(job.job_product_snapshot");
  assert.ok(guard > 0, "A6 tidak memvalidasi snapshot metadata produk");
  for (const token of [
    "UPDATE jobs SET approved_at",
    "UPDATE job_shots SET regen_requested=TRUE",
    "INSERT INTO credit_ledger",
    "await pgForgetShotTask",
    "await enqueueJobResume",
  ]) {
    assert.ok(source.indexOf(token) > guard, `${token} terjadi sebelum snapshot metadata diverifikasi`);
  }
  assert.match(source, /s\.validation_result AS script_validation_result/,
    "A6 tidak memuat snapshot admisi script");
  assert.match(source.slice(guard, guard + 650), /isStructuredStoryAds\(deriveStoryAdsIdentity\([\s\S]+bacaSnapshot\(job\.script_validation_result\)[\s\S]+format: job\.format[\s\S]+templateId: job\.template_id/,
    "A6 tidak memakai helper identitas Story Ads yang sama dengan worker");
});

test("semua admission produksi memasang snapshot pada INSERT job yang sama", () => {
  const roots = ["app", "lib"];
  const creators: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".ts")) {
        const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
        if (/INSERT INTO jobs\b/.test(source)) creators.push(rel);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(creators.sort(), [
    "app/api/jobs/route.ts",
    "lib/dashboard/render-cell.ts",
    "lib/postgres/smoke-runtime.ts",
  ]);
  for (const rel of creators) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    assert.match(source, /createJobProductSnapshotRaw/, `${rel} tidak membangun snapshot admission kanonik`);
    for (const insert of source.matchAll(/INSERT INTO jobs[\s\S]{0,700}?(?:`|\")/g)) {
      assert.match(insert[0], /job_product_snapshot/, `${rel} punya INSERT jobs tanpa snapshot atomik`);
    }
  }
  const retail = fs.readFileSync(path.join(process.cwd(), "app/api/jobs/route.ts"), "utf8");
  assert.match(retail, /smokeCreateJob\(/, "call-site admission PostgreSQL retail hilang");
  const pgAdmission = fs.readFileSync(path.join(process.cwd(), "lib/postgres/smoke-runtime.ts"), "utf8");
  assert.match(pgAdmission, /FOR SHARE[\s\S]+job_product_snapshot/, "PG admission tidak mengunci produk sebelum snapshot+INSERT");
  assert.match(pgAdmission, /SELECT[\s\S]{0,300}price_idr[\s\S]{0,300}FROM products/, "PG retail admission tidak membaca harga untuk snapshot");
  const dashboardAdmission = fs.readFileSync(path.join(process.cwd(), "lib/dashboard/render-cell.ts"), "utf8");
  assert.match(dashboardAdmission, /SELECT[\s\S]{0,300}price_idr[\s\S]{0,300}FROM products/, "PG dashboard admission tidak membaca harga untuk snapshot");
});

test("kedua worker memuat snapshot immutable sebelum SA6 dan memakai identity snapshot", () => {
  for (const rel of ["lib/worker.ts", "lib/postgres/worker.ts"]) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const load = source.indexOf("const productSnapshot = await loadOrCreateJobProductSnapshot");
    const sa6 = source.indexOf("const voiceoverStartSec = voiceoverStartSecForSegments");
    assert.ok(load > 0 && sa6 > load, `${rel}: SA6 berjalan sebelum snapshot produk immutable dimuat`);
    const sa6Block = source.slice(sa6, sa6 + 500);
    assert.match(sa6Block, /productSnapshot\.productName/);
    assert.match(sa6Block, /productSnapshot\.category/);
    assert.match(sa6Block, /productPriceIdr: snapshotPriceIdr/);
    assert.match(source.slice(load, sa6), /requirePrice: isStructuredStoryAds\(storyIdentity\)/,
      `${rel}: parser snapshot tidak membatasi kebutuhan harga ke Story Ads`);
    assert.match(source, /isStructuredStoryAds\([^)]+\)[\s\S]{0,180}!\w+\.job_product_snapshot[\s\S]{0,220}PRODUCT_SNAPSHOT_LEGACY_UNSAFE/,
      `${rel}: Story Ads legacy tanpa snapshot tidak gagal tertutup`);
  }
});

test("dashboard mengunci satu row produk sebelum validasi dan memakai row itu sampai snapshot job", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/dashboard/render-cell.ts"), "utf8");
  const begin = source.indexOf('await client.query("BEGIN")');
  const lock = source.indexOf("FROM products WHERE id=$1 AND org_id=$2 FOR SHARE");
  const validate = source.indexOf("const validation = periksaAdmisi", lock);
  const snapshot = source.indexOf("createJobProductSnapshotRaw(lockedProduct)", validate);
  const insert = source.indexOf("INSERT INTO jobs", snapshot);
  const commit = source.indexOf('await client.query("COMMIT")', insert);
  assert.ok(begin > 0 && begin < lock && lock < validate && validate < snapshot && snapshot < insert && insert < commit,
    "urutan lock→validasi→snapshot→INSERT→COMMIT tidak utuh");
  const validationBlock = source.slice(validate, snapshot);
  for (const field of ["name", "category", "price_idr", "source_url", "promo_price_before_idr"]) {
    assert.match(validationBlock, new RegExp(`lockedProduct\\.${field}`), `validasi masih mencampur ${field} dari request/query lain`);
  }
  assert.doesNotMatch(source.slice(lock, snapshot), /sel\.productPriceIdr|produkOtoritatif/,
    "jalur terkunci masih mencampur caller price atau query produk lama");
});

test("C9 route-boundary proof terikat ke PATCH dan worker entrypoint produksi", () => {
  const w2 = fs.readFileSync(path.join(process.cwd(), "tests/http-photo-mutation-resume-w2.test.ts"), "utf8");
  assert.match(w2, /PATCH: patchRetailProduct/);
  assert.doesNotMatch(w2, /E3 HTTP PATCH[^\n]+[\s\S]{0,300}\.skip\(/,
    "bukti E3 masih opsional/skip");
  assert.match(w2, /await patchRetailRequest\(s\.productId, s\.ownerToken[\s\S]+await processJob\(s\.jobId\)/,
    "bukti E3 tidak menempuh PATCH aktual sebelum entrypoint W2");
  const w1 = fs.readFileSync(path.join(process.cwd(), "tests/pg-product-truth-w1.test.ts"), "utf8");
  assert.match(w1, /app\/api\/dashboard\/campaign\/product\/route/);
  assert.match(w1, /await patchProdukOrg\(ownerToken[\s\S]+await jalankan\(jobId/,
    "bukti E7 tidak menempuh PATCH aktual sebelum entrypoint W1");
  assert.match(w1, /process\.env\.RACUN_WORKER_DISABLED = "1"/);
  assert.match(w1, /process\.env\.RACUN_QUEUE_MODE = "inline"/);
  assert.ok(w1.indexOf('process.env.RACUN_WORKER_DISABLED = "1"') < w1.indexOf('await import("../lib/dashboard/render-cell")'),
    "fixture E7 tidak mematikan auto-worker sebelum import admission");
  assert.ok(w1.indexOf('process.env.RACUN_QUEUE_MODE = "inline"') < w1.indexOf('await import("../lib/dashboard/render-cell")'),
    "fixture E7 dapat mewarisi queue Redis eksternal");
  const retailRoute = fs.readFileSync(path.join(process.cwd(), "app/api/products/[id]/route.ts"), "utf8");
  const orgRoute = fs.readFileSync(path.join(process.cwd(), "app/api/dashboard/campaign/product/route.ts"), "utf8");
  assert.match(retailRoute, /export async function PATCH/);
  assert.match(orgRoute, /export async function PATCH/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "lib/worker.ts"), "utf8"), /export async function processJob/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "lib/postgres/worker.ts"), "utf8"), /export async function processPostgresJob/);
});
