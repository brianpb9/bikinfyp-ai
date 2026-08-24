import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

process.env.RACUN_NO_DOTENV = "1";

const { setMediaStorageForTests } = await import("../lib/storage");
const {
  acquireAdmissionReferenceEvidence,
  assertAdmissionReferenceEvidence,
  withProductEvidenceMutationLock,
} = await import("../lib/job-admission-reference");
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

test("lease menahan DELETE deterministik sampai provider/setup selesai", async () => {
  values.clear();
  const rel = "uploads/admission-race/packshot.webp";
  const bytes = Buffer.from("PACKSHOT-RACE-SAH");
  values.set(rel, bytes);
  values.set(`${rel}.meta.json`, validSidecar(bytes));
  const order: string[] = [];
  const lease = await acquireAdmissionReferenceEvidence({
    productId: "product-race",
    owner: { kind: "user", id: "user-race" },
    boundary: "A7",
    loadSqliteCandidateRels: () => [rel],
  });
  order.push("provider-start");
  const deletion = withProductEvidenceMutationLock("product-race", async () => {
    order.push("delete");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["provider-start"], "DELETE menyelip saat lease provider masih hidup");
  order.push("provider-finish");
  await lease.release();
  await deletion;
  assert.deepEqual(order, ["provider-start", "provider-finish", "delete"]);
});

test("E5/E9 DELETE memakai kunci mutasi evidence yang sama", () => {
  for (const relative of [
    "../app/api/products/[id]/photos/route.ts",
    "../app/api/dashboard/campaign/product/[id]/photos/route.ts",
  ]) {
    const body = readFileSync(new URL(relative, import.meta.url), "utf8");
    const deletion = body.indexOf("export async function DELETE(");
    const lock = body.indexOf("await withProductEvidenceMutationLock(id", deletion);
    const mutation = Math.max(
      body.indexOf("removeRetailProductImage(", deletion),
      body.indexOf("pgRemoveOrgProductImage(", deletion),
    );
    assert.ok(deletion >= 0 && lock > deletion, `${relative} tidak mengunci DELETE`);
    assert.ok(mutation > lock, `${relative} memutasi produk sebelum memperoleh kunci`);
  }
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

test("matrix menyelesaikan duplicate replay sebelum lease current-product", () => {
  const body = source("../app/api/dashboard/matrix/route.ts");
  const duplicate = body.indexOf("if (sudahAda.length)");
  const lease = body.indexOf("evidenceLease = await acquireAdmissionReferenceEvidence(");
  assert.ok(duplicate > 0 && lease > duplicate, "current evidence mendahului duplicate replay");
});

test("POST A2/A3/A5/A7: C8 HTTP 422 dan nol provider/DB/queue/storage; kontrol sah menembus guard", async () => {
  const { setAdmissionRouteDependenciesForTests } = await import("../lib/admission-route-dependencies");
  const { setEnqueueObserverForTests } = await import("../lib/job-queue");
  const { config } = await import("../lib/config");
  const { AVATAR_PRESETS } = await import("../lib/avatar-presets");
  const { CAMPAIGN_TEMPLATES } = await import("../lib/templates");
  const { tierPriceIdr } = await import("../lib/credits");
  const { aiRenderBlockMessage } = await import("../lib/template-render-safety");
  const [{ POST: postA2 }, { POST: postA3 }, { POST: postA5 }, { POST: postA7 }] = await Promise.all([
    import("../app/api/dashboard/matrix/route"),
    import("../app/api/dashboard/campaign/generate/route"),
    import("../app/api/dashboard/campaign/confirm/route"),
    import("../app/api/scripts/generate/route"),
  ]);
  config.enterpriseMatrixEnabled = true;
  const avatar = AVATAR_PRESETS[0];
  const scenario = CAMPAIGN_TEMPLATES.find((item) => !aiRenderBlockMessage(item.id))!;
  const effects = { provider: 0, db: 0, queue: 0, storage: 0 };
  let duplicateRows: { id: string }[] = [];
  const fakeClient = {
    async query(sql: string) {
      if (sql.includes("SELECT id FROM jobs")) return { rows: duplicateRows, rowCount: duplicateRows.length };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const fakeResources = {
    pool: { async connect() { return fakeClient; } },
    jobsRepo: { async close() {} },
    creditsRepo: { async close() {} },
  };
  const user = { id: "user-handler", phone: "0800", email: null, tier: "free", locale: "id-ID", created_at: "now" };
  const membership = { org_id: "org-handler", role: "owner" };
  const baseProduct = {
    id: "product-handler", user_id: user.id, org_id: membership.org_id,
    name: "Serum Handler", price_idr: 50_000, category: "beauty", images: "[]",
    source_url: null, raw_meta: "{}", product_visual_desc: null, brand_brief: null,
    claims: null, promo_price_before_idr: null, promo_ends_at: null, promo_stock_left: null,
    created_at: "now",
  };
  let currentProduct = { ...baseProduct };
  setAdmissionRouteDependenciesForTests({
    postgresRuntimeEnabled: () => true,
    requireOrgContextApi: async () => ({ user, membership }) as never,
    getAuthUser: async () => user as never,
    assertDashboardRate: async () => undefined,
    assertPaidAdmission: async () => undefined,
    allowRate: async () => true,
    smokeGetOrgProduct: async () => currentProduct as never,
    smokeGetProduct: async () => ({ ...currentProduct, org_id: null }) as never,
    pgFindOrCreatePersona: async () => { effects.db++; throw new Error("VALID_CONTROL_DB_BOUNDARY"); },
    generateScripts: async () => { effects.provider++; throw new Error("VALID_CONTROL_PROVIDER_BOUNDARY"); },
    smokeCreateScripts: async () => { effects.db++; return []; },
    createMatrixResources: () => fakeResources as never,
  });
  setMediaStorageForTests({
    ...storage,
    async put(key, body) { effects.storage++; await storage.put(key, body); },
    async delete(key) { effects.storage++; await storage.delete(key); },
    async materialize() { effects.storage++; return null; },
  });
  setEnqueueObserverForTests(() => { effects.queue++; });

  const matrixBody = () => ({
    product_id: currentProduct.id,
    avatar_ids: [avatar.id], template_ids: [scenario.id], tier: "high_quality", ratio: "9:16",
    expected_total_idr: tierPriceIdr("high_quality", scenario.durationSec),
    idempotency_key: "handler-idempotency-key",
  });
  const cases = [
    { boundary: "A2", call: () => postA2(new Request("http://local/api/dashboard/matrix", { method: "POST", body: JSON.stringify(matrixBody()) })) },
    { boundary: "A3", call: () => postA3(new Request("http://local/api/dashboard/campaign/generate", { method: "POST", body: JSON.stringify({ product_id: currentProduct.id, count: 2, tier: "high_quality", duration_sec: 15 }) })) },
    { boundary: "A5", call: () => postA5(new Request("http://local/api/dashboard/campaign/confirm", { method: "POST", body: JSON.stringify({ product_id: currentProduct.id, script_ids: ["script-1"], format: "hands_only", avatar_id: avatar.id }) })) },
    { boundary: "A7", call: () => postA7(new Request("http://local/api/scripts/generate", { method: "POST", body: JSON.stringify({ product_id: currentProduct.id, register: "netral", quality_tier: "high_quality" }) })) },
  ];

  try {
    const corruptRel = "uploads/handler/corrupt.webp";
    values.clear();
    values.set(corruptRel, Buffer.from("CORRUPT-HANDLER-BYTES"));
    values.set(`${corruptRel}.meta.json`, Buffer.from("{corrupt"));
    currentProduct = { ...baseProduct, images: JSON.stringify([corruptRel]) };
    for (const item of cases) {
      effects.provider = effects.db = effects.queue = effects.storage = 0;
      const response = await item.call();
      const payload = await response.json() as { code?: string; message_id?: string };
      assert.equal(response.status, 422, `${item.boundary} tidak fail-closed: ${JSON.stringify(payload)}`);
      assert.equal(payload.code, "NO_APPROVED_REFERENCE", `${item.boundary} reason code salah`);
      assert.match(payload.message_id ?? "", /EVIDENCE_INVALID/);
      assert.deepEqual(effects, { provider: 0, db: 0, queue: 0, storage: 0 }, `${item.boundary} punya efek samping`);
    }

    const validRel = "uploads/handler/valid.webp";
    const validBytes = Buffer.from("VALID-HANDLER-PACKSHOT");
    values.clear(); values.set(validRel, validBytes); values.set(`${validRel}.meta.json`, validSidecar(validBytes));
    currentProduct = { ...baseProduct, images: JSON.stringify([validRel]) };
    for (const item of cases) {
      effects.provider = effects.db = effects.queue = effects.storage = 0;
      const response = await item.call();
      assert.equal(response.status, 500, `${item.boundary} kontrol sah tidak mencapai seam berikutnya`);
      assert.ok(effects.provider + effects.db > 0, `${item.boundary} kontrol sah berhenti di evidence guard`);
      assert.equal(effects.storage, 0, `${item.boundary} preflight read-only menulis storage`);
    }

    // Existing immutable jobs win over current corrupt/deleted product state.
    duplicateRows = [{ id: "existing-job" }];
    values.clear();
    currentProduct = { ...baseProduct, images: JSON.stringify([corruptRel]) };
    effects.provider = effects.db = effects.queue = effects.storage = 0;
    const replay = await cases[0].call();
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { duplicated?: boolean }).duplicated, true);
    assert.deepEqual(effects, { provider: 0, db: 0, queue: 0, storage: 0 });
    currentProduct = { ...baseProduct, images: "[]" };
    const replayAfterDelete = await cases[0].call();
    assert.equal(replayAfterDelete.status, 200, "duplicate replay rusak setelah foto sumber dihapus");
    assert.equal((await replayAfterDelete.json() as { duplicated?: boolean }).duplicated, true);
  } finally {
    setAdmissionRouteDependenciesForTests(undefined);
    setEnqueueObserverForTests(undefined);
    setMediaStorageForTests(storage);
  }
});
