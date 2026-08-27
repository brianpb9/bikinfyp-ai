#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../..");
const fail = (message) => { throw new Error(message); };
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const contract = read("RUBRIC-CONTRACT.json");
const task = read("SOURCE-TASK.json");

if (contract.task !== task.task || task.task_id !== task.task || task.owner_id !== task.worker_id) fail("task binding");
if (contract.baseline_sha !== task.baseline_sha) fail("baseline binding");
for (const sha of [contract.baseline_sha, contract.application_bundle_sha]) {
  if (spawnSync("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`], {stdio:"ignore"}).status !== 0) fail(`missing commit ${sha}`);
}
if (spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", contract.application_bundle_sha, contract.baseline_sha], {stdio:"ignore"}).status !== 0) fail("application/baseline ancestry");

const board = fs.readFileSync(path.join(root, contract.source_board), "utf8");
const section = board.split("## 1. Papan skor segar")[1]?.split("## 2.")[0] || "";
const sourceRows = [...section.matchAll(/^\| ([^|]+?) \| \d+ \| \*\*(\d+)\*\* \| (V|C|N|V\/C) \|/gm)].map((m) => [m[1].trim(), Number(m[2])]);
if (JSON.stringify(sourceRows) !== JSON.stringify(contract.source_rows)) fail("exact source row drift");
const raw = sourceRows.reduce((sum, row) => sum + row[1], 0);
if (sourceRows.length !== 13 || raw !== 77 || contract.current.raw_sum !== raw || contract.current.denominator !== 130) fail("current arithmetic");
if (Math.round(raw / 130 * 100) !== contract.current.normalized_rounded || Math.min(contract.current.normalized_rounded, contract.current.evidence_ceiling) !== contract.current.certified_score) fail("score calculation");

for (const [threshold, expected] of [[80,104],[90,117],[100,130]]) {
  if (contract.thresholds[String(threshold)].minimum_raw_sum !== expected || expected !== Math.ceil(threshold * 130 / 100)) fail(`threshold ${threshold}`);
}
if (contract.thresholds["90"].gate !== "UNDEFINED_AUTHORITY_CHOICE_REQUIRED" || contract.thresholds["90"].gate_source !== null) fail("invented 90 allocation");
if (contract.point_rule.evidence_receipt_changes_points !== false || contract.point_rule.default_delta !== 0 || contract.point_rule.missing_authority_result !== "NO_SCORE_CHANGE" || contract.point_rule.weights_may_not_be_redistributed !== true) fail("point rule drift");
for (const adjustment of contract.row_adjustments) for (const field of contract.point_rule.row_adjustment_requires) if (!(field in adjustment)) fail(`unauthorized adjustment field ${field}`);
if (contract.row_adjustments.length !== 0) fail("unexpected point adjustment");

const slots = contract.slots;
const expectedGates = {
  "80":["A","L","C5","P","G","B","R"],
  "90":["80","AUTHORIZED_80_TO_100_ALLOCATION","M","Q","I","U","K","O"],
  "100":["80","M","Q","I","U","K","O"],
};
for (const [threshold, required] of Object.entries(expectedGates)) if (JSON.stringify(contract.thresholds[threshold].requires) !== JSON.stringify(required)) fail(`canonical gate membership ${threshold}`);
const visit = (id, stack = []) => {
  if (stack.includes(id)) fail(`dependency cycle ${[...stack,id].join("->")}`);
  if (id === "80" || id === "AUTHORIZED_80_TO_100_ALLOCATION") return;
  if (!slots[id]) fail(`missing slot ${id}`);
  for (const dep of slots[id].depends_on) visit(dep, [...stack,id]);
};
for (const id of Object.keys(slots)) visit(id);
for (const threshold of ["80","90","100"]) for (const id of contract.thresholds[threshold].requires) visit(id);
if (contract.slots.B.depends_on.join(",") !== "A" || contract.slots.L.depends_on.join(",") !== "A") fail("lane dependency drift");

const slotIds = Object.keys(slots);
if (JSON.stringify(Object.keys(contract.receipt_registry)) !== JSON.stringify(slotIds)) fail("receipt registry slot coverage");
const requiredReceiptFields = ["receipt_id","slot_id","artifact_path","artifact_sha256","exact_sha","evidence_tier","authority_class","authority_receipt_id","dependency_receipt_ids","verdict"];
if (JSON.stringify(contract.receipt_contract.required_fields) !== JSON.stringify(requiredReceiptFields) || contract.receipt_contract.required_verdict !== "PASS" || contract.receipt_contract.closed_state !== "VERIFIED") fail("receipt contract drift");
const receiptsById = new Map();
for (const id of slotIds) {
  const receipts = contract.receipt_registry[id];
  if (!Array.isArray(receipts)) fail(`receipt registry shape ${id}`);
  for (const receipt of receipts) {
    for (const field of requiredReceiptFields) if (!(field in receipt)) fail(`receipt ${id} missing ${field}`);
    if (receipt.slot_id !== id || receipt.evidence_tier !== slots[id].tier || receipt.authority_class !== slots[id].closure_authority || receipt.verdict !== "PASS") fail(`receipt binding ${id}`);
    if (!receipt.authority_receipt_id || receiptsById.has(receipt.receipt_id)) fail(`receipt authority/identity ${id}`);
    if (!receipt.artifact_path.startsWith(contract.receipt_contract.artifact_path_prefix) || receipt.artifact_path.includes("..") || !/^[0-9a-f]{64}$/.test(receipt.artifact_sha256) || !/^[0-9a-f]{40}$/.test(receipt.exact_sha)) fail(`receipt artifact identity ${id}`);
    const artifact = path.join(root, receipt.artifact_path);
    if (!fs.existsSync(artifact) || crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex") !== receipt.artifact_sha256) fail(`receipt artifact bytes ${id}`);
    if (spawnSync("git", ["-C", root, "cat-file", "-e", `${receipt.exact_sha}^{commit}`], {stdio:"ignore"}).status !== 0) fail(`receipt exact SHA ${id}`);
    const dependencyIds = slots[id].depends_on.filter((dep) => dep !== "80");
    if (receipt.dependency_receipt_ids.length !== dependencyIds.length) fail(`receipt dependency cardinality ${id}`);
    receiptsById.set(receipt.receipt_id, receipt);
  }
  if (slots[id].state === contract.receipt_contract.closed_state && receipts.length === 0) fail(`closed slot without receipt ${id}`);
}
for (const id of slotIds) for (const receipt of contract.receipt_registry[id]) {
  for (const dependencyReceiptId of receipt.dependency_receipt_ids) {
    const dependencyReceipt = receiptsById.get(dependencyReceiptId);
    if (!dependencyReceipt || !slots[id].depends_on.includes(dependencyReceipt.slot_id) || dependencyReceipt.verdict !== "PASS") fail(`receipt dependency identity ${id}`);
  }
}
if ([...receiptsById].length !== 0) fail("unreviewed external receipt inserted");
if (contract.production_public_real_money !== "OFF" || !task.forbidden.includes("real money")) fail("safety boundary drift");

const manifest = fs.readFileSync(path.join(dir, "MANIFEST.sha256"), "utf8").trim().split("\n");
for (const line of manifest) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) fail(`bad manifest line ${line}`);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.resolve(dir, match[2]))).digest("hex");
  if (digest !== match[1]) fail(`checksum ${match[2]}`);
}
const secret = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{16,})/i;
for (const name of ["RUBRIC-CONTRACT.json","SOURCE-TASK.json","README.md","verify.mjs","VALIDATION.json"]) if (secret.test(fs.readFileSync(path.join(dir, name), "utf8"))) fail(`secret-like literal ${name}`);

console.log(JSON.stringify({source_rows:13,raw_sum:77,certified_score:58,thresholds:{80:104,90:117,100:130},slot_count:Object.keys(slots).length,receipt_registry_slots:Object.keys(contract.receipt_registry).length,receipts:0,row_adjustments:0,production_public_real_money:"OFF",pass:true}));
