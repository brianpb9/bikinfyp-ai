#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [rootArg, expectedAppSha, expectedRunnerSha] = process.argv.slice(2);
if (!rootArg || !/^[0-9a-f]{40}$/.test(expectedAppSha ?? "") || !/^[0-9a-f]{40}$/.test(expectedRunnerSha ?? "")) {
  throw new Error("usage: verify-mobile-evidence-receipt.mjs RECEIPT_ROOT EXPECTED_APP_SHA EXPECTED_RUNNER_SHA");
}
const root = fs.realpathSync(rootArg);
const rootEntries = fs.readdirSync(root, { withFileTypes: true });
assert.equal(rootEntries.length, 1, "receipt root must contain exactly one run directory and no files");
assert.equal(rootEntries[0].isDirectory(), true, "receipt root entry must be a real directory");
assert.equal(rootEntries[0].isSymbolicLink(), false, "receipt run directory cannot be a symlink");
assert.match(rootEntries[0].name, /^[0-9a-f]{64}$/, "receipt run directory must be the container id");
const runDir = fs.realpathSync(path.join(root, rootEntries[0].name));
assert.ok(runDir.startsWith(`${root}${path.sep}`), "receipt directory escaped export root");

const runEntries = fs.readdirSync(runDir, { withFileTypes: true });
for (const entry of runEntries) {
  assert.equal(entry.isSymbolicLink(), false, `symlink is forbidden in receipt bundle: ${entry.name}`);
  assert.equal(entry.isFile(), true, `non-file is forbidden in receipt bundle: ${entry.name}`);
}

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8"));
const receipt = readJson("receipt.json");
const manifestBytes = fs.readFileSync(path.join(runDir, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const launch = readJson("launch-attestation.json");
assert.equal(receipt.schema, "managed-mobile-auth-hydration/v1");
assert.equal(receipt.exact_sha, expectedAppSha);
assert.equal(receipt.result, "PASS");
assert.equal(receipt.runtime?.build_sha, expectedAppSha);
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
assert.equal(launch.source_sha, expectedRunnerSha);
assert.equal(path.basename(runDir), launch.container_id);
assert.equal(receipt.evidence_runner?.launch?.container_id, launch.container_id);
assert.equal(receipt.evidence_runner?.launch?.image_id, launch.image_id);
assert.equal(receipt.evidence_runner?.launch?.source_sha, expectedRunnerSha);
assert.equal(receipt.evidence_runner?.launch?.source_tree, launch.source_tree);
assert.equal(receipt.evidence_runner?.source?.commit, expectedRunnerSha);
assert.equal(manifest.schema, "managed-mobile-auth-hydration-manifest/v1");
assert.equal(manifest.exact_sha, expectedAppSha);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const screenshotNames = [];
const receiptScreenshotKeys = new Set();
for (const screenshot of receipt.screenshots ?? []) {
  const name = path.basename(screenshot.name ?? "");
  assert.equal(name, screenshot.name, "unsafe screenshot name");
  assert.ok(!screenshotNames.includes(name), `duplicate screenshot name: ${name}`);
  assert.equal(typeof screenshot.private_key, "string");
  assert.equal(receiptScreenshotKeys.has(screenshot.private_key), false, `duplicate screenshot key: ${screenshot.private_key}`);
  screenshotNames.push(name);
  receiptScreenshotKeys.add(screenshot.private_key);
  const bytes = fs.readFileSync(path.join(runDir, name));
  assert.equal(bytes.length, screenshot.bytes);
  assert.equal(sha256(bytes), screenshot.sha256);
}
assert.equal(receipt.screenshots?.length, 6, "six bounded mobile screenshots are required");

const expectedFiles = ["launch-attestation.json", "manifest.json", "receipt.json", ...screenshotNames].sort();
assert.deepEqual(runEntries.map((entry) => entry.name).sort(), expectedFiles, "receipt bundle has missing or unexpected files");
assert.equal(sha256(manifestBytes), receipt.artifact_verification?.manifest_sha256, "local manifest hash mismatch");
assert.equal(receipt.artifact_verification?.manifest_key, receipt.artifact_manifest?.manifest_key);

const manifestArtifacts = manifest.artifacts;
assert.equal(Array.isArray(manifestArtifacts), true, "manifest artifacts must be an array");
assert.equal(manifestArtifacts.length, 7, "manifest must cover six screenshots and one draft receipt");
const manifestKeys = new Set(manifestArtifacts.map((item) => item.key));
assert.equal(manifestKeys.size, manifestArtifacts.length, "manifest artifact keys must be unique");
const manifestScreenshots = manifestArtifacts.filter((item) => item.content_type === "image/png");
assert.equal(manifestScreenshots.length, 6);
assert.deepEqual(new Set(manifestScreenshots.map((item) => item.key)), receiptScreenshotKeys,
  "receipt and manifest screenshot coverage must be reciprocal");
for (const screenshot of receipt.screenshots) {
  const item = manifestScreenshots.find((candidate) => candidate.key === screenshot.private_key);
  assert.ok(item, `screenshot absent from manifest: ${screenshot.name}`);
  assert.equal(item.sha256, screenshot.sha256);
  assert.equal(item.bytes, screenshot.bytes);
}
const draftArtifacts = manifestArtifacts.filter((item) => item.content_type === "application/json");
assert.equal(draftArtifacts.length, 1, "manifest must contain exactly one draft receipt");
const draft = draftArtifacts[0];
assert.equal(draft.key, receipt.artifact_verification?.draft_receipt_key);
assert.equal(draft.key, receipt.artifact_manifest?.receipt_key);
assert.equal(draft.sha256, receipt.artifact_verification?.draft_receipt_sha256);
assert.match(draft.sha256, /^[0-9a-f]{64}$/);
assert.ok(Number.isSafeInteger(draft.bytes) && draft.bytes > 0, "draft receipt size must be a positive integer");

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

// The verifier runs in the same managed-secret injection step as the runner.
// Compare every allowlisted upload byte against every exact injected value so
// a credential hidden under an innocuous JSON key (or in an image) still
// fails closed without printing the value.
const managedSecretSlots = ["DATABASE_URL", "AUTH_SECRET", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
for (const slot of managedSecretSlots) assert.ok(process.env[slot], `managed secret slot absent during sanitization: ${slot}`);
for (const entry of runEntries) {
  const bytes = fs.readFileSync(path.join(runDir, entry.name));
  for (const slot of managedSecretSlots) {
    assert.equal(bytes.includes(Buffer.from(process.env[slot])), false, `managed secret value found in upload file: ${entry.name}`);
  }
}
console.log(JSON.stringify({
  schema: "managed-mobile-receipt-verification/v1",
  app_sha: expectedAppSha,
  runner_sha: expectedRunnerSha,
  result: "PASS",
  screenshots: receipt.screenshots.length,
  secrets_persisted: false,
  payments_live: false,
  provider_calls: 0,
}));
