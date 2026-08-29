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
const clone = (value) => structuredClone(value);
const exactKeys = (value, keys, label) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), label);

const bundle = {
  run: json("GITHUB-RUN.json"),
  artifact: json("GITHUB-ARTIFACT.json"),
  receipt: json("METADATA-RECEIPT.json"),
  cleanup: json("SECONDARY-CLEANUP.json"),
  renderReadback: json("RENDER-ALLOWLIST-READBACK.json"),
  validation: json("VALIDATION.json"),
  control: json("CONTROL-PLANE.json"),
  archive: Buffer.from(read("ARTIFACT.zip.base64").toString("ascii").trim(), "base64"),
};

const expected = {
  run: bundle.run,
  artifact: bundle.artifact,
  receipt: bundle.receipt,
  cleanup: bundle.cleanup,
  renderReadback: bundle.renderReadback,
  validation: bundle.validation,
  control: bundle.control,
};

function archiveEntries(bytes) {
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  assert.notEqual(eocd, -1, "ZIP end-of-central-directory missing");
  const count = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const entries = {};
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50, "ZIP central entry missing");
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(method, 0, "only stored artifact entries are accepted");
    assert.equal(compressedSize, uncompressedSize, "stored entry size mismatch");
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50, "ZIP local entry missing");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries[name] = bytes.subarray(dataOffset, dataOffset + compressedSize);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.deepEqual(Object.keys(entries).sort(), ["metadata-receipt.json", "secondary-cleanup.json"]);
  return entries;
}

