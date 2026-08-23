import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-ref-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const {
  loadOrCreateJobReferenceManifest,
  materializeJobReferenceManifest,
  parseJobReferenceManifest,
  UnsafeLegacyReferenceSnapshot,
} = await import("../lib/job-reference-manifest");

const sha = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-ref-materialize-"));
const values = new Map<string, Buffer>();

function sidecar(bytes: Buffer) {
  return Buffer.from(JSON.stringify({
    sha256: sha(bytes), jenis: "product_photo", layakReferensi: true,
    rasioAreaTeks: 0.001, jumlahKata: 1, alasan: "packshot", versiBukti: 1,
  }));
}

setMediaStorageForTests({
  async put(key, body) { values.set(key, Buffer.from(body)); },
  async delete(key) { values.delete(key); },
  async get(key) { const body = values.get(key); return body ? { body, size: body.length } : null; },
  async stat(key) { const body = values.get(key); return body ? { size: body.length } : null; },
  async materialize(key) {
    const body = values.get(key);
    if (!body) return null;
    const out = path.join(tmp, `${crypto.randomUUID()}-${path.basename(key)}`);
    fs.writeFileSync(out, body);
    return out;
  },
});

test("manifest dibuat sekali; retry/reorder/delete/add tetap memakai identitas awal", async () => {
  values.clear();
  const a = "uploads/manifest/a.webp", b = "uploads/manifest/b.webp", c = "uploads/manifest/c.webp";
  const ba = Buffer.from("PACKSHOT-A"), bb = Buffer.from("PACKSHOT-B"), bc = Buffer.from("PACKSHOT-C");
  for (const [rel, bytes] of [[a, ba], [b, bb], [c, bc]] as const) {
    values.set(rel, bytes); values.set(`${rel}.meta.json`, sidecar(bytes));
  }
  let durable: string | null = null;
  let writes = 0;
  const persist = async (candidate: string) => {
    if (!durable) { durable = candidate; writes++; }
    return durable;
  };

  const first = await loadOrCreateJobReferenceManifest({ existingRaw: null, candidateRels: [a, b], persistIfAbsentAndSafe: persist });
  const retry = await loadOrCreateJobReferenceManifest({
    existingRaw: durable,
    candidateRels: [c, b, a], // product list berubah total sesudah approval
    persistIfAbsentAndSafe: async () => assert.fail("retry tidak boleh menulis/resnapshot"),
  });

  assert.equal(writes, 1);
  assert.deepEqual(first.manifest.references.map((r) => r.rel), [a, b]);
  assert.deepEqual(retry.manifest, first.manifest);
  assert.equal(first.manifest.references[0].sha256, sha(ba));
  assert.equal(first.manifest.references[0].versiBukti, 1);
  const paths = await materializeJobReferenceManifest(retry.manifest, path.join(tmp, "job-retry"));
  assert.deepEqual(paths.map((p) => sha(fs.readFileSync(p))), [sha(ba), sha(bb)]);
});

test("dua create konkuren kembali dengan satu pemenang durable", async () => {
  values.clear();
  const a = "uploads/concurrent/a.webp", b = "uploads/concurrent/b.webp";
  const ba = Buffer.from("A"), bb = Buffer.from("B");
  for (const [rel, bytes] of [[a, ba], [b, bb]] as const) {
    values.set(rel, bytes); values.set(`${rel}.meta.json`, sidecar(bytes));
  }
  let durable: string | null = null;
  let writes = 0;
  const cas = async (candidate: string) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!durable) { durable = candidate; writes++; }
    return durable;
  };
  const [x, y] = await Promise.all([
    loadOrCreateJobReferenceManifest({ existingRaw: null, candidateRels: [a], persistIfAbsentAndSafe: cas }),
    loadOrCreateJobReferenceManifest({ existingRaw: null, candidateRels: [b], persistIfAbsentAndSafe: cas }),
  ]);
  assert.equal(writes, 1);
  assert.deepEqual(x.manifest, y.manifest);
  assert.deepEqual(parseJobReferenceManifest(durable!).references, x.manifest.references);
});

test("manifest missing/hash-changed dan legacy tak terbukti gagal tertutup", async () => {
  values.clear();
  const rel = "uploads/fail-closed/a.webp";
  const approved = Buffer.from("APPROVED");
  const manifest = { version: 1 as const, references: [{ rel, sha256: sha(approved), versiBukti: 1 }] };
  await assert.rejects(() => materializeJobReferenceManifest(manifest, path.join(tmp, "missing")), /REF_MISSING/);
  const changed = Buffer.from("CHANGED");
  values.set(rel, changed);
  await assert.rejects(() => materializeJobReferenceManifest(manifest, path.join(tmp, "changed")), /REF_HASH_MISMATCH/);
  values.set(`${rel}.meta.json`, sidecar(changed));
  await assert.rejects(
    () => loadOrCreateJobReferenceManifest({
      existingRaw: null,
      candidateRels: [rel],
      persistIfAbsentAndSafe: async () => null,
    }),
    UnsafeLegacyReferenceSnapshot
  );
});

test("A6 menempatkan verifikasi manifest sebelum approve, regen charge, task reset, dan enqueue", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/api/dashboard/campaign/job/[jobId]/route.ts"),
    "utf8"
  );
  const guard = source.indexOf("materializeJobReferenceManifest(manifest");
  assert.ok(guard > 0, "A6 tidak memanggil guard manifest");
  for (const [name, token] of [
    ["approve mutation", "UPDATE jobs SET approved_at"],
    ["regen claim", "UPDATE job_shots SET regen_requested=TRUE"],
    ["regen ledger", "INSERT INTO credit_ledger"],
    ["task reset", "await pgForgetShotTask"],
    ["enqueue", "await enqueueJobResume"],
  ] as const) {
    assert.ok(source.indexOf(token) > guard, `${name} terjadi sebelum manifest diverifikasi`);
  }
});

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});
