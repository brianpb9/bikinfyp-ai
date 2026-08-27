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
const visit = (id, stack = []) => {
  if (stack.includes(id)) fail(`dependency cycle ${[...stack,id].join("->")}`);
  if (id === "80") return;
  if (!slots[id]) fail(`missing slot ${id}`);
  for (const dep of slots[id].depends_on) visit(dep, [...stack,id]);
};
for (const id of Object.keys(slots)) visit(id);
for (const threshold of ["80","100"]) for (const id of contract.thresholds[threshold].requires) visit(id);
if (contract.slots.B.depends_on.join(",") !== "A" || contract.slots.L.depends_on.join(",") !== "A") fail("lane dependency drift");
if (contract.lane_receipts.A.length || contract.lane_receipts.B.length) fail("unreviewed external receipt inserted");
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

console.log(JSON.stringify({source_rows:13,raw_sum:77,certified_score:58,thresholds:{80:104,90:117,100:130},slot_count:Object.keys(slots).length,lane_A_receipts:0,lane_B_receipts:0,row_adjustments:0,production_public_real_money:"OFF",pass:true}));
