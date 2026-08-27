import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import test, { afterEach } from "node:test";
import { ApiError } from "../lib/errors";
import {
  buildAuthoritativeTypeBoundaryInput,
  validateAuthoritativeProductType,
} from "../lib/product-type-boundary";
import { setProductCreateDependenciesForTests } from "../lib/product-create-dependencies";
import { POST as createProduct } from "../app/api/products/route";
import { PRODUCT_TYPE_SQLITE_UPGRADE_GUARDS } from "../lib/db";
import { canonicalProductTypeTimestamp } from "../lib/product-type-timestamp";

const declared = (token: string) => ({
  kind: "DECLARED_PRODUCT_TYPE" as const,
  sourceId: "request.product_type",
  token,
  version: 1 as const,
});
const confirmed = (token: string) => ({
  kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION" as const,
  token,
  actorId: "user-c2",
  confirmedAt: "2026-08-27T00:00:00.000Z",
  version: 1 as const,
  provenance: "USER_SELF_ASSERTION" as const,
});

afterEach(() => setProductCreateDependenciesForTests(undefined));

test("C2 canonical normalization admits matching confirmation exactly once", async () => {
  let effects = 0;
  const result = await validateAuthoritativeProductType(
    buildAuthoritativeTypeBoundaryInput(declared("  Sérum Wajah  "), confirmed("se\u0301rum wajah")),
    () => { effects += 1; return "persisted"; },
  );
  assert.equal(result, "persisted");
  assert.equal(effects, 1);
});

test("C2 canonicalizes node-postgres TIMESTAMPTZ Date without normalizing invalid strings", () => {
  assert.equal(
    canonicalProductTypeTimestamp(new Date("2026-08-27T00:00:00.000Z")),
    "2026-08-27T00:00:00.000Z",
  );
  assert.equal(
    canonicalProductTypeTimestamp("2026-02-31T00:00:00.000Z"),
    "2026-02-31T00:00:00.000Z",
    "string provenance must remain byte-exact for strict boundary rejection",
  );
});

test("C2 concurrency guards preserve E3/E7 provenance and validate locked admission rows", () => {
  const campaign = fs.readFileSync("app/api/dashboard/campaign/product/route.ts", "utf8");
  const ordinaryStart = campaign.indexOf("An ordinary detail save must never copy the C2 fields");
  const ordinaryEnd = campaign.indexOf("} finally", ordinaryStart);
  assert.ok(ordinaryStart > 0 && ordinaryEnd > ordinaryStart);
  assert.doesNotMatch(campaign.slice(ordinaryStart, ordinaryEnd), /product_type_(?:token|confirmed|version|state)/,
    "ordinary E7 save still writes durable confirmation fields");

  const retail = fs.readFileSync("app/api/products/[id]/route.ts", "utf8");
  const retailLock = retail.indexOf("withProductEvidenceMutationLock(id");
  const retailRead = retail.indexOf("smokeGetProduct(user.id, id)", retailLock);
  const retailOrdinary = retail.indexOf("pgUpdateProductDetails(user.id, id", retailRead);
  assert.ok(retailLock > 0 && retailRead > retailLock && retailOrdinary > retailRead,
    "E3 does not read/update ordinary details under the shared product lock");

  const evidenceLease = fs.readFileSync("lib/job-admission-reference.ts", "utf8");
  assert.match(evidenceLease, /SELECT images,product_type_token,product_type_confirmed_token,product_type_confirmed_by,[\s\S]+product_type_state[\s\S]+FROM products/,
    "A2/A3 evidence lease does not reload complete C2 state");
  for (const route of [
    "app/api/dashboard/matrix/route.ts",
    "app/api/dashboard/campaign/generate/route.ts",
  ]) {
    const source = fs.readFileSync(route, "utf8");
    const lease = source.indexOf("evidenceLease = await acquireAdmissionReferenceEvidence(");
    const lockedValidation = source.indexOf("locked-org-product.product_type_token", lease);
    const firstEffect = Math.min(
      ...["pgFindOrCreatePersona(", "generateScripts({", "smokeCreateScripts("].map((needle) => {
        const found = source.indexOf(needle, lockedValidation);
        return found < 0 ? Number.MAX_SAFE_INTEGER : found;
      }),
    );
    assert.ok(lease > 0 && lockedValidation > lease && firstEffect > lockedValidation,
      `${route} does not validate locked C2 state before its first effect`);
  }

  const pgAdmission = fs.readFileSync("lib/postgres/smoke-runtime.ts", "utf8");
  const lockedRead = pgAdmission.indexOf("FROM products WHERE id=$1 AND user_id=$2 FOR SHARE");
  const lockedValidation = pgAdmission.indexOf("locked-retail-product.product_type_token", lockedRead);
  const preparation = pgAdmission.indexOf("prepareAdmissionReferenceManifest({", lockedValidation);
  assert.ok(lockedRead > 0 && lockedValidation > lockedRead && preparation > lockedValidation,
    "A1 PostgreSQL does not validate the locked product before preparation/admission");

  const sqliteAdmission = fs.readFileSync("app/api/jobs/route.ts", "utf8");
  const admissionLock = sqliteAdmission.indexOf("withProductEvidenceMutationLock(product.id");
  const admissionLockedValidation = sqliteAdmission.indexOf("locked-admission-product.product_type_token", admissionLock);
  const personaEffect = sqliteAdmission.indexOf("pgFindOrCreatePersona(", admissionLockedValidation);
  const nonceEffect = sqliteAdmission.indexOf("claimManagedStagingTraceNonce(", admissionLockedValidation);
  assert.ok(admissionLock > 0 && admissionLockedValidation > admissionLock
    && personaEffect > admissionLockedValidation && nonceEffect > admissionLockedValidation,
    "A1 does not acquire the shared lock and revalidate C2 before persona/trace effects");
  const candidateValidation = sqliteAdmission.indexOf("admission-product.product_type_token");
  const sqlitePreparation = sqliteAdmission.indexOf("prepareAdmissionReferenceManifest({", candidateValidation);
  const transactionCas = sqliteAdmission.indexOf('return { kind: "product_type_changed"', sqlitePreparation);
  assert.ok(candidateValidation > 0 && sqlitePreparation > candidateValidation && transactionCas > sqlitePreparation,
    "A1 SQLite lacks pre-prepare validation plus transaction-time C2 CAS");
});

