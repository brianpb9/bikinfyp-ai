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
const board = fs.readFileSync(path.join(root, score.source_board), "utf8");

const domains = ["Money safety","Auth intent & failure path","Mobile UI 375","Hydration/interaction canary CI","Content engine standard","Brand fidelity","Anti-slop produksi","Prompt/verdict archive","NSFW rejection","Payments","Legal/PDP","DR/monitoring/incident owner","Landing/pricing consistency"];
if (score.task !== "P1-POST-POLICY-BUNDLE-READINESS-RECOMPUTE-20260827") fail("wrong task");
if (score.baseline !== "0e953f9ccfd8991c96fecbed44bb3b892e0c8829") fail("wrong baseline");
if (score.rows.length !== 13 || new Set(score.rows.map((r) => r.domain)).size !== 13) fail("row omission/duplicate");
if (JSON.stringify(score.rows.map((r) => r.domain)) !== JSON.stringify(domains)) fail("domain drift");
if (score.rows.some((r) => !Number.isInteger(r.score) || r.score < 0 || r.score > 10 || r.delta !== 0)) fail("invalid row or inflation");
const sum = score.rows.reduce((n, r) => n + r.score, 0);
if (sum !== 77 || score.arithmetic.raw_sum !== 77 || Math.round(sum / 130 * 100) !== 59) fail("arithmetic mismatch");
if (score.arithmetic.r2a_evidence_ceiling !== 58 || score.arithmetic.canonical_reported_score !== 58 || score.arithmetic.ceiling_decision !== "retained") fail("ceiling mismatch");
for (const threshold of [70, 80, 90]) {
  const expected = Math.ceil(threshold * 130 / 100);
  const row = score.threshold_arithmetic[String(threshold)];
  if (row.minimum_raw_sum !== expected || row.additional_raw_points_from_77 !== expected - 77 || row.canonical_points_from_58 !== threshold - 58) fail(`threshold arithmetic ${threshold}`);
}
if (score.acceptance_matrix.pass + score.acceptance_matrix.partial + score.acceptance_matrix.blocked !== 13) fail("matrix count mismatch");
if (score.next_autonomous_task !== null || score.next_autonomous_action !== "IDLE_COMPLETE") fail("autonomous conclusion drift");
if (score.new_weights_or_policy !== false || score.score_inflation !== false) fail("inflation/policy claimed");

const section = board.split("## 1. Papan skor segar")[1]?.split("## 2.")[0] || "";
const rows = [...section.matchAll(/^\| ([^|]+?) \| \d+ \| \*\*(\d+)\*\* \| (V|C|N|V\/C) \|/gm)];
if (rows.length !== 13 || rows.reduce((n, r) => n + Number(r[2]), 0) !== 77) fail("source board mismatch");

const tasks = new Map([
  ["P0-C2-TYPE-MISMATCH-IMPLEMENTATION-20260827", "dbf96691fd7b824e3d0dd0c2dc186172f02ca0bd"],
  ["P0-C6-OCR-FAIL-CLOSED-BEFORE-SPEND-20260827", "e62313ced1a414fbbbff20671123b766979892c2"],
  ["P0-C9-PROMO-SNAPSHOT-AT-ADMISSION-20260827", "7475ddb3ccbfe6390ec79dda789d3f2d9325ca3d"],
  ["P0-C10-LEGACY-JOB-QUARANTINE-20260827", score.baseline],
]);
if (bus.schema !== "sanitized-agent-bus-messages/v2" || bus.sanitized !== true || bus.messages.length !== 8) fail("bus receipt shape");
for (const [task, sha] of tasks) {
  const messages = bus.messages.filter((m) => m.task === task);
  if (messages.length !== 2 || messages.filter((m) => m.type === "PASS").length !== 1 || messages.filter((m) => m.type === "DONE").length !== 1) fail(`PASS/DONE cardinality ${task}`);
  if (messages.some((m) => m.sha !== sha || m.task_id !== task || m.owner_id !== m.worker_id)) fail(`binding mismatch ${task}`);
  if (spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, score.baseline], {stdio:"ignore"}).status !== 0) fail(`non-ancestor ${sha}`);
}
if (bus.messages.some((m) => ["origin_branch","origin_worktree","origin_repo_id","origin_repo_path","body"].some((key) => Object.hasOwn(m, key)))) fail("unsanitized bus receipt");

for (const rel of [
  "docs/evidence/P0-C2-TYPE-MISMATCH-IMPLEMENTATION-20260827/README.md",
  "docs/evidence/P0-C6-OCR-FAIL-CLOSED-BEFORE-SPEND-20260827/README.md",
  "docs/evidence/P0-C9-PROMO-SNAPSHOT-AT-ADMISSION-20260827/FOUNDER-DECISION.md",
  "docs/evidence/P0-C10-LEGACY-JOB-QUARANTINE-20260827/README.md",
  "docs/evidence/P0-03/PATH-CASE-MATRIX.md",
  "docs/evidence/SHIP-READINESS-CANONICAL-20260827.md"
]) if (!fs.existsSync(path.join(root, rel))) fail(`missing source ${rel}`);

let links = 0;
for (const file of [path.join(bundle, "README.md"), path.join(root, "docs/evidence/SHIP-READINESS-CANONICAL-20260827.md")]) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = m[1].split("#", 1)[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    links += 1;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) fail(`missing link ${target}`);
  }
}

const scoped = ["README.md","SCORE-RECEIPT.json","BUS-SOURCE-MESSAGES.json","verify.mjs","VALIDATION.json"].map((f) => path.join(bundle, f));
scoped.push(path.join(root, "docs/evidence/SHIP-READINESS-CANONICAL-20260827.md"), path.join(root, "docs/evidence/P0-03/PATH-CASE-MATRIX.md"));
const secret = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{16,})/i;
if (scoped.some((f) => secret.test(fs.readFileSync(f, "utf8")))) fail("secret-like literal");

const manifest = fs.readFileSync(path.join(bundle, "MANIFEST.sha256"), "utf8").trim().split("\n");
for (const line of manifest) {
  const m = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!m) fail(`bad manifest line ${line}`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.resolve(bundle, m[2]))).digest("hex");
  if (actual !== m[1]) fail(`checksum mismatch ${m[2]}`);
}

console.log(JSON.stringify({rows:13,raw_sum:77,normalized:59,ceiling:58,score:58,threshold_raw:{70:91,80:104,90:117},messages:8,tasks:4,acceptance_matrix:{pass:3,partial:9,blocked:1},markdown_links:links,secret_like_hits:0,next:"IDLE_COMPLETE",pass:true}));
