import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "e1-reference-gate-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { setProductImageClassifierForTests } = await import("../lib/product-images");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
const { setProductCreateDependenciesForTests, productCreationRowMatchesExpected } = await import("../lib/product-create-dependencies");
const { POST: createProduct } = await import("../app/api/products/route");
const { PgProductCreateFailure } = await import("../lib/postgres/product-persona-script");
type MediaStorage = import("../lib/storage").MediaStorage;
type HasilLabel = import("../lib/media/label-terbaca").HasilLabel;
type HasilKlasifikasi = import("../lib/media/klasifikasi-gambar").HasilKlasifikasi;

type ReadMutation = "none" | "missing-image" | "missing-sidecar" | "corrupt-sidecar" | "hash-mismatch" | "resolver-error";

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>([["uploads/unrelated/keep.webp", Buffer.from("must-survive")]]);
  putCalls: string[] = [];
  deleteCalls: string[] = [];
  readMutation: ReadMutation = "none";
  failDeletePhoto = false;

  async put(key: string, body: Buffer) {
    this.putCalls.push(key);
    this.values.set(key, Buffer.from(body));
  }

  async delete(key: string) {
    this.deleteCalls.push(key);
    if (this.failDeletePhoto && !key.endsWith(".meta.json")) {
      throw new Error(`controlled E1 delete failure: ${key}`);
    }
    this.values.delete(key);
  }

  async get(key: string) {
    const isSidecar = key.endsWith(".meta.json");
    if (this.readMutation === "resolver-error" && isSidecar) throw new Error(`controlled E1 resolver failure: ${key}`);
    if (this.readMutation === "missing-sidecar" && isSidecar) return null;
    if (this.readMutation === "missing-image" && !isSidecar && key !== "uploads/unrelated/keep.webp") return null;
    const stored = this.values.get(key);
    if (!stored) return null;
    if (this.readMutation === "corrupt-sidecar" && isSidecar) {
      return { body: Buffer.from("{not-json"), size: 9 };
    }
    if (this.readMutation === "hash-mismatch" && !isSidecar && key !== "uploads/unrelated/keep.webp") {
      const body = Buffer.concat([stored, Buffer.from("tampered")]);
      return { body, size: body.length };
    }
    return { body: Buffer.from(stored), size: stored.length };
  }

  async stat(key: string) {
    const body = this.values.get(key);
    return body ? { size: body.length } : null;
  }

  async materialize() { return null; }
}