test("C2 mismatch, missing confirmation, and forged capability fail closed with zero effects", async () => {
  for (const [input, code] of [
    [buildAuthoritativeTypeBoundaryInput(declared("pasta gigi"), confirmed("sabun wajah")), "TYPE_MISMATCH"],
    [buildAuthoritativeTypeBoundaryInput(declared("pasta gigi"), null), "PRODUCT_TYPE_CONFIRMATION_REQUIRED"],
  ] as const) {
    let effects = 0;
    await assert.rejects(
      () => validateAuthoritativeProductType(input, () => { effects += 1; }),
      (error) => error instanceof ApiError && error.body.code === code,
    );
    assert.equal(effects, 0);
  }
  assert.throws(
    () => buildAuthoritativeTypeBoundaryInput(declared("pasta gigi"), Object.freeze({
      kind: "TRUSTED_TYPE_SOURCE", token: "pasta gigi", actorId: "user-c2",
      confirmedAt: "2026-08-27T00:00:00.000Z", version: 1, provenance: "USER_SELF_ASSERTION",
    }) as never),
    (error) => error instanceof ApiError && error.body.code === "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
  );
  assert.throws(
    () => buildAuthoritativeTypeBoundaryInput(declared("serum wajah"), {
      ...confirmed("serum wajah"), confirmedAt: "2026-02-31T00:00:00.000Z",
    }),
    (error) => error instanceof ApiError && error.body.code === "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
  );
});

test("E1 actual handler rejects mismatch before storage, persistence, or audit", async () => {
  const calls = { db: 0, pg: 0, audit: 0 };
  setProductCreateDependenciesForTests({
    getAuthUser: async () => ({ id: "user-c2" }) as never,
    now: () => "2026-08-27T00:00:00.000Z",
    getDb: () => { calls.db += 1; throw new Error("forbidden DB access"); },
    postgresRuntimeEnabled: () => false,
    smokeCreateProduct: async () => { calls.pg += 1; throw new Error("forbidden PG access"); },
    auditProductCreatedOnce: () => { calls.audit += 1; },
  });
  const response = await createProduct(new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Pasta Gigi", price_idr: 25000, category: "beauty",
      product_type: "pasta gigi", confirmed_product_type: "sabun wajah", images_base64: [],
    }),
  }));
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { code: string }).code, "TYPE_MISMATCH");
  assert.deepEqual(calls, { db: 0, pg: 0, audit: 0 });
});

