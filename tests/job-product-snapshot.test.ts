import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
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
