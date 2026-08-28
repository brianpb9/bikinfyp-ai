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
  materializeJobReferenceManifest,
  parseJobReferenceManifest,
  prepareJobReferenceManifest,
} = await import("../lib/job-reference-manifest");
const { cleanupUnadmittedReferenceKeys, prepareAdmissionReferenceManifest } = await import("../lib/job-admission-reference");
const { GagalTanpaReferensi, KODE_KANARI } = await import("../lib/kanari-bukti");
const { errorResponse } = await import("../lib/errors");

const sha = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-ref-materialize-"));
const values = new Map<string, Buffer>();
const materializeFailures = new Set<string>();
const materializePathOverrides = new Map<string, string>();

function sidecar(bytes: Buffer) {
  return Buffer.from(JSON.stringify({
    sha256: sha(bytes), jenis: "product_photo", layakReferensi: true,
    rasioAreaTeks: 0.001, jumlahKata: 1, alasan: "packshot", versiBukti: 1,
    labelOcrStatus: "READABLE", labelOcrVersion: 1,
  }));
}

const memoryStorage = {
  async put(key, body) { values.set(key, Buffer.from(body)); },
  async delete(key) { values.delete(key); },
  async get(key) { const body = values.get(key); return body ? { body, size: body.length } : null; },
  async stat(key) { const body = values.get(key); return body ? { size: body.length } : null; },
  async materialize(key) {
    if (materializeFailures.has(key)) throw new Error("R2 authentication unavailable");
    const overridden = materializePathOverrides.get(key);
    if (overridden) return overridden;
    const body = values.get(key);
    if (!body) return null;
    const out = path.join(tmp, `${crypto.randomUUID()}-${path.basename(key)}`);
    fs.writeFileSync(out, body);
    return out;
  },
} satisfies import("../lib/storage").MediaStorage;
setMediaStorageForTests(memoryStorage);

test("preparation admission idempoten pada key deterministik dan raw identik", async () => {
  values.clear();
  const rel = "uploads/admission-idempotent/a.webp";
  const bytes = Buffer.from("ADMISSION-IDEMPOTENT");
  values.set(rel, bytes); values.set(`${rel}.meta.json`, sidecar(bytes));

  const first = await prepareJobReferenceManifest({ jobId: "job-admission-same", candidateRels: [rel] });
  const retry = await prepareJobReferenceManifest({ jobId: "job-admission-same", candidateRels: [rel] });

  assert.equal(retry.raw, first.raw);
  assert.deepEqual(retry.manifest, first.manifest);
  assert.deepEqual(values.get(first.manifest.references[0].snapshotRel), bytes);
});

test("partial storage PUT gagal sebelum callback persistence/DB", async () => {
  values.clear();
  const a = "uploads/admission-put-fail/a.webp", b = "uploads/admission-put-fail/b.webp";
  const ba = Buffer.from("PUT-A"), bb = Buffer.from("PUT-B");
  for (const [rel, bytes] of [[a, ba], [b, bb]] as const) {
    values.set(rel, bytes); values.set(`${rel}.meta.json`, sidecar(bytes));
  }
  let puts = 0; let persistenceCalls = 0;
  const attempted = new Set<string>();
  setMediaStorageForTests({
    ...memoryStorage,
    async put(key, body) {
      puts++;
      if (puts === 2) throw new Error("storage put injected failure");
      values.set(key, Buffer.from(body));
    },
  });
  try {
    await assert.rejects(async () => {
      try {
        await prepareJobReferenceManifest({
          jobId: "job-admission-put-fail",
          candidateRels: [a, b],
          onSnapshotTarget: (key) => attempted.add(key),
        });
        persistenceCalls++;
      } catch (error) {
        await cleanupUnadmittedReferenceKeys({
          jobId: "job-admission-put-fail",
          snapshotRels: attempted,
          runtime: "admission-sqlite",
          proveJobAbsent: async () => true,
        });
        throw error;
      }
    }, /storage put injected failure/);
    assert.equal(persistenceCalls, 0, "DB/persistence callback dipanggil sesudah partial PUT gagal");
    assert.deepEqual([...values.keys()].filter((key) => key.includes("job-admission-put-fail/approved-references")), [],
      "partial PUT meninggalkan snapshot key sesudah non-admission terbukti");
  } finally {
    setMediaStorageForTests(memoryStorage);
  }
});

test("source berubah antara resolver dan copy admission gagal REF_HASH_MISMATCH", async () => {
  values.clear();
  const rel = "uploads/admission-toctou/a.webp";
  const approved = Buffer.from("APPROVED-AT-RESOLVE");
  values.set(rel, approved); values.set(`${rel}.meta.json`, sidecar(approved));
  let sourceReads = 0;
  setMediaStorageForTests({
    ...memoryStorage,
    async get(key) {
      if (key === rel && ++sourceReads === 2) {
        const changed = Buffer.from("CHANGED-BEFORE-COPY");
        return { body: changed, size: changed.length };
      }
      return memoryStorage.get(key);
    },
  });
  try {
    await assert.rejects(
      () => prepareJobReferenceManifest({ jobId: "job-admission-toctou", candidateRels: [rel] }),
      /REF_HASH_MISMATCH/
    );
  } finally {
    setMediaStorageForTests(memoryStorage);
  }
});