function verify(candidate) {
  for (const key of ["run", "artifact", "receipt", "cleanup", "renderReadback", "validation", "control"])
    assert.deepEqual(candidate[key], expected[key], `${key} exact contract`);

  exactKeys(candidate.run, ["source", "id", "name", "head_branch", "head_sha", "path", "run_number", "run_attempt", "event", "status", "conclusion", "created_at", "updated_at", "run_started_at"], "run keys");
  assert.equal(candidate.run.source, "GET /repos/brianpb9/bikinfyp-ai/actions/runs/33264551551");
  assert.equal(candidate.run.id, 33264551551);
  assert.equal(candidate.run.name, "Managed mobile staging evidence");
  assert.equal(candidate.run.head_branch, "main");
  assert.equal(candidate.run.path, ".github/workflows/managed-mobile-evidence.yml");
  assert.equal(candidate.run.run_number, 25);
  assert.equal(candidate.run.run_attempt, 1);
  assert.equal(candidate.run.event, "workflow_dispatch");
  assert.equal(candidate.run.status, "completed");
  assert.equal(candidate.run.conclusion, "failure");
  assert.equal(candidate.run.head_sha, candidate.receipt.binding.control_sha);
  exactKeys(candidate.artifact, ["source", "total_count", "artifact"], "artifact envelope keys");
  exactKeys(candidate.artifact.artifact, ["id", "name", "size_in_bytes", "expired", "digest", "created_at", "updated_at", "expires_at", "workflow_run", "files"], "artifact keys");
  assert.equal(candidate.artifact.source, "GET /repos/brianpb9/bikinfyp-ai/actions/runs/33264551551/artifacts");
  assert.equal(candidate.artifact.total_count, 1);
  assert.equal(candidate.artifact.artifact.id, 9718242465);
  assert.equal(candidate.artifact.artifact.name, "normal-representative-metadata-33264551551-1");
  assert.equal(candidate.artifact.artifact.expired, false);
  assert.equal(candidate.artifact.artifact.workflow_run.id, candidate.run.id);
  assert.equal(candidate.artifact.artifact.workflow_run.head_sha, candidate.run.head_sha);
  assert.equal(candidate.artifact.artifact.digest, `sha256:${sha256(candidate.archive)}`);
  assert.equal(candidate.archive.length, candidate.artifact.artifact.size_in_bytes);

  const entries = archiveEntries(candidate.archive);
  const fileBindings = new Map(candidate.artifact.artifact.files.map((file) => [file.artifact_name, file]));
  assert.deepEqual([...fileBindings.keys()].sort(), Object.keys(entries).sort());
  for (const [artifactName, bytes] of Object.entries(entries)) {
    const binding = fileBindings.get(artifactName);
    const committed = read(binding.committed_name);
    assert.equal(bytes.length, binding.size_in_bytes);
    assert.equal(sha256(bytes), binding.sha256);
    assert.deepEqual(bytes, committed);
  }

  exactKeys(candidate.receipt, ["schema", "task", "started_at", "finished_at", "decision", "failure_code", "candidate_count", "binding", "controls", "selection", "manifest", "lane_effects"], "receipt keys");
  assert.equal(candidate.receipt.schema, "normal-representative-metadata-acquisition/v1");
  assert.equal(candidate.receipt.task, "NORMAL-REPRESENTATIVE-METADATA-ACQUISITION-20260829");
  assert.equal(candidate.receipt.decision, "FAIL_CLOSED");
  assert.equal(candidate.receipt.failure_code, "CANONICAL_CANDIDATE_COUNT_NOT_ONE");
  assert.equal(candidate.receipt.candidate_count, 0);
  assert.equal(candidate.receipt.binding.app_sha, "ee767201679ae2213c40be6f913241f372d2378a");
  assert.equal(candidate.receipt.selection, null);
  assert.equal(candidate.receipt.manifest, null);
  assert.deepEqual(candidate.receipt.controls, {
    target_staging_only: true, initial_allow_list_empty: true, runner_ipv4_32_only: true,
    allow_list_readback_exact: true, external_hostname_verified: false, sslmode_verify_full: false,
    dedicated_principal_verified: false, transaction_read_only_verified: false, r2_get_only: false,
    reference_digest_match: false, zero_mutable_inputs_verified: false,
    prior_evidence_registry_checked: false, window_owner_marker_created: true,
    cleanup_patch_empty: true, cleanup_skipped_already_empty: false, cleanup_readback_empty: true,
    foreign_allow_list_preserved: false, secret_values_exposed: false,
    production_access_attempted: false
  });
  assert.deepEqual(candidate.receipt.lane_effects, {
    database_writes: 0, r2_writes: 0, provider_posts: 0, provider_spend_usd: 0,
    publication: false, production_mutations: 0
  });
  exactKeys(candidate.cleanup, ["target_verified", "ownership_verified", "cleanup_patch_empty", "cleanup_skipped_already_empty", "cleanup_readback_empty", "foreign_allow_list_preserved", "secret_values_exposed", "ip_value_exposed", "production_access_attempted"], "secondary cleanup keys");
  assert.deepEqual(candidate.cleanup, {
    target_verified: true, ownership_verified: true, cleanup_patch_empty: false,
    cleanup_skipped_already_empty: true, cleanup_readback_empty: true,
    foreign_allow_list_preserved: false, secret_values_exposed: false,
    ip_value_exposed: false, production_access_attempted: false
  });
  exactKeys(candidate.renderReadback, ["captured_at", "source", "command", "mutation", "response"], "Render readback keys");
  assert.equal(candidate.renderReadback.source, "Render CLI v2.24.0 authenticated control-plane read");
  assert.deepEqual(candidate.renderReadback.response, [{ id: "dpg-d9n21fnlk1mc73djm8q0-a", ipAllowList: [] }]);
  assert.equal(candidate.renderReadback.mutation, false);
  exactKeys(candidate.control, ["captured_at", "github", "staging_postgres", "production"], "control-plane keys");
  exactKeys(candidate.control.github, ["run_id", "job_id", "event", "workflow", "run_status", "run_conclusion", "head_sha", "artifact_id", "artifact_name", "artifact_digest", "receipt_artifact_uploaded", "cleanup_step_conclusion"], "control GitHub keys");
  assert.equal(candidate.control.github.run_id, candidate.run.id);
  assert.equal(candidate.control.github.job_id, 99132193362);
  assert.equal(candidate.control.github.head_sha, candidate.run.head_sha);
  assert.equal(candidate.control.github.cleanup_step_conclusion, "success");
  exactKeys(candidate.control.staging_postgres, ["id", "post_run_allow_list"], "control staging keys");
  assert.equal(candidate.control.staging_postgres.id, "dpg-d9n21fnlk1mc73djm8q0-a");
  assert.deepEqual(candidate.control.staging_postgres.post_run_allow_list, []);
  assert.equal(candidate.control.github.artifact_digest, candidate.artifact.artifact.digest);
  assert.deepEqual(candidate.control.production, {
    web: { id: "srv-d9nhccfqj5pc73et9hrg", auto_deploy: "no", status: "live", sha: "ec734b186307fe3a4c79cf6632f8f5e75f8634ae" },
    worker: { id: "srv-d9ni3ndaeets73c07kq0", auto_deploy: "no", status: "live", sha: "ec734b186307fe3a4c79cf6632f8f5e75f8634ae" }
  });
  exactKeys(candidate.validation, ["task", "status", "metadata_acquired", "blocker", "candidate_count", "actions_run_provenance_preserved", "actions_artifact_digest_preserved", "artifact_receipt_bytes_verified", "no_candidate_created", "allow_list_empty_after_primary_cleanup", "allow_list_empty_after_secondary_cleanup", "allow_list_empty_independent_render_readback", "database_writes", "r2_writes", "provider_posts", "provider_spend_usd", "publication", "production_mutations", "secret_safe"], "validation keys");
  assert.deepEqual(candidate.validation, {
    task: "NORMAL-REPRESENTATIVE-METADATA-ACQUISITION-20260829",
    status: "IDLE_COMPLETE_LANE_C", metadata_acquired: false,
    blocker: "NO_CANONICAL_APPROVED_UNFINISHED_STAGING_CANDIDATE", candidate_count: 0,
    actions_run_provenance_preserved: true, actions_artifact_digest_preserved: true,
    artifact_receipt_bytes_verified: true, no_candidate_created: true,
    allow_list_empty_after_primary_cleanup: true, allow_list_empty_after_secondary_cleanup: true,
    allow_list_empty_independent_render_readback: true, database_writes: 0, r2_writes: 0,
    provider_posts: 0, provider_spend_usd: 0, publication: false, production_mutations: 0,
    secret_safe: true
  });
}

verify(bundle);
const tamperCases = [
  (v) => { v.run.head_sha = "0".repeat(40); },
  (v) => { v.artifact.artifact.digest = `sha256:${"0".repeat(64)}`; },
  (v) => { v.archive[100] ^= 1; },
  (v) => { v.receipt.controls.target_staging_only = false; },
  (v) => { v.receipt.lane_effects.database_writes = 1; },
  (v) => { v.cleanup.target_verified = false; },
  (v) => { v.renderReadback.response[0].ipAllowList = [{ cidrBlock: "redacted" }]; },
  (v) => { v.validation.database_writes = 1; },
  (v) => { v.control.staging_postgres.id = "wrong-target"; },
];
for (const tamper of tamperCases) {
  const candidate = clone(bundle);
  tamper(candidate);
  assert.throws(() => verify(candidate));
}

const manifest = read("MANIFEST.sha256").toString("utf8").trim().split("\n");
for (const line of manifest) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  assert.ok(match, `invalid manifest line: ${line}`);
  assert.equal(sha256(read(match[2])), match[1], match[2]);
}

console.log("zero-candidate evidence and tamper suite: PASS");
