import assert from "node:assert/strict";
import fs from "node:fs";
import test, { afterEach } from "node:test";
import { ApiError } from "../lib/errors";
import {
  buildAuthoritativeTypeBoundaryInput,
  validateAuthoritativeProductType,
} from "../lib/product-type-boundary";
import { setProductCreateDependenciesForTests } from "../lib/product-create-dependencies";
import { POST as createProduct } from "../app/api/products/route";

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
