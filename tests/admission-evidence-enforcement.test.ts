import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

process.env.RACUN_NO_DOTENV = "1";

const { setMediaStorageForTests } = await import("../lib/storage");
const { assertAdmissionReferenceEvidence } = await import("../lib/job-admission-reference");
const { GagalTanpaReferensi } = await import("../lib/kanari-bukti");
const { ALASAN_TOLAK } = await import("../lib/product-truth");

const values = new Map<string, Buffer>();
const writes = { put: 0, delete: 0, materialize: 0 };
const storage = {
  async put(key: string, body: Buffer) { writes.put++; values.set(key, Buffer.from(body)); },
  async delete(key: string) { writes.delete++; values.delete(key); },
  async get(key: string) {
    const body = values.get(key);
    return body ? { body, size: body.length } : null;
  },
  async stat(key: string) {
    const body = values.get(key);
    return body ? { size: body.length } : null;
  },
  async materialize() { writes.materialize++; return null; },
} satisfies import("../lib/storage").MediaStorage;
setMediaStorageForTests(storage);
after(() => setMediaStorageForTests(undefined));

const sha = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const validSidecar = (bytes: Buffer) => Buffer.from(JSON.stringify({
  sha256: sha(bytes), jenis: "product_photo", layakReferensi: true,
  rasioAreaTeks: 0, jumlahKata: 0, alasan: "packshot", versiBukti: 1,
}));

test("preflight A2/A3/A5/A7 menolak C8 tanpa satu pun write/materialize", async () => {
  values.clear();
  writes.put = writes.delete = writes.materialize = 0;
  const rel = "uploads/admission-c8/corrupt.webp";
  values.set(rel, Buffer.from("BYTES-ADA"));
  values.set(`${rel}.meta.json`, Buffer.from("{korup"));

  for (const boundary of ["A2", "A3", "A5", "A7"] as const) {
    let caught: unknown;
    try {
      await assertAdmissionReferenceEvidence({
        productId: `product-${boundary}`,
        candidateRels: [rel],
        boundary,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof GagalTanpaReferensi, `${boundary} tidak fail-closed`);
    assert.equal(caught.rincian[0]?.alasan, ALASAN_TOLAK.BUKTI_TIDAK_SAH);
  }

  assert.deepEqual(writes, { put: 0, delete: 0, materialize: 0 });
});

test("preflight positif tetap menerima packshot dengan sidecar+hash sah", async () => {
  values.clear();
  writes.put = writes.delete = writes.materialize = 0;
  const rel = "uploads/admission-positive/packshot.webp";
  const bytes = Buffer.from("PACKSHOT-SAH");
  values.set(rel, bytes);
  values.set(`${rel}.meta.json`, validSidecar(bytes));

  await assertAdmissionReferenceEvidence({ productId: "product-positive", candidateRels: [rel], boundary: "A3" });
  assert.deepEqual(writes, { put: 0, delete: 0, materialize: 0 });
});

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const before = (body: string, guard: string, effects: string[]) => {
  const guardIndex = body.indexOf(guard);
  assert.ok(guardIndex > 0, `gerbang tidak ditemukan: ${guard}`);
  for (const effect of effects) {
    const index = body.indexOf(effect);
    assert.ok(index > guardIndex, `${effect} mendahului ${guard}`);
  }
};

test("A2/A3/A5/A7 memasang preflight sebelum provider atau state admission", () => {
  before(source("../app/api/dashboard/matrix/route.ts"),
    "await assertAdmissionReferenceEvidence({ productId: product.id", [
      "const jalanSkenario = (namaProduk: string) => generateScripts(",
      "const personaPerAvatar = new Map",
      "const barisSkrip = await smokeCreateScripts(",
      "const sel = await renderSatuSel(",
    ]);
  before(source("../app/api/dashboard/campaign/generate/route.ts"),
    "await assertAdmissionReferenceEvidence({ productId: product.id", [
      "const run = (name: string) => generateScripts(",
      "const created = await smokeCreateScripts(",
    ]);
  before(source("../app/api/dashboard/campaign/confirm/route.ts"),
    "await assertAdmissionReferenceEvidence({", [
      "const personaId = (await pgFindOrCreatePersona(",
      "results.push(await renderSatuSel(",
    ]);
  before(source("../app/api/scripts/generate/route.ts"),
    "await assertAdmissionReferenceEvidence({", [
      "const jalan = (namaProduk: string) => generateScripts(",
      "const created = await smokeCreateScripts(",
      "INSERT INTO scripts",
    ]);
});

test("A1/A4/A6 tetap menegakkan bukti di boundary otoritatif sebelum uang/queue", () => {
  before(source("../app/api/jobs/route.ts"),
    "preparedReference = await prepareAdmissionReferenceManifest({", [
      "if (!holdCredits(user.id, preparedJobId, priceIdr))",
      "await enqueueJob(jobId)",
    ]);
  before(source("../lib/dashboard/render-cell.ts"),
    "const preparedReference = await prepareAdmissionReferenceManifest({", [
      "const held = await creditsRepo.holdCredits(",
      "await enqueueJob(jobId)",
    ]);
  before(source("../app/api/dashboard/campaign/job/[jobId]/route.ts"),
    "await materializeJobReferenceManifest(manifest", [
      "UPDATE jobs SET approved_at=",
      "INSERT INTO credit_ledger",
      "await enqueueJobResume(jobId, `regen${idx}`)",
    ]);
});
