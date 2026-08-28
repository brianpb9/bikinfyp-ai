#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [rootArg, expectedSha] = process.argv.slice(2);
if (!rootArg || !/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  throw new Error("usage: verify-mobile-evidence-receipt.mjs RECEIPT_ROOT EXPECTED_SHA");
}
const root = fs.realpathSync(rootArg);
const runDirs = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => path.join(root, entry.name));
assert.equal(runDirs.length, 1, "exactly one immutable receipt run directory is required");
const runDir = fs.realpathSync(runDirs[0]);
assert.ok(runDir.startsWith(`${root}${path.sep}`), "receipt directory escaped export root");

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8"));
const receipt = readJson("receipt.json");
const manifest = readJson("manifest.json");
const launch = readJson("launch-attestation.json");
assert.equal(receipt.schema, "managed-mobile-auth-hydration/v1");
assert.equal(receipt.exact_sha, expectedSha);
assert.equal(receipt.result, "PASS");
assert.equal(receipt.runtime?.build_sha, expectedSha);
assert.equal(receipt.runtime?.payments_live, false);
assert.equal(receipt.otp_provider_calls, 0);
assert.equal(receipt.payment_generation_calls, 0);
assert.deepEqual(receipt.console_errors, []);
assert.deepEqual(receipt.page_errors, []);
assert.deepEqual(receipt.cleanup_errors, []);
assert.ok(Object.values(receipt.cleanup ?? {}).every((value) => value === true), "cleanup is not fully true");
assert.equal(receipt.artifact_verification?.verified, true);
assert.equal(receipt.review_status, "PENDING_INDEPENDENT_REVIEW");
assert.equal(receipt.points_claimed, 0);
assert.equal(launch.schema, "mobile-evidence-launch/v1");
assert.equal(launch.source_sha, expectedSha);
assert.equal(receipt.evidence_runner?.launch?.container_id, launch.container_id);
assert.equal(receipt.evidence_runner?.launch?.image_id, launch.image_id);
assert.equal(receipt.evidence_runner?.source?.commit, expectedSha);
assert.equal(manifest.schema, "managed-mobile-auth-hydration-manifest/v1");
assert.equal(manifest.exact_sha, expectedSha);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
for (const screenshot of receipt.screenshots ?? []) {
  const name = path.basename(screenshot.name ?? "");
  assert.equal(name, screenshot.name, "unsafe screenshot name");
  const bytes = fs.readFileSync(path.join(runDir, name));
  assert.equal(bytes.length, screenshot.bytes);
  assert.equal(sha256(bytes), screenshot.sha256);
}
assert.equal(receipt.screenshots?.length, 6, "six bounded mobile screenshots are required");

// Reject secret-bearing names and recognizable credential/connection values
// before the directory can be uploaded as a managed artifact.
const serialized = JSON.stringify({ receipt, manifest, launch });
assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
assert.doesNotMatch(serialized, /(?:DATABASE_URL|AUTH_SECRET|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID)/);
assert.doesNotMatch(serialized, /managed-mobile-[^"\\\s]+@staging\.invalid/i);
const forbiddenKeys = /^(?:password|secret|token|authorization|database_url|r2_access_key_id|r2_secret_access_key)$/i;
const inspect = (value) => {
  if (Array.isArray(value)) return value.forEach(inspect);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, forbiddenKeys, `forbidden receipt key: ${key}`);
    inspect(child);
  }
};
inspect({ receipt, manifest, launch });
console.log(JSON.stringify({
  schema: "managed-mobile-receipt-verification/v1",
  exact_sha: expectedSha,
  result: "PASS",
  screenshots: receipt.screenshots.length,
  secrets_persisted: false,
  payments_live: false,
  provider_calls: 0,
}));
