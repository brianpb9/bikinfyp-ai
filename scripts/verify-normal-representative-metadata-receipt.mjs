#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) throw new Error("receipt directory required");
const receiptPath = path.join(dir, "metadata-receipt.json");
const cleanupPath = path.join(dir, "secondary-cleanup.json");
for (const file of [receiptPath, cleanupPath]) {
  assert.equal(fs.lstatSync(file).isFile(), true);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
}
const receiptBytes = fs.readFileSync(receiptPath);
const cleanupBytes = fs.readFileSync(cleanupPath);
const receipt = JSON.parse(receiptBytes);
const cleanup = JSON.parse(cleanupBytes);

assert.equal(receipt.schema, "normal-representative-metadata-acquisition/v1");
assert.equal(receipt.task, "NORMAL-REPRESENTATIVE-METADATA-ACQUISITION-20260829");
assert.equal(receipt.decision, "PASS");
assert.equal(receipt.failure_code, null);
assert.equal(receipt.candidate_count, 1);
for (const key of [
  "target_staging_only", "initial_allow_list_empty", "runner_ipv4_32_only", "allow_list_readback_exact",
  "external_hostname_verified", "sslmode_verify_full", "dedicated_principal_verified",
  "transaction_read_only_verified", "r2_get_only", "reference_digest_match", "zero_mutable_inputs_verified",
  "cleanup_patch_empty", "cleanup_readback_empty"
]) assert.equal(receipt.controls[key], true, key);
assert.equal(receipt.controls.secret_values_exposed, false);
assert.equal(receipt.controls.production_access_attempted, false);

assert.deepEqual(Object.keys(receipt.selection).sort(), [
  "job_id", "prior_effect_count", "reversible_hold_count", "terminal_ledger_count", "user_id"
].sort());
assert.match(receipt.selection.job_id, /^[0-9a-f-]{20,}$/);
assert.match(receipt.selection.user_id, /^[0-9a-f-]{20,}$/);
assert.equal(receipt.selection.reversible_hold_count, 1);
assert.equal(receipt.selection.terminal_ledger_count, 0);
assert.equal(receipt.selection.prior_effect_count, 0);

assert.deepEqual(Object.keys(receipt.manifest).sort(), [
  "product_id", "product_snapshot_id_or_sha", "reference_asset_id", "reference_authorization_receipt",
  "reference_digest_sha256", "reference_storage_object_id", "subject_id"
].sort());
assert.match(receipt.manifest.product_id, /^[0-9a-f-]{20,}$/);
assert.match(receipt.manifest.product_snapshot_id_or_sha, /^sha256:[0-9a-f]{64}$/);
assert.equal(typeof receipt.manifest.subject_id, "string");
assert.equal(typeof receipt.manifest.reference_asset_id, "string");
assert.match(receipt.manifest.reference_digest_sha256, /^[0-9a-f]{64}$/);
assert.equal(receipt.manifest.reference_storage_object_id, path.posix.join(
  "jobs", receipt.selection.job_id, "approved-references",
  `0-${receipt.manifest.reference_digest_sha256}${path.posix.extname(receipt.manifest.reference_asset_id)}`
));
assert.deepEqual(Object.keys(receipt.manifest.reference_authorization_receipt).sort(), [
  "label_ocr_status", "label_ocr_version", "manifest_sha256", "manifest_version",
  "primary_index", "proof_version", "type"
].sort());
assert.equal(receipt.manifest.reference_authorization_receipt.type, "approved_reference_manifest:v2");
assert.match(receipt.manifest.reference_authorization_receipt.manifest_sha256, /^[0-9a-f]{64}$/);
assert.equal(receipt.manifest.reference_authorization_receipt.manifest_version, 2);
assert.equal(receipt.manifest.reference_authorization_receipt.primary_index, 0);
assert.ok(Number.isInteger(receipt.manifest.reference_authorization_receipt.proof_version));
assert.ok(receipt.manifest.reference_authorization_receipt.proof_version > 0);
assert.equal(receipt.manifest.reference_authorization_receipt.label_ocr_status, "READABLE");
assert.equal(receipt.manifest.reference_authorization_receipt.label_ocr_version, 1);

assert.deepEqual(receipt.lane_effects, {
  database_writes: 0, r2_writes: 0, provider_posts: 0, provider_spend_usd: 0,
  publication: false, production_mutations: 0
});
assert.equal(cleanup.target_verified, true);
assert.equal(cleanup.cleanup_patch_empty, true);
assert.equal(cleanup.cleanup_readback_empty, true);
assert.equal(cleanup.secret_values_exposed, false);
assert.equal(cleanup.ip_value_exposed, false);
assert.equal(cleanup.production_access_attempted, false);

const allBytes = Buffer.concat([receiptBytes, cleanupBytes]);
for (const pattern of [/(?:postgres|postgresql):\/\//i, /Bearer\s+/i, /secret[_-]?access[_-]?key/i, /password/i]) {
  assert.equal(pattern.test(allBytes.toString("utf8")), false, `secret-bearing pattern: ${pattern}`);
}
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema: "normal-representative-metadata-receipts/v1",
  files: [
    { name: "metadata-receipt.json", sha256: sha(receiptBytes), size: receiptBytes.length },
    { name: "secondary-cleanup.json", sha256: sha(cleanupBytes), size: cleanupBytes.length }
  ]
};
fs.writeFileSync(path.join(dir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ verified: true, files: manifest.files.length }));
