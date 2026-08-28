#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bundle = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(bundle, "../../..");
const fail = (message) => { throw new Error(message); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const score = readJson(path.join(bundle, "SCORE-RECEIPT.json"));
const bus = readJson(path.join(bundle, "BUS-SOURCE-MESSAGES.json"));
const ancestry = readJson(path.join(bundle, "ANCESTRY.json"));
const board = fs.readFileSync(path.join(root, score.source_board), "utf8");

const expectedDomains = [
  "Money safety", "Auth intent & failure path", "Mobile UI 375",
  "Hydration/interaction canary CI", "Content engine standard", "Brand fidelity",
  "Anti-slop produksi", "Prompt/verdict archive", "NSFW rejection", "Payments",
  "Legal/PDP", "DR/monitoring/incident owner", "Landing/pricing consistency",
];
if (score.task !== "P1-POST-E2-CEILING-RECOMPUTE-20260826") fail("wrong task");
if (score.baseline !== ancestry.accepted_evidence_sha) fail("baseline/ancestry mismatch");
if (score.rows.length !== 13 || new Set(score.rows.map((row) => row.domain)).size !== 13) fail("score row omission/duplicate");
if (JSON.stringify(score.rows.map((row) => row.domain)) !== JSON.stringify(expectedDomains)) fail("score row order drift");
if (score.rows.some((row) => !Number.isInteger(row.score) || row.score < 0 || row.score > 10 || row.delta !== 0)) fail("invalid score or inflationary delta");
const receiptSum = score.rows.reduce((sum, row) => sum + row.score, 0);
if (receiptSum !== 77 || score.arithmetic.raw_sum !== 77 || score.arithmetic.row_count !== 13) fail("score arithmetic mismatch");

const section = board.split("## 1. Papan skor segar")[1]?.split("## 2.")[0] || "";
const broad = [...section.matchAll(/^\| ([^|]+?) \| \d+ \| \*\*(\d+)\*\* \| (V|C|N|V\/C) \|/gm)];
const narrow = [...section.matchAll(/^\| ([^|]+?) \| \d+ \| \*\*(\d+)\*\* \| (V|C|N) \|/gm)];
const sum = (rows) => rows.reduce((total, match) => total + Number(match[2]), 0);
if (broad.length !== 13 || sum(broad) !== 77) fail("source board parser mismatch");
if (narrow.length !== 12 || sum(narrow) !== 70) fail("omission counterexample no longer valid");
if (Math.round(receiptSum / 130 * 100) !== 59) fail("normalized score mismatch");
if (score.arithmetic.ceiling_decision !== "retained" || score.arithmetic.r2a_evidence_ceiling !== 58) fail("ceiling decision drift");
if (Math.min(59, score.arithmetic.r2a_evidence_ceiling) !== 58 || score.arithmetic.canonical_reported_score !== 58) fail("reported score mismatch");
if (score.new_weights_or_policy !== false || score.score_inflation !== false) fail("new weights/policy or score inflation claimed");

const conditions = score.ceiling_conditions;
if (conditions.post_e2_exact_web_worker_parity !== "closed_at_managed_staging") fail("post-E2 parity not closed exactly");
if (conditions.valid_product_admission_worker_output_exact_deploy !== "closed_at_managed_zero_value_deterministic_trace") fail("admission-worker-output condition not closed exactly");
for (const key of ["legacy_paired_db_r2_audit", "c9_c12_aggregate", "ocr_policy_and_coverage", "representative_paid_provider_and_production_e2e", "production_payment_legal_incident_dr"]) {
  if (conditions[key] !== "open") fail(`remaining ceiling condition drift: ${key}`);
}

const expectedProjection = ["id", "ts", "from", "to", "type", "sha", "task", "task_id", "owner_id", "worker_id", "reply_to_id", "body"];
if (bus.schema !== "sanitized-agent-bus-messages/v2" || bus.sanitized !== true) fail("invalid bus receipt schema");
if (JSON.stringify(bus.projection) !== JSON.stringify(expectedProjection)) fail("unexpected bus projection");
if (bus.messages.length !== 2) fail("PASS/DONE message count mismatch");
const acceptedTask = "P0-POST-E2-PARITY-ADMISSION-WORKER-TRACE-20260826";
if (bus.messages.some((message) => message.task !== acceptedTask || message.task_id !== acceptedTask || message.sha !== score.baseline)) fail("bus task/SHA mismatch");
if (bus.messages.some((message) => message.owner_id !== "builder-parity-e2e-20260826" || message.worker_id !== "builder-parity-e2e-20260826")) fail("bus route mismatch");
if (bus.messages.filter((message) => message.type === "PASS").length !== 1 || bus.messages.filter((message) => message.type === "DONE").length !== 1) fail("PASS/DONE cardinality mismatch");
if (bus.messages.some((message) => ["origin_branch", "origin_worktree", "origin_repo_id", "origin_repo_path"].some((field) => Object.hasOwn(message, field)))) fail("unsanitized bus field");

for (const [ancestor, descendant] of ancestry.required_relations) {
  for (const sha of [ancestor, descendant]) {
    if (spawnSync("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }).status !== 0) fail(`commit does not resolve: ${sha}`);
  }
  if (spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" }).status !== 0) fail(`ancestry mismatch: ${ancestor} -> ${descendant}`);
}

const sourceBundle = path.join(root, "docs/evidence/P0-POST-E2-PARITY-ADMISSION-WORKER-TRACE-20260826");
const sourceManifest = fs.readFileSync(path.join(sourceBundle, "CHECKSUMS.sha256"), "utf8").trim().split("\n");
for (const line of sourceManifest) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) fail(`invalid source checksum line: ${line}`);
  const bytes = fs.readFileSync(path.join(sourceBundle, match[2]));
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== match[1]) fail(`source evidence checksum mismatch: ${match[2]}`);
}
const sourceValidation = readJson(path.join(sourceBundle, "VALIDATION.json"));
const sourceTrace = readJson(path.join(sourceBundle, "TRACE-RECEIPT.json"));
const sourceDeploy = readJson(path.join(sourceBundle, "DEPLOY-RECEIPTS.json"));
if (sourceValidation.result !== "PASS" || sourceValidation.app_sha !== ancestry.deployed_application_sha || !sourceValidation.exact_sha_parity || !sourceValidation.admission_to_worker_to_deliverable || !sourceValidation.canonical_worker_restored) fail("source validation conditions missing");
if (sourceTrace.exact_sha !== ancestry.deployed_application_sha || sourceTrace.trace.canonical_admission_http !== 201 || sourceTrace.trace.terminal !== "READY" || !sourceTrace.trace.deliverable_present_in_r2 || sourceTrace.external_provider_calls !== 0 || sourceTrace.payment_invoice_refund_settlement_calls !== 0 || sourceTrace.real_money_idr !== 0 || !sourceTrace.cleanup.database || !sourceTrace.cleanup.r2 || !sourceTrace.cleanup.queue) fail("source trace invariant mismatch");
if (sourceDeploy.deploys.staging_web.sha !== ancestry.deployed_application_sha || sourceDeploy.deploys.staging_worker_final.sha !== ancestry.deployed_application_sha || sourceDeploy.deploys.staging_web.status !== "live" || sourceDeploy.deploys.staging_worker_final.status !== "live" || sourceDeploy.services.staging_web.autoDeploy !== "no" || sourceDeploy.services.staging_worker.autoDeploy !== "no") fail("source deploy parity/restoration mismatch");

const canonical = path.join(root, "docs/evidence/SHIP-READINESS-CANONICAL-20260826.md");
const markdownFiles = [path.join(bundle, "README.md"), canonical];
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
const canonicalText = fs.readFileSync(canonical, "utf8");
if (!canonicalText.includes("TASK=`P1-POST-E2-CEILING-RECOMPUTE-20260826`") || !canonicalText.includes("SHIPPING_READINESS = 58/100")) fail("canonical decision not updated");

const scopedFiles = [
  ...markdownFiles,
  path.join(root, "docs/evidence/P0-03/PATH-CASE-MATRIX.md"),
  path.join(bundle, "SCORE-RECEIPT.json"),
  path.join(bundle, "BUS-SOURCE-MESSAGES.json"),
  path.join(bundle, "ANCESTRY.json"),
  path.join(bundle, "verify.mjs"),
];
const forbiddenSecret = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{16,})/i;
if (scopedFiles.some((file) => forbiddenSecret.test(fs.readFileSync(file, "utf8")))) fail("secret-like literal found");

const bundleManifest = fs.readFileSync(path.join(bundle, "MANIFEST.sha256"), "utf8").trim().split("\n");
for (const line of bundleManifest) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) fail(`invalid bundle checksum line: ${line}`);
  const bytes = fs.readFileSync(path.resolve(bundle, match[2]));
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== match[1]) fail(`bundle checksum mismatch: ${match[2]}`);
}

console.log(JSON.stringify({
  rows: 13,
  sum: 77,
  counterexample: { rows: 12, sum: 70 },
  normalized: 59,
  ceiling: 58,
  score: 58,
  closed_conditions: ["post_e2_exact_web_worker_parity", "valid_product_admission_worker_output_exact_deploy"],
  remaining_open_conditions: 5,
  messages: 2,
  ancestry_relations: ancestry.required_relations.length,
  source_checksums: sourceManifest.length,
  bundle_checksums: bundleManifest.length,
  markdown_links: links,
  secret_like_hits: 0,
  pass: true
}));