test("C2 durable schema and migration quarantine legacy rows without taxonomy constraints", () => {
  const sqlite = fs.readFileSync("lib/schema.sql", "utf8");
  const postgres = fs.readFileSync("migrations/postgres/0036_product_type_confirmation.sql", "utf8");
  for (const column of ["product_type_token", "product_type_confirmed_token", "product_type_confirmed_by", "product_type_confirmed_at", "product_type_version", "product_type_state"]) {
    assert.match(sqlite, new RegExp(`\\b${column}\\b`));
    assert.match(postgres, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sqlite, /product_type_state\s+TEXT\s+NOT NULL\s+DEFAULT 'QUARANTINED'/);
  assert.match(sqlite, /product_type_token\s*=\s*product_type_confirmed_token/);
  assert.match(postgres, /DEFAULT 'QUARANTINED'/);
  assert.match(postgres, /product_type_token\s*=\s*product_type_confirmed_token/);
  assert.doesNotMatch(postgres, /toothpaste|serum|facewash|pasta gigi/i);
});

test("C2 upgraded SQLite quarantines old invalid confirmation and rejects future invalid confirmed rows", () => {
  const fresh = new Database(":memory:");
  fresh.pragma("foreign_keys = ON");
  fresh.exec(fs.readFileSync("lib/schema.sql", "utf8"));
  fresh.prepare("INSERT INTO users (id,phone,tier,locale,created_at) VALUES (?,?,?,?,?)")
    .run("user-c2", "081200000001", "free", "id-ID", "2026-08-27T00:00:00.000Z");
  const freshInsert = fresh.prepare(`INSERT INTO products
      (id,user_id,name,price_idr,category,product_type_token,product_type_confirmed_token,
       product_type_confirmed_by,product_type_confirmed_at,product_type_version,product_type_state,images,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  assert.throws(
    () => freshInsert.run(
        "fresh-unicode", "user-c2", "Produk", 10000, "beauty", "\u00a0", "\u00a0", "\u00a0", "2026-08-27T00:00:00.000Z", 1,
        "CONFIRMED", "[]", "2026-08-27T00:00:00.000Z",
      ),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => freshInsert.run(
      "fresh-date", "user-c2", "Produk", 10000, "beauty", "serum wajah", "serum wajah", "user-c2",
      "2026-02-31T00:00:00.000Z", 1, "CONFIRMED", "[]", "2026-08-27T00:00:00.000Z",
    ),
    /CHECK constraint failed/,
  );
  fresh.close();

  const upgraded = new Database(":memory:");
  upgraded.exec(`CREATE TABLE products (
    id TEXT PRIMARY KEY,
    product_type_token TEXT,
    product_type_confirmed_token TEXT,
    product_type_confirmed_by TEXT,
    product_type_confirmed_at TEXT,
    product_type_version INTEGER,
    product_type_state TEXT NOT NULL DEFAULT 'QUARANTINED'
  )`);
  upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
    .run("old-invalid", "", "", "", "", 1, "CONFIRMED");
  upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
    .run("old-unicode", "\u00a0", "\u00a0", "\u00a0", "2026-08-27T00:00:00.000Z", 1, "CONFIRMED");
  upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
    .run("old-date", "serum wajah", "serum wajah", "user-c2", "2026-02-31T00:00:00.000Z", 1, "CONFIRMED");

  upgraded.exec(PRODUCT_TYPE_SQLITE_UPGRADE_GUARDS);
  assert.equal((upgraded.prepare("SELECT product_type_state FROM products WHERE id='old-invalid'").get() as { product_type_state: string }).product_type_state, "QUARANTINED");
  assert.equal(Number((upgraded.prepare("SELECT COUNT(*) AS n FROM products WHERE id IN ('old-unicode','old-date') AND product_type_state='QUARANTINED'").get() as { n: number }).n), 2);

  assert.throws(
    () => upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
      .run("new-invalid", " ", " ", " ", "not-a-time", null, "CONFIRMED"),
    /invalid product type/,
  );
  assert.throws(
    () => upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
      .run("new-unicode", "\u00a0", "\u00a0", "\u00a0", "2026-08-27T00:00:00.000Z", 1, "CONFIRMED"),
    /invalid product type/,
  );
  assert.throws(
    () => upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
      .run("new-date", "serum wajah", "serum wajah", "user-c2", "2026-02-31T00:00:00.000Z", 1, "CONFIRMED"),
    /invalid product type/,
  );
  upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
    .run("valid", "serum wajah", "serum wajah", "user-c2", "2026-08-27T00:00:00.000Z", 1, "CONFIRMED");
  assert.throws(
    () => upgraded.prepare("UPDATE products SET product_type_confirmed_by='' WHERE id='valid'").run(),
    /invalid product type/,
  );
  assert.throws(
    () => upgraded.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?)")
      .run("bad-state", null, null, null, null, null, "UNKNOWN"),
    /invalid product type state/,
  );
  upgraded.close();
});
