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

const awal = {
  productName: "Serum Awal",
  category: "beauty",
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
  assert.throws(() => parseJobProductSnapshot(JSON.stringify({ ...awal, version: 1, claims: [7] })), /PRODUCT_SNAPSHOT_INVALID/);
  assert.throws(() => parseJobProductSnapshot(JSON.stringify({ ...awal, version: 1, trustedBrand: { source: "guessed", value: "X" } })), /PRODUCT_SNAPSHOT_INVALID/);
});

test("admission builder membekukan seluruh metadata dari bentuk row database", () => {
  const raw = createJobProductSnapshotRaw({
    name: "Serum Admission", category: "beauty",
    raw_meta: JSON.stringify({ brand: "Merek Admission", ignored: "bukan sumber" }),
    product_visual_desc: "botol amber", brand_brief: "faktual",
    claims: JSON.stringify(["ringan", "tanpa pewangi"]),
  });
  assert.deepEqual(parseJobProductSnapshot(raw), {
    version: 1, productName: "Serum Admission", category: "beauty",
    trustedBrand: { source: "products.raw_meta.brand", value: "Merek Admission" },
    productVisualDesc: "botol amber", brandBrief: "faktual",
    claims: ["ringan", "tanpa pewangi"],
  });
  assert.throws(() => createJobProductSnapshotRaw({ name: "X", category: "Y", claims: "{}" }), /SOURCE_INVALID/);
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
  const guard = source.indexOf("parseJobProductSnapshot(job.job_product_snapshot)");
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
});
