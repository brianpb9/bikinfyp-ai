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