test("admission kosong/seluruhnya ditolak mempertahankan NO_APPROVED_REFERENCE", async () => {
  values.clear();
  let caught: unknown;
  try {
    await prepareAdmissionReferenceManifest({
      jobId: "job-admission-empty",
      productId: "product-admission-empty",
      candidateRels: [],
      runtime: "admission-sqlite",
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof GagalTanpaReferensi);
  assert.equal(caught.kode, KODE_KANARI.TANPA_REFERENSI);
  const response = errorResponse(caught);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, KODE_KANARI.TANPA_REFERENSI);
});

test("cleanup admission butuh bukti absent; kegagalan delete tercatat tanpa mengubah outcome", async () => {
  values.clear();
  const jobId = "job-cleanup-observable";
  const key = `jobs/${jobId}/approved-references/0-${"a".repeat(64)}.webp`;
  values.set(key, Buffer.from("ORPHAN"));
  let deletes = 0;
  setMediaStorageForTests({
    ...memoryStorage,
    async delete(candidate) {
      deletes++;
      throw new Error(`injected cleanup failure ${candidate}`);
    },
  });
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const ambiguous = await cleanupUnadmittedReferenceKeys({
      jobId, snapshotRels: [key], runtime: "admission-sqlite",
      proveJobAbsent: async () => false,
    });
    assert.deepEqual(ambiguous, { provenAbsent: false, attempted: 0, deleted: 0, failed: [] });
    assert.equal(deletes, 0, "cleanup menyentuh storage tanpa bukti job absent");

    const knownAbsent = await cleanupUnadmittedReferenceKeys({
      jobId, snapshotRels: [key], runtime: "admission-sqlite",
      proveJobAbsent: async () => true,
    });
    assert.deepEqual(knownAbsent, { provenAbsent: true, attempted: 1, deleted: 0, failed: [key] });
    assert.equal(values.has(key), true, "fixture cleanup failure tidak mempertahankan orphan");
    assert.ok(errors.some((args) => String(args[0]).includes("delete failed; orphan retained")),
      "cleanup failure tidak diekspos ke log operasional");
  } finally {
    console.error = originalError;
    setMediaStorageForTests(memoryStorage);
  }
});

test("manifest missing/hash-changed gagal tertutup", async () => {
  values.clear();
  const rel = "uploads/fail-closed/a.webp";
  const approved = Buffer.from("APPROVED");
  const snapshotRel = "jobs/job-fail/approved-references/0-approved.webp";
  const manifest = { version: 2 as const, references: [{ rel, sha256: sha(approved), versiBukti: 1, labelOcrStatus: "READABLE" as const, labelOcrVersion: 1 as const, snapshotRel }] };
  await assert.rejects(() => materializeJobReferenceManifest(manifest, path.join(tmp, "missing")), /REF_MISSING/);
  const changed = Buffer.from("CHANGED");
  values.set(snapshotRel, changed);
  await assert.rejects(() => materializeJobReferenceManifest(manifest, path.join(tmp, "changed")), /REF_HASH_MISMATCH/);
  materializeFailures.add(snapshotRel);
  await assert.rejects(
    () => materializeJobReferenceManifest(manifest, path.join(tmp, "infra")),
    /R2 authentication unavailable/
  );
  materializeFailures.delete(snapshotRel);
});

test("readFile I/O sesudah materialize berhasil dipropagasikan, bukan REF_HASH_MISMATCH", async () => {
  values.clear();
  const rel = "uploads/read-io/a.webp";
  const bytes = Buffer.from("READ-IO");
  const snapshotRel = "jobs/job-read-io/approved-references/0-read-io.webp";
  values.set(snapshotRel, bytes);
  const manifest = { version: 2 as const, references: [{ rel, sha256: sha(bytes), versiBukti: 1, labelOcrStatus: "READABLE" as const, labelOcrVersion: 1 as const, snapshotRel }] };

  // materialize sukses mengembalikan path, tetapi path itu tidak bisa dibaca
  // sebagai file. Node menghasilkan EISDIR dari readFile: error I/O non-ENOENT.
  materializePathOverrides.set(snapshotRel, tmp);
  try {
    await assert.rejects(
      () => materializeJobReferenceManifest(manifest, path.join(tmp, "read-io")),
      (error) => (error as NodeJS.ErrnoException).code === "EISDIR"
        && !(error as Error).message.includes("REF_HASH_MISMATCH")
    );
  } finally {
    materializePathOverrides.delete(snapshotRel);
  }
});

test("A6 menempatkan verifikasi manifest sebelum approve, regen charge, task reset, dan enqueue", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/api/dashboard/campaign/job/[jobId]/route.ts"),
    "utf8"
  );
  const guard = source.indexOf("materializeJobReferenceManifest(currentEvidence.manifest");
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
