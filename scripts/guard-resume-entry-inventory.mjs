#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = [
  "enqueueJob",
  "enqueueJobResume",
  "enqueueRedisJob",
  "enqueueInlineJob",
  "processJob",
  "processPostgresJob",
  "directRedisRenderWake",
];

const EXECUTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const EXPECTED_CALLS = {
  enqueueJob: {
    "app/api/jobs/route.ts": 2,
    "lib/dashboard/render-cell.ts": 1,
  },
  enqueueJobResume: {
    "app/api/dashboard/campaign/job/[jobId]/route.ts": 2,
  },
  enqueueRedisJob: {
    "lib/job-queue.ts": 1,
    "scripts/verify-postgres-redis-worker.ts": 2,
    "scripts/verify-redis-queue.ts": 2,
    "scripts/verify-redis-worker.ts": 1,
  },
  enqueueInlineJob: { "lib/job-queue.ts": 2 },
  processJob: { "lib/worker.ts": 1, "scripts/worker.ts": 1 },
  processPostgresJob: { "scripts/worker.ts": 1 },
  directRedisRenderWake: { "lib/job-queue.ts": 2 },
};

// Dependency-free lexical mask: comments and literals become spaces while
// offsets/newlines stay stable. It is deliberately small, but sufficient for
// finding real identifier calls without counting imports, comments, or SQL.
export function maskNonCode(source) {
  const chars = [...source];
  let state = "code";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") { chars[i] = chars[i + 1] = " "; i++; state = "line"; }
      else if (ch === "/" && next === "*") { chars[i] = chars[i + 1] = " "; i++; state = "block"; }
      else if (ch === "'") { chars[i] = " "; state = "single"; }
      else if (ch === '"') { chars[i] = " "; state = "double"; }
      else if (ch === "`") { chars[i] = " "; state = "template"; }
    } else if (state === "line") {
      if (ch === "\n") state = "code"; else chars[i] = " ";
    } else if (state === "block") {
      if (ch === "*" && next === "/") { chars[i] = chars[i + 1] = " "; i++; state = "code"; }
      else if (ch !== "\n") chars[i] = " ";
    } else {
      if (ch === "\\") {
        chars[i] = " ";
        if (i + 1 < chars.length && chars[i + 1] !== "\n") chars[++i] = " ";
      } else if ((state === "single" && ch === "'") || (state === "double" && ch === '"') || (state === "template" && ch === "`")) {
        chars[i] = " "; state = "code";
      } else if (ch !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

function productionFiles(root) {
  const result = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (EXECUTABLE_EXTENSIONS.has(path.extname(entry.name))) result.push(child);
    }
  };
  walk("app");
  walk("lib");
  walk("scripts");
  return result.sort();
}

function importedAliases(code, target) {
  const names = new Set([target]);
  for (const match of code.matchAll(/\bimport\s*\{([^}]+)\}\s*from\b/g)) {
    for (const item of match[1].split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      if (parts[0]?.trim() === target) names.add((parts[1] ?? parts[0]).trim());
    }
  }
  // Local aliases are also executable indirection and must remain visible.
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) {
      if (names.has(match[2]) && !names.has(match[1])) { names.add(match[1]); changed = true; }
    }
  }
  return names;
}