after(() => {
  setProductCreateDependenciesForTests(undefined);
  setPeriksaLabelFotoForTests(undefined);
  setProductImageClassifierForTests(undefined);
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

const ELIGIBLE: HasilKlasifikasi = {
  jenis: "product_photo",
  layakReferensi: true,
  rasioAreaTeks: 0.001,
  jumlahKata: 2,
  alasan: "foto produk layak",
};

const PROMOTIONAL: HasilKlasifikasi = {
  jenis: "promotional_graphic",
  layakReferensi: false,
  rasioAreaTeks: 0.4,
  jumlahKata: 12,
  alasan: "grafis promosi tidak layak jadi acuan",
};

const LABEL_VALID: HasilLabel = {
  terbaca: true,
  kata: ["HDRV", "Serum"],
  cocokNama: true,
  cocokMerek: true,
};

interface RunOptions {
  postgres?: boolean;
  verdicts?: HasilKlasifikasi[];
  classifierFailure?: boolean;
  labels?: HasilLabel[];
  readMutation?: ReadMutation;
  persistenceFault?: "before-commit" | "before-commit-rollback-failed" | "after-commit" | "commit-attempted-delayed";
  reconciliation?: "automatic" | "absent" | "exact" | "mismatch" | "failure";
  failDeletePhoto?: boolean;
}

async function run(label: string, options: RunOptions = {}) {
  const verdicts = options.verdicts ?? [ELIGIBLE];
  const storage = new MemoryStorage();
  storage.readMutation = options.readMutation ?? "none";
  storage.failDeletePhoto = options.failDeletePhoto ?? false;
  setMediaStorageForTests(storage);

  let classifierIndex = 0;
  setProductImageClassifierForTests(async () => {
    if (options.classifierFailure) throw new Error("controlled classifier unavailable");
    return verdicts[classifierIndex++] ?? verdicts.at(-1)!;
  });

  const labelCalls: Array<{ path: string; name: string; brand?: string | null }> = [];
  let labelIndex = 0;
  setPeriksaLabelFotoForTests(async (fotoPath, productName, brand) => {
    assert.equal(fs.existsSync(fotoPath), true, `${label}: bytes upload wajib tersedia selama label gate`);
    labelCalls.push({ path: fotoPath, name: productName, brand });
    return options.labels?.[labelIndex++] ?? LABEL_VALID;
  });

  let sqliteAttempts = 0;
  let pgAttempts = 0;
  let audits = 0;
  let reconciliationCalls = 0;
  const insertedImages: string[][] = [];
  let delayedImages: string[] | null = null;
  const productId = `e1-${label}-${process.pid}`;
  setProductCreateDependenciesForTests({
    getAuthUser: async () => ({ id: "user-e1" }) as never,
    uuid: () => productId,
    postgresRuntimeEnabled: () => options.postgres ?? false,
    smokeCreateProduct: async (_userId, input) => {
      pgAttempts += 1;
      if (options.persistenceFault === "before-commit") {
        throw new PgProductCreateFailure(new Error("controlled PostgreSQL pre-commit failure"), {
          commitAttempted: false,
          rollbackSucceeded: true,
        });
      }
      if (options.persistenceFault === "before-commit-rollback-failed") {
        throw new PgProductCreateFailure(new Error("controlled PostgreSQL rollback failure"), {
          commitAttempted: false,
          rollbackSucceeded: false,
        });
      }
      if (options.persistenceFault === "commit-attempted-delayed") {
        delayedImages = [...input.images];
        throw new PgProductCreateFailure(new Error("controlled delayed COMMIT acknowledgement failure"), {
          commitAttempted: true,
          rollbackSucceeded: false,
        });
      }
      insertedImages.push([...input.images]);
      if (options.persistenceFault === "after-commit") {
        throw new PgProductCreateFailure(new Error("controlled PostgreSQL commit acknowledgement failure"), {
          commitAttempted: true,
          rollbackSucceeded: false,
        });
      }
      return {} as never;
    },
    getDb: () => ({
      prepare: () => ({
        run: (...args: unknown[]) => {
          sqliteAttempts += 1;
          if (options.persistenceFault === "before-commit") throw new Error("controlled SQLite pre-commit failure");
          insertedImages.push(JSON.parse(String(args[19])) as string[]);
          if (options.persistenceFault === "after-commit") throw new Error("controlled SQLite commit acknowledgement failure");
          return {};
        },
      }),
    }) as never,
    now: () => "2026-08-24T00:00:00.000Z",
    auditProductCreatedOnce: () => { audits += 1; },
    reconcileProductCreation: async (expected, usePostgres) => {
      reconciliationCalls += 1;
      assert.equal(expected.id, productId);
      assert.equal(expected.userId, "user-e1");
      assert.equal(usePostgres, options.postgres ?? false);
      assert.equal(expected.name, `Serum ${label}`);
      assert.deepEqual(expected.images, [0, 1].slice(0, verdicts.length).map((index) => `uploads/${productId}/${index}.webp`));
      if (options.reconciliation === "failure") throw new Error("controlled authoritative reconciliation failure");
      if (options.reconciliation && options.reconciliation !== "automatic") return options.reconciliation;
      if (options.persistenceFault === "commit-attempted-delayed" && delayedImages) {
        // Deterministic visibility race: this read decides "absent", then the
        // already-attempted COMMIT becomes visible immediately afterward.
        insertedImages.push(delayedImages);
        delayedImages = null;
        return "absent";
      }
      return insertedImages.length > 0 ? "exact" : "absent";
    },
  });

  const pngs = await Promise.all(verdicts.map((_, index) =>
    sharp({
      create: { width: 400, height: 400, channels: 3, background: index % 2 ? "#16a34a" : "#7c3aed" },
    }).png().toBuffer()
  ));
  const response = await createProduct(new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Serum ${label}`,
      brand: " HDRV ",
      price_idr: 50000,
      category: "beauty",
      product_type: "serum wajah",
      confirmed_product_type: "serum wajah",
      images_base64: pngs.map((png) => `data:image/png;base64,${png.toString("base64")}`),
    }),
  }));

  assert.ok(labelCalls.every((call) => !fs.existsSync(call.path) && !fs.existsSync(path.dirname(call.path))), `${label}: temp label wajib dibersihkan`);
  return { response, storage, productId, sqliteAttempts, pgAttempts, audits, reconciliationCalls, insertedImages, labelCalls };
}

function createdKeys(result: Awaited<ReturnType<typeof run>>): string[] {
  return [...result.storage.values.keys()].filter((key) => key.startsWith(`uploads/${result.productId}/`)).sort();
}

async function quiet<T>(operation: () => Promise<T>): Promise<{ value: T; logs: unknown[][] }> {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    return { value: await operation(), logs };
  } finally {
    console.error = original;
  }
}

test("E1 POST menerima packshot sah dan memilih referensi sah pertama dalam urutan upload", async () => {
  const sqlite = await run("sqlite-valid", { verdicts: [ELIGIBLE] });
  assert.equal(sqlite.response.status, 201, await sqlite.response.clone().text());
  assert.equal(sqlite.sqliteAttempts, 1);
  assert.equal(sqlite.pgAttempts, 0);
  assert.equal(sqlite.audits, 1);
  assert.equal(sqlite.labelCalls.length, 1);
  assert.deepEqual(sqlite.labelCalls.map((call) => call.brand), ["HDRV"]);
  const sqliteBody = await sqlite.response.json() as { images: string[] };
  assert.deepEqual(sqlite.insertedImages, [sqliteBody.images]);
  assert.deepEqual(createdKeys(sqlite), sqliteBody.images.flatMap((rel) => [rel, `${rel}.meta.json`]).sort());

  const bannerFirst = await run("banner-first", { verdicts: [PROMOTIONAL, ELIGIBLE] });
  assert.equal(bannerFirst.response.status, 201, await bannerFirst.response.clone().text());
  const bannerBody = await bannerFirst.response.json() as { images: string[] };
  assert.deepEqual(bannerBody.images, [
    `uploads/${bannerFirst.productId}/0.webp`,
    `uploads/${bannerFirst.productId}/1.webp`,
  ]);
  assert.deepEqual(bannerFirst.insertedImages, [bannerBody.images], "DB wajib menerima urutan ingestion exact, resolver memilih yang sah");
  assert.equal(bannerFirst.labelCalls.length, 2, "semua blob harus melewati label gate");

  const postgres = await run("pg-multiple-valid", { postgres: true, verdicts: [ELIGIBLE, ELIGIBLE] });
  assert.equal(postgres.response.status, 201, await postgres.response.clone().text());
  assert.equal(postgres.sqliteAttempts, 0);
  assert.equal(postgres.pgAttempts, 1);
  assert.equal(postgres.audits, 0, "audit PG dimiliki smokeCreateProduct atomik, bukan SQLite audit");
  assert.equal(postgres.labelCalls.length, 2);
  assert.equal(postgres.insertedImages[0].length, 2);
});

test("E1 label dan brand gate menolak sebelum storage, row, dan audit", async () => {
  const wrongBrand = await run("wrong-brand", {
    verdicts: [ELIGIBLE, ELIGIBLE],
    labels: [LABEL_VALID, { ...LABEL_VALID, cocokMerek: false, alasan: "merek foto kedua salah" }],
  });
  assert.equal(wrongBrand.response.status, 400);
  assert.deepEqual(await wrongBrand.response.json(), {
    code: "BRAND_MISMATCH",
    message_id: "merek foto kedua salah",
    message_en: "Product label does not match the registered brand.",
    retryable: false,
  });
  assert.equal(wrongBrand.labelCalls.length, 2);
  assert.deepEqual(wrongBrand.storage.putCalls, []);
  assert.deepEqual(createdKeys(wrongBrand), []);
  assert.equal(wrongBrand.sqliteAttempts + wrongBrand.pgAttempts + wrongBrand.audits, 0);

  const unreadable = await run("unreadable", {
    labels: [{ terbaca: false, kata: [], cocokNama: false, cocokMerek: null, alasan: "label terlalu buram" }],
  });
  assert.equal(unreadable.response.status, 400);
  assert.equal((await unreadable.response.json()).code, "LABEL_UNREADABLE");
  assert.deepEqual(unreadable.storage.putCalls, []);
  assert.deepEqual(createdKeys(unreadable), []);
  assert.equal(unreadable.sqliteAttempts + unreadable.pgAttempts + unreadable.audits, 0);
});

test("E1 resolver fail-closed mempertahankan reason code dan rollback exact", async () => {
  const cases: Array<{ label: string; options: RunOptions; reason: RegExp }> = [
    { label: "promotional-only", options: { verdicts: [PROMOTIONAL] }, reason: /REF_PROMOTIONAL/ },
    { label: "classifier-failed", options: { classifierFailure: true }, reason: /CLASSIFIER_FAILED/ },
    { label: "missing-image", options: { readMutation: "missing-image" }, reason: /REF_MISSING/ },
    { label: "missing-sidecar", options: { readMutation: "missing-sidecar" }, reason: /EVIDENCE_INVALID/ },
    { label: "corrupt-sidecar", options: { readMutation: "corrupt-sidecar" }, reason: /EVIDENCE_INVALID/ },
    { label: "hash-mismatch", options: { readMutation: "hash-mismatch" }, reason: /REF_HASH_MISMATCH/ },
  ];

  for (const fixture of cases) {
    const result = await run(fixture.label, fixture.options);
    assert.equal(result.response.status, 422, `${fixture.label}: ${await result.response.clone().text()}`);
    const body = await result.response.json() as { code: string; message_id: string };
    assert.equal(body.code, "NO_APPROVED_REFERENCE");
    assert.match(body.message_id, fixture.reason);
    assert.equal(result.sqliteAttempts + result.pgAttempts + result.audits, 0);
    assert.deepEqual(createdKeys(result), [], `${fixture.label}: bytes+sidecar baru harus hilang`);
    assert.equal(result.storage.values.has("uploads/unrelated/keep.webp"), true, `${fixture.label}: object lain tidak boleh disentuh`);
  }

  const failed = await quiet(() => run("resolver-error", { readMutation: "resolver-error" }));
  assert.equal(failed.value.response.status, 500);
  assert.equal(failed.value.sqliteAttempts + failed.value.pgAttempts + failed.value.audits, 0);
  assert.deepEqual(createdKeys(failed.value), []);
  assert.ok(failed.logs.some((args) => args.some((arg) => String(arg).includes("controlled E1 resolver failure"))));
});

test("E1 hanya rollback persistence yang terbukti pre-commit di SQLite dan PG", async () => {
  for (const postgres of [false, true]) {
    const runtime = postgres ? "pg" : "sqlite";
    const failed = await quiet(() => run(`${runtime}-db-failure`, { postgres, persistenceFault: "before-commit" }));
    assert.equal(failed.value.response.status, 500);
    assert.equal(failed.value.sqliteAttempts, postgres ? 0 : 1);
    assert.equal(failed.value.pgAttempts, postgres ? 1 : 0);
    assert.equal(failed.value.audits, 0);
    assert.equal(failed.value.reconciliationCalls, 1);
    assert.deepEqual(failed.value.insertedImages, [], "fixture DB gagal sebelum row durable");
    assert.deepEqual(createdKeys(failed.value), [], `${runtime}: DB failure wajib membersihkan exact bytes+sidecar`);
    assert.equal(failed.value.storage.values.has("uploads/unrelated/keep.webp"), true);
  }
});

test("E1 memulihkan commit-then-throw exact dan mempertahankan storage saat outcome unknown/mismatch", async () => {
  for (const postgres of [false, true]) {
    const runtime = postgres ? "pg" : "sqlite";
    const recovered = await run(`${runtime}-commit-then-throw`, { postgres, persistenceFault: "after-commit" });
    assert.equal(recovered.response.status, 201, await recovered.response.clone().text());
    assert.equal(recovered.reconciliationCalls, 1);
    assert.equal(recovered.insertedImages.length, 1, "fixture wajib merekam row durable sebelum acknowledgement gagal");
    assert.equal(recovered.audits, postgres ? 0 : 1, "SQLite audit dipulihkan once; audit PG atomik dengan create");
    assert.equal(createdKeys(recovered).length, 2, "row exact recovered wajib mempertahankan bytes+sidecar");

    for (const reconciliation of ["mismatch", "failure"] as const) {
      const ambiguous = await quiet(() => run(`${runtime}-${reconciliation}`, {
        postgres,
        persistenceFault: "after-commit",
        reconciliation,
      }));
      assert.equal(ambiguous.value.response.status, 500);
      assert.equal(ambiguous.value.reconciliationCalls, 1);
      assert.equal(ambiguous.value.insertedImages.length, 1, "fixture wajib punya row durable/unknown");
      assert.equal(ambiguous.value.audits, 0, "outcome non-exact tidak boleh menerbitkan audit sukses tambahan");
      assert.equal(createdKeys(ambiguous.value).length, 2, `${runtime}/${reconciliation}: storage wajib ditahan`);
      assert.deepEqual(ambiguous.value.storage.deleteCalls, [], `${runtime}/${reconciliation}: tidak boleh menghapus saat outcome unknown`);
      const logText = ambiguous.logs.flat().map(String).join(" ");
      assert.match(logText, reconciliation === "mismatch" ? /reconciliation mismatch/ : /outcome unknown/);
    }
  }
});

test("E1 PG tidak memakai absent-first sebagai otoritas setelah COMMIT attempted atau rollback gagal", async () => {
  const delayed = await quiet(() => run("pg-delayed-commit", {
    postgres: true,
    persistenceFault: "commit-attempted-delayed",
  }));
  assert.equal(delayed.value.response.status, 500);
  assert.equal(delayed.value.reconciliationCalls, 1, "hanya satu read yang sempat melihat absent");
  assert.equal(delayed.value.insertedImages.length, 1, "COMMIT menjadi visible sesudah absent read");
  assert.equal(createdKeys(delayed.value).length, 2, "bytes+sidecar wajib bertahan untuk row yang terlambat visible");
  assert.deepEqual(delayed.value.storage.deleteCalls, []);
  assert.match(delayed.logs.flat().map(String).join(" "), /COMMIT may have been attempted/);

  const rollbackFailed = await quiet(() => run("pg-rollback-unproven", {
    postgres: true,
    persistenceFault: "before-commit-rollback-failed",
  }));
  assert.equal(rollbackFailed.value.response.status, 500);
  assert.equal(rollbackFailed.value.insertedImages.length, 0, "control belum mencatat row visible");
  assert.equal(rollbackFailed.value.reconciliationCalls, 1);
  assert.equal(createdKeys(rollbackFailed.value).length, 2, "rollback yang tidak terbukti wajib menahan storage");
  assert.deepEqual(rollbackFailed.value.storage.deleteCalls, []);
});

test("E1 authoritative reconciliation membutuhkan exact ID, owner, ordered images, dan seluruh create data", () => {
  const expected = {
    id: "product-exact",
    userId: "owner-exact",
    sourceUrl: "https://example.test/product",
    name: "Serum Exact",
    priceIdr: 50000,
    category: "beauty",
    categoryReviewState: "CLEAR" as const,
    categoryReviewReason: null,
    categoryReviewedBy: null,
    categoryReviewedRole: null,
    categoryReviewedAt: null,
    categoryReviewVersion: 1,
    productVisualDesc: "botol ungu",
    images: ["uploads/product-exact/0.webp", "uploads/product-exact/1.webp"],
    promoPriceBeforeIdr: 70000,
    promoEndsAt: "2026-09-01T00:00:00.000Z",
    promoStockLeft: 3,
    rawMeta: { brand: "HDRV" },
  };
  const row = {
    id: expected.id,
    user_id: expected.userId,
    org_id: null,
    source_url: expected.sourceUrl,
    name: expected.name,
    price_idr: expected.priceIdr,
    category: expected.category,
    category_review_state: expected.categoryReviewState,
    category_review_reason: expected.categoryReviewReason,
    category_reviewed_by: expected.categoryReviewedBy,
    category_reviewed_role: expected.categoryReviewedRole,
    category_reviewed_at: expected.categoryReviewedAt,
    category_review_version: expected.categoryReviewVersion,
    product_visual_desc: expected.productVisualDesc,
    brand_brief: null,
    images: JSON.stringify(expected.images),
    promo_price_before_idr: expected.promoPriceBeforeIdr,
    promo_ends_at: expected.promoEndsAt,
    promo_stock_left: expected.promoStockLeft,
    raw_meta: JSON.stringify(expected.rawMeta),
    created_at: "2026-08-24T00:00:00.000Z",
  };
  assert.equal(productCreationRowMatchesExpected(row, expected), true);
  const mutations = [
    { id: "other-id" },
    { user_id: "other-owner" },
    { org_id: "org-not-retail" },
    { source_url: null },
    { name: "Other" },
    { price_idr: 1 },
    { category: "other" },
    { category_review_state: "QUARANTINED" },
    { category_review_reason: "CATEGORY_UNKNOWN" },
    { category_review_version: 2 },
    { product_visual_desc: null },
    { brand_brief: "unexpected" },
    { images: JSON.stringify([...expected.images].reverse()) },
    { promo_price_before_idr: null },
    { promo_ends_at: null },
    { promo_stock_left: null },
    { raw_meta: JSON.stringify({ brand: "OTHER" }) },
  ];
  for (const mutation of mutations) {
    assert.equal(productCreationRowMatchesExpected({ ...row, ...mutation }, expected), false, JSON.stringify(mutation));
  }
});

test("PG create phase marker dipasang tepat sebelum COMMIT dikirim", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/postgres/product-persona-script.ts"), "utf8");
  const createStart = source.indexOf("async createProduct(");
  const createEnd = source.indexOf("/** Mirrors /api/products/extract", createStart);
  const create = source.slice(createStart, createEnd);
  const assertPhase = (candidate: string, context: string) => {
    const marker = candidate.indexOf("commitAttempted = true");
    const commit = candidate.indexOf('client.query("COMMIT")');
    const rollback = candidate.indexOf('client.query("ROLLBACK")');
    const typed = candidate.indexOf("new PgProductCreateFailure");
    assert.ok(marker >= 0 && commit > marker, `${context}: phase wajib true sebelum COMMIT dikirim`);
    assert.ok(rollback > commit && typed > rollback, `${context}: rollback outcome wajib direkam dalam typed failure`);
  };
  assertPhase(create, "production");

  const movedAfterCommit = create.replace(
    'commitAttempted = true;\n      await client.query("COMMIT");',
    'await client.query("COMMIT");\n      commitAttempted = true;',
  );
  assert.throws(() => assertPhase(movedAfterCommit, "counterexample marker terlambat"), /sebelum COMMIT/);
});

test("E1 cleanup failure setelah reference rejection tetap terlihat sebagai 500", async () => {

  const cleanup = await quiet(() => run("cleanup-failure", { verdicts: [PROMOTIONAL], failDeletePhoto: true }));
  assert.equal(cleanup.value.response.status, 500);
  assert.equal(cleanup.value.sqliteAttempts + cleanup.value.pgAttempts + cleanup.value.audits, 0);
  assert.ok(createdKeys(cleanup.value).some((key) => !key.endsWith(".meta.json")), "fault fixture wajib menyisakan residual foto");
  assert.ok(cleanup.logs.some((args) => args.some((arg) => String(arg).includes("E1 reference rejection cleanup failed"))));
  assert.ok(cleanup.logs.some((args) => args.some((arg) => String(arg).includes("residual storage objects may remain"))));
});

function assertE1BoundarySource(source: string, context: string): void {
  const label = source.indexOf("await periksaLabelFoto(");
  const unreadable = source.indexOf("assertAuthoritativeLabelResult(label)");
  const brand = source.indexOf("if (label.cocokMerek === false)");
  const save = source.indexOf("await saveProductImages(");
  const resolve = source.indexOf("await resolveApprovedReference(images)");
  const pg = source.indexOf("await dependencies.smokeCreateProduct(");
  const sqlite = source.indexOf("dependencies.getDb()");
  const reconcile = source.indexOf("await dependencies.reconcileProductCreation(expectedCreation, usePostgres)");
  const rollback = source.lastIndexOf('await rejectAfterReferenceCheck("E1", images, creationError)');
  const audit = source.indexOf("dependencies.auditProductCreatedOnce(");

  assert.ok(label >= 0 && unreadable > label && brand > unreadable, `${context}: every-blob label/brand gate wajib lengkap`);
  assert.ok(save > brand, `${context}: storage tidak boleh mendahului label/brand gate`);
  assert.ok(resolve > save, `${context}: canonical resolver wajib sesudah ingestion`);
  assert.ok(pg > resolve && sqlite > resolve, `${context}: kedua persistence seam wajib sesudah resolver`);
  assert.ok(reconcile > pg && reconcile > sqlite, `${context}: persistence exception wajib direkonsiliasi authoritative`);
  assert.ok(rollback > reconcile, `${context}: DB rollback storage hanya boleh sesudah reconciliation absent`);
  assert.ok(audit > rollback, `${context}: audit sukses wajib sesudah guarded persistence`);
}

test("E1 structural mutation guard menolak bypass label, resolver, persistence awal, dan rollback non-exact", () => {
  const production = fs.readFileSync(path.join(process.cwd(), "app/api/products/route.ts"), "utf8");
  assertE1BoundarySource(production, "E1 production");

  const counterexamples = [
    ["label bypass", production.replace("await periksaLabelFoto(", "await bypassLabel("), /label\/brand gate wajib lengkap/],
    ["brand bypass", production.replace("if (label.cocokMerek === false)", "if (false)"), /label\/brand gate wajib lengkap/],
    ["resolver bypass", production.replace("await resolveApprovedReference(images)", "await resolveAnything(images)"), /canonical resolver wajib/],
    ["SQLite before resolver", production.replace(
      "const resolution = await resolveApprovedReference(images)",
      "dependencies.getDb();\n    const resolution = await resolveApprovedReference(images)"
    ), /persistence seam wajib sesudah resolver/],
    ["PG before resolver", production.replace(
      "const resolution = await resolveApprovedReference(images)",
      "await dependencies.smokeCreateProduct(user.id, {} as never, id);\n    const resolution = await resolveApprovedReference(images)"
    ), /persistence seam wajib sesudah resolver/],
    ["rollback wrong set", production.replace(
      'await rejectAfterReferenceCheck("E1", images, creationError)',
      'await rejectAfterReferenceCheck("E1", images.slice(1), creationError)'
    ), /DB rollback storage hanya boleh/],
    ["reconciliation bypass", production.replace(
      "await dependencies.reconcileProductCreation(expectedCreation, usePostgres)",
      "await Promise.resolve('absent')"
    ), /direkonsiliasi authoritative/],
  ] as const;

  for (const [name, source, expected] of counterexamples) {
    assert.throws(() => assertE1BoundarySource(source, `counterexample ${name}`), expected, `${name} tidak boleh lolos guard`);
  }
});
