import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMetadataAcquisition } from "../scripts/acquire-normal-representative-metadata.mjs";

const DATABASE_URL = "postgresql://racun_staging_ci:credential@dpg-d9n21fnlk1mc73djm8q0-a.singapore-postgres.render.com:5432/racun_staging?sslmode=verify-full";
const metadata = {
  id: "dpg-d9n21fnlk1mc73djm8q0-a", name: "racun-ai-staging-postgres",
  databaseName: "racun_staging", databaseUser: "racun_staging", region: "singapore", ipAllowList: []
};
const manifest = {
  product_id: "11111111-1111-4111-8111-111111111111",
  product_snapshot_id_or_sha: `sha256:${"a".repeat(64)}`,
  subject_id: "22222222-2222-4222-8222-222222222222",
  reference_asset_id: "products/approved.webp",
  reference_authorization_receipt: {
    type: "approved_reference_manifest:v2", manifest_sha256: "b".repeat(64), manifest_version: 2,
    primary_index: 0, proof_version: 1, label_ocr_status: "READABLE", label_ocr_version: 1
  },
  reference_storage_object_id: `jobs/${"3".repeat(36)}/approved-references/0-${"c".repeat(64)}.webp`,
  reference_digest_sha256: "c".repeat(64)
};

function env(file) {
  return {
    STAGING_RENDER_POSTGRES_ID: metadata.id,
    STAGING_RENDER_API_KEY: "render-test-token",
    STAGING_DATABASE_EXPECTED_USER: "racun_staging_ci",
    MANAGED_DATABASE_URL: DATABASE_URL,
    RACUN_DEPLOY_ENV: "staging", STORAGE_MODE: "r2", R2_REGION: "auto",
    R2_ENDPOINT: "https://staging.example.invalid", R2_BUCKET: "staging-bucket",
    R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret",
    METADATA_RECEIPT_PATH: file
  };
}

function successfulDeps(calls) {
  return {
    async readPostgres() { calls.push("read-metadata"); return metadata; },
    async discoverPublicIPv4() { calls.push("discover-ip"); return "8.8.8.8"; },
    async replaceAllowList(_id, _token, list) { calls.push(list.length ? "open-/32" : "close-empty"); },
    async waitForAllowList(_id, _token, list) { calls.push(list.length ? "readback-/32" : "readback-empty"); },
    async acquireFromDatabaseAndR2() {
      calls.push("read-db-and-r2");
      return { controls: {
        transaction_read_only_verified: true, external_hostname_verified: true, sslmode_verify_full: true,
        current_database_verified: true, current_user_verified: true, dedicated_principal_verified: true,
        pg_stat_ssl_verified: true, certificate_hostname_verified: true, canonical_candidate_count: 1,
        staging_r2_identity_verified: true, r2_get_only: true, reference_digest_match: true,
        zero_mutable_inputs_verified: true
      }, manifest };
    }
  };
}

test("one bounded read-only acquisition freezes only canonical identifiers and always cleans allow-list", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normal-metadata-"));
  const file = path.join(dir, "metadata-receipt.json");
  const calls = [];
  try {
    const receipt = await runMetadataAcquisition(env(file), successfulDeps(calls));
    assert.equal(receipt.decision, "PASS");
    assert.deepEqual(receipt.manifest, manifest);
    assert.deepEqual(calls, ["read-metadata", "discover-ip", "open-/32", "readback-/32", "read-db-and-r2", "close-empty", "readback-empty"]);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).controls.cleanup_readback_empty, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("acquisition failure still closes exact window and emits fail-closed receipt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normal-metadata-fail-"));
  const file = path.join(dir, "metadata-receipt.json");
  const calls = [];
  const deps = successfulDeps(calls);
  deps.acquireFromDatabaseAndR2 = async () => {
    calls.push("read-db-and-r2");
    const error = new Error("CANONICAL_CANDIDATE_COUNT_NOT_ONE"); error.candidateCount = 0; throw error;
  };
  try {
    await assert.rejects(runMetadataAcquisition(env(file), deps), /ACQUISITION_FAILED/);
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(receipt.decision, "FAIL_CLOSED");
    assert.equal(receipt.candidate_count, 0);
    assert.equal(receipt.controls.cleanup_readback_empty, true);
    assert.deepEqual(calls.slice(-2), ["close-empty", "readback-empty"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("control source has no R2 write/delete command and workflow exposes isolated dispatch mode", () => {
  const source = fs.readFileSync(new URL("../scripts/acquire-normal-representative-metadata.mjs", import.meta.url), "utf8");
  assert.match(source, /GetObjectCommand/);
  assert.doesNotMatch(source, /PutObjectCommand|DeleteObjectCommand/);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(source, /ORDER BY[\s\S]*created_at|\blatest\b/i);
  const workflow = fs.readFileSync(new URL("../.github/workflows/managed-mobile-evidence.yml", import.meta.url), "utf8");
  assert.match(workflow, /inputs\.mode == 'representative-metadata-readonly'/);
  assert.match(workflow, /if: always\(\).*metadata_acquisition\.outcome != 'skipped'/);
  assert.match(workflow, /managed-staging-db-tls-window\.mjs close/);
});
