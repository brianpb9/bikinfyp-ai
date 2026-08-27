import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

process.env.RACUN_NO_DOTENV = "1";

const { setMediaStorageForTests } = await import("../lib/storage");
const {
  acquireAdmissionReferenceEvidence,
  assertAdmissionReferenceEvidence,
  setEvidenceLockDependenciesForTests,
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
  labelOcrStatus: "READABLE", labelOcrVersion: 1,
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

test("PostgreSQL advisory lease bertahan melewati idle transaction timeout dan cleanup tidak mengubah outcome", async () => {
  values.clear();
  const rel = "uploads/admission-pg/packshot.webp";
  const bytes = Buffer.from("PACKSHOT-PG-SAH");
  values.set(rel, bytes);
  values.set(`${rel}.meta.json`, validSidecar(bytes));

  const { pgIdleTransactionTimeoutMs } = await import("../lib/postgres/pool");
  const previousIdleTimeout = process.env.PG_IDLE_TX_TIMEOUT_MS;
  process.env.PG_IDLE_TX_TIMEOUT_MS = "15";
  const configuredIdleTransactionTimeoutMs = pgIdleTransactionTimeoutMs();
  const queries: string[] = [];
  const releases: Array<Error | undefined> = [];
  let locked = false;
  let mutationRan = false;
  let failNextUnlock = false;

  const connect = async () => {
    let ownsLock = false;
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_lock")) {
          if (locked) return { rows: [{ locked: false }], rowCount: 1 };
          locked = true;
          ownsLock = true;
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (sql.includes("pg_advisory_unlock")) {
          if (failNextUnlock) {
            failNextUnlock = false;
            throw new Error("INJECTED_UNLOCK_FAILURE");
          }
          const unlocked = ownsLock;
          ownsLock = false;
          locked = false;
          return { rows: [{ unlocked }], rowCount: 1 };
        }
        if (sql.includes("FROM products WHERE")) {
          return { rows: [{
            images: JSON.stringify([rel]), product_type_token: "serum wajah",
            product_type_confirmed_token: "serum wajah", product_type_confirmed_by: "user-pg",
            product_type_confirmed_at: new Date("2026-08-27T00:00:00.000Z"),
            product_type_version: 1, product_type_state: "CONFIRMED",
            category_review_state: "CLEAR", category_review_reason: null,
            category_reviewed_by: null, category_reviewed_role: null,
            category_reviewed_at: null, category_review_version: 1,
          }], rowCount: 1 };
        }
        if (sql.includes("UPDATE products")) {
          mutationRan = true;
          return { rows: [{ images: "[]" }], rowCount: 1 };
        }
        throw new Error(`Unexpected fake PG query: ${sql}`);
      },
      release(error?: Error) {
        releases.push(error);
        // Destroying a failed session releases every session advisory lock.
        if (error && ownsLock) {
          ownsLock = false;
          locked = false;
        }
      },
    };
    return client as never;
  };

  setEvidenceLockDependenciesForTests({
    postgresRuntimeEnabled: () => true,
    connect,
    useProcessLocalLock: false,
  });
  try {
    const lease = await acquireAdmissionReferenceEvidence({
      productId: "product-pg-lock",
      owner: { kind: "user", id: "user-pg" },
      boundary: "A7",
      loadSqliteCandidateRels: () => { throw new Error("SQLite fallback tidak boleh dipakai"); },
    });
    const deletion = withProductEvidenceMutationLock("product-pg-lock", async (client) => {
      await client!.query("UPDATE products SET images='[]' WHERE id=$1", ["product-pg-lock"]);
    });

    // This deliberately exceeds the configured idle-transaction timeout. A
    // transaction/FOR SHARE lease would be killed here; a session advisory
    // lock remains held because there is no idle transaction at all.
    await new Promise((resolve) => setTimeout(resolve, configuredIdleTransactionTimeoutMs * 2));
    assert.equal(mutationRan, false, "mutasi lolos setelah idle transaction timeout");
    assert.equal(queries.some((sql) => /\b(BEGIN|COMMIT)\b/.test(sql)), false, "lease masih memakai transaksi idle");
    await lease.release();
    await deletion;
    assert.equal(mutationRan, true, "mutasi tidak dilanjutkan setelah release");

    // Provider/setup errors retain their original identity, and cleanup never
    // introduces a post-effect COMMIT. Even an unlock failure is contained by
    // evicting the connection, which releases its session lock server-side.
    const providerError = new Error("PROVIDER_SETUP_FAILED");
    let errorLease: Awaited<ReturnType<typeof acquireAdmissionReferenceEvidence>> | null = null;
    let caught: unknown;
    try {
      errorLease = await acquireAdmissionReferenceEvidence({
        productId: "product-pg-error",
        owner: { kind: "user", id: "user-pg" },
        boundary: "A7",
        loadSqliteCandidateRels: () => [],
      });
      throw providerError;
    } catch (error) {
      caught = error;
    } finally {
      await errorLease?.release();
    }
    assert.equal(caught, providerError);

    const postEffectLease = await acquireAdmissionReferenceEvidence({
      productId: "product-pg-unlock-failure",
      owner: { kind: "user", id: "user-pg" },
      boundary: "A7",
      loadSqliteCandidateRels: () => [],
    });
    failNextUnlock = true;
    await postEffectLease.release();
    assert.ok(releases.some((error) => error?.message === "INJECTED_UNLOCK_FAILURE"));
    assert.equal(queries.some((sql) => /\bCOMMIT\b/.test(sql)), false, "cleanup melakukan COMMIT setelah efek provider");
  } finally {
    setEvidenceLockDependenciesForTests(undefined);
    if (previousIdleTimeout === undefined) delete process.env.PG_IDLE_TX_TIMEOUT_MS;
    else process.env.PG_IDLE_TX_TIMEOUT_MS = previousIdleTimeout;
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
    "await materializeJobReferenceManifest(currentEvidence.manifest", [
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
  let lockedProduct: Record<string, unknown>;
  const fakeClient = {
    async query(sql: string) {
      if (sql.includes("SELECT id FROM jobs")) return { rows: duplicateRows, rowCount: duplicateRows.length };
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }], rowCount: 1 };
      if (sql.includes("FROM products WHERE id=$1")) return { rows: [lockedProduct], rowCount: 1 };
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
    product_type_token: "serum wajah", product_type_confirmed_token: "serum wajah",
    // node-postgres parses TIMESTAMPTZ as Date. A2/A3 must canonicalize this
    // exact runtime shape before the strict provenance boundary.
    product_type_confirmed_by: user.id, product_type_confirmed_at: new Date("2026-08-27T00:00:00.000Z"),
    product_type_version: 1, product_type_state: "CONFIRMED",
    category_review_state: "CLEAR", category_review_reason: null,
    category_reviewed_by: null, category_reviewed_role: null,
    category_reviewed_at: null, category_review_version: 1,
    created_at: "now",
  };
  let currentProduct = { ...baseProduct };
  lockedProduct = currentProduct;
  setEvidenceLockDependenciesForTests({
    postgresRuntimeEnabled: () => true,
    connect: async () => fakeClient as never,
    useProcessLocalLock: false,
  });
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
    connectMatrixRunLockClient: async () => fakeClient as never,
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
    lockedProduct = currentProduct;
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
    lockedProduct = currentProduct;
    for (const item of cases) {
      effects.provider = effects.db = effects.queue = effects.storage = 0;
      const response = await item.call();
      assert.equal(response.status, 500, `${item.boundary} kontrol sah tidak mencapai seam berikutnya`);
      assert.ok(effects.provider + effects.db > 0, `${item.boundary} kontrol sah berhenti di evidence guard`);
      assert.equal(effects.storage, 0, `${item.boundary} preflight read-only menulis storage`);
    }

    // Initial row is valid, but the row reloaded under the evidence lock was
    // quarantined before A2/A3 could create personas, scripts, or call writer.
    currentProduct = { ...baseProduct, images: JSON.stringify([validRel]) };
    lockedProduct = { ...currentProduct, product_type_state: "QUARANTINED" };
    for (const item of cases.slice(0, 2)) {
      effects.provider = effects.db = effects.queue = effects.storage = 0;
      const response = await item.call();
      const payload = await response.json() as { code?: string };
      assert.equal(response.status, 422, `${item.boundary} menerima C2 quarantine setelah initial read`);
      assert.equal(payload.code, "PRODUCT_TYPE_CONFIRMATION_REQUIRED");
      assert.deepEqual(effects, { provider: 0, db: 0, queue: 0, storage: 0 });
    }

    // C5 is checked from the row reloaded while the product lock is held.
    // A5 must not create a persona/audit trail, and A7 must not call the
    // script provider or persist scripts, when a previously clear product is
    // re-quarantined after the handlers' initial product read.
    lockedProduct = {
      ...currentProduct,
      category_review_state: "QUARANTINED",
      category_review_reason: "CATEGORY_AMBIGUOUS",
      category_review_version: 2,
    };
    for (const item of cases.slice(2)) {
      effects.provider = effects.db = effects.queue = effects.storage = 0;
      const response = await item.call();
      const payload = await response.json() as { code?: string };
      assert.equal(response.status, 422, `${item.boundary} menerima C5 quarantine setelah initial read`);
      assert.equal(payload.code, "CATEGORY_REVIEW_REQUIRED");
      assert.deepEqual(effects, { provider: 0, db: 0, queue: 0, storage: 0 },
        `${item.boundary} menulis persona/audit/script atau memanggil provider saat C5 quarantine`);
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
    setEvidenceLockDependenciesForTests(undefined);
    setEnqueueObserverForTests(undefined);
    setMediaStorageForTests(storage);
  }
});
