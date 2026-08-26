#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bundle = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(bundle, "../../..");
const score = JSON.parse(fs.readFileSync(path.join(bundle, "SCORE-RECEIPT.json"), "utf8"));
const bus = JSON.parse(fs.readFileSync(path.join(bundle, "BUS-SOURCE-MESSAGES.json"), "utf8"));
const board = fs.readFileSync(path.join(root, score.source_board), "utf8");
const fail = (message) => { throw new Error(message); };

const expectedDomains = [
  "Money safety", "Auth intent & failure path", "Mobile UI 375",
  "Hydration/interaction canary CI", "Content engine standard", "Brand fidelity",
  "Anti-slop produksi", "Prompt/verdict archive", "NSFW rejection", "Payments",
  "Legal/PDP", "DR/monitoring/incident owner", "Landing/pricing consistency",
];
if (score.rows.length !== 13) fail("score receipt must contain exactly 13 rows");
if (new Set(score.rows.map((row) => row.domain)).size !== 13) fail("duplicate score domain");
if (JSON.stringify(score.rows.map((row) => row.domain)) !== JSON.stringify(expectedDomains)) fail("row omitted, added, or reordered");
if (score.rows.some((row) => !Number.isInteger(row.score) || row.score < 0 || row.score > 10 || row.delta !== 0)) fail("invalid score/delta");
const receiptSum = score.rows.reduce((sum, row) => sum + row.score, 0);
if (receiptSum !== 77 || score.arithmetic.raw_sum !== receiptSum) fail("receipt sum mismatch");

const section = board.split("## 1. Papan skor segar")[1]?.split("## 2.")[0] || "";
const broad = [...section.matchAll(/^\| ([^|]+?) \| \d+ \| \*\*(\d+)\*\* \| (V|C|N|V\/C) \|/gm)];
const narrow = [...section.matchAll(/^\| ([^|]+?) \| \d+ \| \*\*(\d+)\*\* \| (V|C|N) \|/gm)];
const sum = (rows) => rows.reduce((total, match) => total + Number(match[2]), 0);
if (broad.length !== 13 || sum(broad) !== 77) fail("source board broad parser mismatch");
if (narrow.length !== 12 || sum(narrow) !== 70) fail("counterexample no longer demonstrates omitted V/C row");
if (Math.round(receiptSum / 130 * 100) !== 59) fail("normalized score mismatch");
if (Math.min(59, score.arithmetic.r2a_evidence_ceiling) !== 58 || score.arithmetic.canonical_reported_score !== 58) fail("ceiling arithmetic mismatch");

const requiredTasks = new Map([
  ["P1-MANAGED-STAGING-VALID-PRODUCT-TRACE-20260825", "30c9d2d12ddc4cc64036fb8992cd9ac355e410d6"],
  ["P1-MANAGED-STAGING-ORG-INGESTION-TRACE-20260825", "e0a553ddb3d4ce2a09a75797fe901e41edbc25dc"],
  ["P1-MANAGED-STAGING-RETAIL-E2-E4-TRACE-20260825", "2adfa3261f656631ae5c608baafa9e5c8a6ca444"],
  ["P1-MANAGED-STAGING-RETAIL-E3-E5-MUTATION-TRACE-20260825", "26df1e1e403091555c47a5a8882b378b8b20c48e"],
  ["P1-MANAGED-STAGING-ORG-E7-E9-MUTATION-TRACE-20260825", "fb18b2c9e570231a10f761a7a11b896a8201e66b"],
  ["P0-E2-CONTROLLED-STAGING-SOURCE-20260826", "633ce9c7b1f56d64c64d5646b4db76918cbb558a"],
  ["ONBOARDING-VIDEO-PROOF-20260826", "efe5524a9463ca37320bbc224e21cee60d7ffe63"],
  ["P0-AGENT-BUS-OWNER-ROUTING-20260826", "460ea44c32651f414a83c7489802a68f06b65dca"],
]);
if (bus.messages.length !== requiredTasks.size * 2) fail("bus message omitted or duplicated");
for (const [task, sha] of requiredTasks) {
  const messages = bus.messages.filter((message) => message.task === task);
  if (messages.length !== 2 || messages.filter((m) => m.type === "PASS").length !== 1 || messages.filter((m) => m.type === "DONE").length !== 1) fail(`PASS/DONE cardinality mismatch: ${task}`);
  if (messages.some((message) => message.sha !== sha)) fail(`SHA mismatch: ${task}`);
  for (const projected of messages) {
    const runtime = JSON.parse(fs.readFileSync(path.join(root, ".agent-bus/archive", `${projected.id}.json`), "utf8"));
    for (const field of bus.projection) {
      if (Object.hasOwn(projected, field) && projected[field] !== runtime[field]) fail(`runtime receipt mismatch ${projected.id}:${field}`);
    }
  }
}

for (const [task, sha] of requiredTasks) {
  let ancestor = true;
  try { execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, score.baseline], { stdio: "ignore" }); }
  catch { ancestor = false; }
  if (task === "ONBOARDING-VIDEO-PROOF-20260826" ? ancestor : !ancestor) fail(`unexpected ancestry: ${task}`);
}

const markdownFiles = [
  path.join(bundle, "README.md"),
  path.join(root, "docs/evidence/SHIP-READINESS-CANONICAL-20260826.md"),
];
let links = 0;
for (const file of markdownFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    links += 1;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) fail(`missing Markdown target: ${file} -> ${target}`);
  }
}

const scopedFiles = [
  ...markdownFiles,
  path.join(root, "docs/evidence/P0-03/PATH-CASE-MATRIX.md"),
  path.join(bundle, "SCORE-RECEIPT.json"),
  path.join(bundle, "BUS-SOURCE-MESSAGES.json"),
  path.join(bundle, "verify.mjs"),
];
const forbiddenSecret = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{16,})/i;
if (scopedFiles.some((file) => forbiddenSecret.test(fs.readFileSync(file, "utf8")))) fail("secret-like literal found in scoped files");

console.log(JSON.stringify({rows:13,sum:77,counterexample:{rows:12,sum:70},score:58,tasks:8,messages:16,markdown_links:links,secret_like_hits:0,pass:true}));