export function deriveCallInventory(root) {
  const inventory = Object.fromEntries(TARGETS.map((name) => [name, {}]));
  for (const rel of productionFiles(root)) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    const code = maskNonCode(source);
    for (const name of TARGETS.filter((candidate) => candidate !== "directRedisRenderWake")) {
      for (const callable of importedAliases(code, name)) {
        const pattern = new RegExp(`\\b${callable}\\s*\\(`, "g");
        for (const match of code.matchAll(pattern)) {
          const before = code.slice(Math.max(0, match.index - 80), match.index);
          if (new RegExp(`\\bfunction\\s+$`).test(before)) continue;
          inventory[name][rel] = (inventory[name][rel] ?? 0) + 1;
        }
      }
    }
    // A caller bypassing job-queue via Queue.add is a worker wake even if it
    // never imports one of our named helpers. Keep string contents here so the
    // render queue operation is classified, while comments remain masked.
    const commentsMasked = source.replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (value) => " ".repeat(value.length));
    const direct = commentsMasked.match(/\.add\s*\(\s*["']render["']\s*,\s*\{\s*jobId\b/g)?.length ?? 0;
    if (direct) inventory.directRedisRenderWake[rel] = direct;
  }
  return inventory;
}

export function assertExactCallInventory(inventory) {
  assert.deepEqual(inventory, EXPECTED_CALLS,
    "resume/worker wake call-site inventory changed; classify and prove every new production entry before updating the allowlist");
}

export function assertA6ResumeSafety(source) {
  const code = maskNonCode(source);
  const calls = [...code.matchAll(/\benqueueJobResume\s*\(/g)].map((match) => match.index);
  assert.equal(calls.length, 2, "A6 must have exactly approve + regenerate resume calls");
  const productValidation = code.indexOf("parseJobProductSnapshot(job.job_product_snapshot");
  const referenceValidation = code.indexOf("materializeJobReferenceManifest(manifest");
  assert.ok(productValidation >= 0 && referenceValidation >= 0, "A6 must validate both durable snapshots");
  const braceRanges = [];
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") stack.push(i);
    else if (code[i] === "}" && stack.length) braceRanges.push({ start: stack.pop(), end: i });
  }
  const common = braceRanges
    .filter((range) => range.start < productValidation && range.start < referenceValidation
      && range.end > productValidation && range.end > referenceValidation)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  assert.ok(common, "A6 durable validations must share a fail-closed block");
  const commonHeader = code.slice(Math.max(0, common.start - 40), common.start);
  assert.match(commonHeader, /\btry\s*$/, "both A6 validations must be unconditional in the same try block");
  const afterGuard = code.slice(common.end, common.end + 500);
  assert.match(afterGuard, /^\s*}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?throw\s+ERR\.BAD_REQUEST/,
    "A6 validation block must fail closed through BAD_REQUEST");
  for (const call of calls) {
    assert.ok(call > productValidation && call > referenceValidation,
      "A6 approve/regenerate enqueue must occur after both durable snapshot validations");
  }
  assert.doesNotMatch(source, /\b(?:createJobProductSnapshotRaw|loadOrCreateJobProductSnapshot|loadOrCreateJobReferenceManifest)\b/,
    "A6 resume route must not rebuild a durable snapshot from mutable product data");
  assert.doesNotMatch(source, /SET\s+(?:approved_reference_manifest|job_product_snapshot)\s*=/i,
    "A6 resume route must not overwrite either durable snapshot");
}

function assertForwardingAndWorkerLoads(root) {
  const queue = fs.readFileSync(path.join(root, "lib/job-queue.ts"), "utf8");
  const queueCode = maskNonCode(queue);
  const start = queueCode.indexOf("function enqueueJobResume");
  const end = queueCode.indexOf("function closeRedisJobQueue", start);
  assert.ok(start >= 0 && end > start, "enqueueJobResume body not found");
  const resume = queue.slice(start, end);
  assert.equal((maskNonCode(resume).match(/\benqueueInlineJob\s*\(/g) ?? []).length, 1,
    "inline resume must forward to the canonical inline wake path exactly once");
  assert.equal((resume.match(/\.add\("render",\s*\{\s*jobId\s*\}/g) ?? []).length, 1,
    "Redis resume must forward only the durable job id exactly once");
  assert.doesNotMatch(resume, /approved_reference_manifest|job_product_snapshot|FROM\s+products|createJobProductSnapshotRaw|loadOrCreateJob/i,
    "queue wake path must not carry or reconstruct mutable snapshot data");

  const sqlite = fs.readFileSync(path.join(root, "lib/worker.ts"), "utf8");
  assert.match(sqlite, /loadOrCreateJobProductSnapshot\(\{[\s\S]{0,220}existingRaw:\s*job\.job_product_snapshot/,
    "W2 must adopt the durable job product snapshot");
  assert.match(sqlite, /loadOrCreateJobReferenceManifest\(\{[\s\S]{0,180}existingRaw:\s*job\.approved_reference_manifest/,
    "W2 must adopt the durable reference manifest");
  const postgres = fs.readFileSync(path.join(root, "lib/postgres/worker.ts"), "utf8");
  assert.match(postgres, /loadOrCreateJobProductSnapshot\(\{[\s\S]{0,180}existingRaw:\s*row\.job_product_snapshot/,
    "W1 must adopt the durable job product snapshot");
  assert.match(postgres, /loadOrCreateJobReferenceManifest\(\{[\s\S]{0,180}existingRaw:\s*row\.approved_reference_manifest/,
    "W1 must adopt the durable reference manifest");
}

export function auditResumeEntryInventory(root = process.cwd()) {
  const inventory = deriveCallInventory(root);
  assertExactCallInventory(inventory);
  const route = fs.readFileSync(path.join(root, "app/api/dashboard/campaign/job/[jobId]/route.ts"), "utf8");
  assertA6ResumeSafety(route);
  assertForwardingAndWorkerLoads(root);
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = auditResumeEntryInventory();
  console.log(JSON.stringify({ status: "PASS", inventory }, null, 2));
}
