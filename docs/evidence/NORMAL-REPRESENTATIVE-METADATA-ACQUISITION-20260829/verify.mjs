#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name));
const json = (name) => JSON.parse(read(name));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const run = json("GITHUB-RUN.json");
const artifact = json("GITHUB-ARTIFACT.json");
const receipt = json("METADATA-RECEIPT.json");
const cleanup = json("SECONDARY-CLEANUP.json");
const renderReadback = json("RENDER-ALLOWLIST-READBACK.json");
const validation = json("VALIDATION.json");

assert.equal(run.id, 33264551551);
assert.equal(run.head_sha, "503a8bfbf47d7873dbf07d40ce29ad40390b57d0");
assert.equal(run.event, "workflow_dispatch");
assert.equal(run.status, "completed");
assert.equal(run.conclusion, "failure");
assert.equal(artifact.total_count, 1);
assert.equal(artifact.artifact.id, 9718242465);
assert.equal(artifact.artifact.name, "normal-representative-metadata-33264551551-1");
assert.equal(artifact.artifact.workflow_run.id, run.id);
assert.equal(artifact.artifact.workflow_run.head_sha, run.head_sha);
assert.match(artifact.artifact.digest, /^sha256:[0-9a-f]{64}$/);

for (const file of artifact.artifact.files) {
  const bytes = read(file.committed_name);
  assert.equal(bytes.length, file.size_in_bytes);
  assert.equal(sha256(bytes), file.sha256);
}

assert.equal(receipt.decision, "FAIL_CLOSED");
assert.equal(receipt.failure_code, "CANONICAL_CANDIDATE_COUNT_NOT_ONE");
assert.equal(receipt.candidate_count, 0);
assert.equal(receipt.binding.control_sha, run.head_sha);
assert.equal(receipt.binding.app_sha, "ee767201679ae2213c40be6f913241f372d2378a");
assert.equal(receipt.selection, null);
assert.equal(receipt.manifest, null);
assert.equal(receipt.controls.cleanup_readback_empty, true);
assert.equal(cleanup.ownership_verified, true);
assert.equal(cleanup.cleanup_skipped_already_empty, true);
assert.equal(cleanup.cleanup_readback_empty, true);
assert.deepEqual(renderReadback.response, [{ id: "dpg-d9n21fnlk1mc73djm8q0-a", ipAllowList: [] }]);
assert.equal(renderReadback.mutation, false);
assert.equal(validation.status, "IDLE_COMPLETE_LANE_C");
assert.equal(validation.blocker, "NO_CANONICAL_APPROVED_UNFINISHED_STAGING_CANDIDATE");
assert.equal(validation.candidate_count, 0);
for (const value of Object.values(receipt.lane_effects)) assert.ok(value === 0 || value === false);

const manifest = read("MANIFEST.sha256").toString("utf8").trim().split("\n");
for (const line of manifest) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  assert.ok(match, `invalid manifest line: ${line}`);
  assert.equal(sha256(read(match[2])), match[1], match[2]);
}

console.log("zero-candidate evidence: PASS");
