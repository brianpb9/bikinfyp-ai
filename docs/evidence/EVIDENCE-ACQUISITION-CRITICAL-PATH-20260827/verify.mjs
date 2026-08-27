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
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const git = (args, options = {}) => spawnSync("git", ["-C", root, ...args], {encoding:"buffer", maxBuffer:16 * 1024 * 1024, ...options});
const committedBytes = (exactSha, artifactPath, label) => {
  if (git(["cat-file", "-e", `${exactSha}^{commit}`], {stdio:"ignore"}).status !== 0) fail(`${label} missing commit`);
  if (git(["merge-base", "--is-ancestor", exactSha, "HEAD"], {stdio:"ignore"}).status !== 0) fail(`${label} outside reviewed ancestry`);
  const shown = git(["show", `${exactSha}:${artifactPath}`]);
  if (shown.status !== 0) fail(`${label} missing committed artifact`);
  return shown.stdout;
};
const contract = read("RUBRIC-CONTRACT.json");
const task = read("SOURCE-TASK.json");
const matrix80 = read("SCORE-80-POINT-MATRIX.json");
const founder80 = read("FOUNDER-80-DIRECTION.json");
const authorityRegistry = read("AUTHORITY-REGISTRY.json");
const laneA = read("LANE-A-READONLY-ARTIFACT.json");
const laneB = read("LANE-B-READONLY-ARTIFACT.json");

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
if (contract.thresholds["90"].gate !== "NOT_AUTHORIZED_FOR_CURRENT_WORK" || contract.thresholds["90"].gate_source !== null) fail("90 scope boundary");
if (!contract.point_rule.evidence_receipt_changes_points || contract.point_rule.default_delta !== 0 || contract.point_rule.missing_authority_result !== "NO_SCORE_CHANGE" || contract.point_rule.weights_may_not_be_redistributed !== true || contract.point_rule.partial_tokens_allowed || contract.point_rule.token_value_raw_points !== 1 || !contract.point_rule.tokens_must_be_cumulative_within_row || contract.point_rule.ladder !== "SCORE-80-POINT-MATRIX.json") fail("point rule drift");
if (contract.founder_80_direction !== "FOUNDER-80-DIRECTION.json" || founder80.task !== contract.task || founder80.scope !== "SCORE_80_CRITICAL_PATH_ONLY" || founder80.production_public_real_money !== "OFF") fail("Founder 80 direction binding");
const c5 = founder80.category_unknown_policy;
if (c5.decision !== "APPROVED" || c5.result !== "FAIL_CLOSED_MANUAL_REVIEW_QUARANTINE" || c5.heuristic_auto_map !== "FORBIDDEN" || !c5.implementation_and_exact_sha_review_still_required || c5.forbidden_before_authorized_release.length !== 4) fail("C5 Founder policy");
const canary = founder80.payment_canary;
if (!canary.approved_in_principle || canary.execution_now !== "FORBIDDEN_PENDING_PREREQUISITES" || canary.boundary.audience !== "internal_closed" || canary.boundary.maximum_transactions !== 1 || canary.boundary.aggregate_spend_idr_max !== 50000 || canary.boundary.public_payments || canary.ambiguous_result !== "STOP_NO_RETRY" || canary.settlement_or_refund_failure !== "FAIL_CLOSED") fail("payment canary boundary");
if (JSON.stringify(founder80.release_model.required_named_roles) !== JSON.stringify(["Release Approver","Release Operator","Rollback Authority"]) || !founder80.release_model.roles_must_be_separate || founder80.release_model.names_status !== "MISSING") fail("release role slots");
const expectedPriceFields = ["currency","customer_price_idr","provider_generation_cogs_idr","payment_fee_idr","infrastructure_cogs_idr","tax_idr","refund_reserve_idr","total_cogs_idr","gross_margin_idr","gross_margin_percent","effective_at","approved_by","approval_reference"];
if (JSON.stringify(founder80.price_cogs_required_fields) !== JSON.stringify(expectedPriceFields)) fail("price/COGS required fields");
if (founder80.pitr_required_for_80.decision !== false || !founder80.pitr_required_for_80.non_waiver.includes("100")) fail("PITR 80 determination");
if (matrix80.scope !== "SCORE_80_ONLY" || matrix80.current_raw !== 77 || matrix80.target_raw !== 104 || matrix80.required_raw_delta !== 27 || matrix80.rules.partial_tokens_allowed || matrix80.rules.token_value_raw_points !== 1 || matrix80.rules.max_score_per_row !== 10 || matrix80.rules.weight_redistribution_allowed || !matrix80.rules.arithmetic_alone_does_not_close_noncompensable_80_slots) fail("80 matrix rules");
if (JSON.stringify(matrix80.rows.map((row) => [row.row,row.current])) !== JSON.stringify(contract.source_rows)) fail("80 matrix row binding");
const matrixTokens = matrix80.rows.flatMap((row) => {
  if (row.target_80 - row.current !== row.delta) fail(`80 matrix delta ${row.row}`);
  const expectedTargets = Array.from({length:row.delta}, (_, index) => row.current + index + 1);
  if (JSON.stringify(row.tokens.map((token) => token.target_score)) !== JSON.stringify(expectedTargets)) fail(`80 matrix targets ${row.row}`);
  for (const token of row.tokens) if (!token.token_id || !token.evidence || !token.authority_class) fail(`80 matrix token shape ${row.row}`);
  return row.tokens;
});
if (matrix80.rows.reduce((sum,row) => sum + row.target_80, 0) !== 104 || matrixTokens.length !== 27 || new Set(matrixTokens.map((token) => token.token_id)).size !== 27) fail("80 matrix exact 27 points");
if (JSON.stringify(matrix80.gate_classification["80_AND_90_INHERITED"]) !== JSON.stringify(["A","L","C5","P","G","B","R"]) || JSON.stringify(matrix80.gate_classification["90_ONLY_NOT_AUTHORIZED_NOW"]) !== JSON.stringify(["M","Q","I","U","K","O"])) fail("80/90 slot classification");
const pitrSource = fs.readFileSync(path.join(root, "docs/evidence/SHIP-READINESS-CANONICAL-20260824.md"), "utf8");
if (!pitrSource.includes("100/100") || !pitrSource.includes("backup/PITR restore")) fail("PITR canonical source");

const slots = contract.slots;
const expectedGates = {
  "80":["A","L","C5","P","G","B","R"],
  "90":["80","M","Q","I","U","K","O"],
  "100":["80","M","Q","I","U","K","O"],
};
for (const [threshold, required] of Object.entries(expectedGates)) if (JSON.stringify(contract.thresholds[threshold].requires) !== JSON.stringify(required)) fail(`canonical gate membership ${threshold}`);
const visit = (id, stack = []) => {
  if (stack.includes(id)) fail(`dependency cycle ${[...stack,id].join("->")}`);
  if (id === "80") return;
  if (!slots[id]) fail(`missing slot ${id}`);
  for (const dep of slots[id].depends_on) visit(dep, [...stack,id]);
};
for (const id of Object.keys(slots)) visit(id);
for (const threshold of ["80","90","100"]) for (const id of contract.thresholds[threshold].requires) visit(id);
if (contract.slots.B.depends_on.join(",") !== "A" || contract.slots.L.depends_on.join(",") !== "A") fail("lane dependency drift");

const slotIds = Object.keys(slots);
if (contract.authority_registry !== "AUTHORITY-REGISTRY.json") fail("authority registry binding");
if (authorityRegistry.task !== contract.task || authorityRegistry.required_decision !== "PASS" || !Array.isArray(authorityRegistry.entries)) fail("authority registry header");
const authorityRequired = ["authority_receipt_id","slot_id","authority_class","subject","issuer","decision","artifact_path","artifact_sha256","exact_sha"];
if (JSON.stringify(authorityRegistry.required_entry_fields) !== JSON.stringify(authorityRequired)) fail("authority registry fields");
const authoritiesById = new Map();
for (const authority of authorityRegistry.entries) {
  for (const field of authorityRequired) if (!(field in authority)) fail(`authority missing ${field}`);
  if (!slotIds.includes(authority.slot_id) || authority.authority_class !== slots[authority.slot_id].closure_authority || authority.subject !== `${contract.task}:${authority.slot_id}` || authority.decision !== "PASS") fail(`authority subject/class ${authority.authority_receipt_id}`);
  const allowedIssuers = authorityRegistry.allowed_issuers_by_class[authority.authority_class];
  if (!allowedIssuers?.includes(authority.issuer)) fail(`authority issuer ${authority.authority_receipt_id}`);
  if (!authority.artifact_path.startsWith("docs/evidence/") || authority.artifact_path.includes("..") || !/^[0-9a-f]{64}$/.test(authority.artifact_sha256) || !/^[0-9a-f]{40}$/.test(authority.exact_sha) || authoritiesById.has(authority.authority_receipt_id)) fail(`authority identity ${authority.authority_receipt_id}`);
  const bytes = committedBytes(authority.exact_sha, authority.artifact_path, `authority ${authority.authority_receipt_id}`);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== authority.artifact_sha256) fail(`authority bytes ${authority.authority_receipt_id}`);
  authoritiesById.set(authority.authority_receipt_id, authority);
}
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
    const bytes = committedBytes(receipt.exact_sha, receipt.artifact_path, `receipt ${receipt.receipt_id}`);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== receipt.artifact_sha256) fail(`receipt artifact bytes ${id}`);
    const authority = authoritiesById.get(receipt.authority_receipt_id);
    if (!authority || authority.slot_id !== id || authority.authority_class !== receipt.authority_class || authority.subject !== `${contract.task}:${id}` || authority.decision !== "PASS") fail(`receipt authority resolution ${id}`);
    const dependencyIds = slots[id].depends_on.flatMap((dep) => dep === "80" ? contract.thresholds["80"].requires : [dep]);
    if (receipt.dependency_receipt_ids.length !== dependencyIds.length || new Set(receipt.dependency_receipt_ids).size !== dependencyIds.length) fail(`receipt dependency cardinality ${id}`);
    receiptsById.set(receipt.receipt_id, receipt);
  }
  if (slots[id].state === contract.receipt_contract.closed_state && receipts.length === 0) fail(`closed slot without receipt ${id}`);
}
for (const id of slotIds) for (const receipt of contract.receipt_registry[id]) {
  const expectedDependencySlots = slots[id].depends_on.flatMap((dep) => dep === "80" ? contract.thresholds["80"].requires : [dep]).sort();
  const actualDependencySlots = receipt.dependency_receipt_ids.map((dependencyReceiptId) => {
    const dependencyReceipt = receiptsById.get(dependencyReceiptId);
    if (!dependencyReceipt || dependencyReceipt.verdict !== "PASS") fail(`receipt dependency identity ${id}`);
    return dependencyReceipt.slot_id;
  }).sort();
  if (JSON.stringify(actualDependencySlots) !== JSON.stringify(expectedDependencySlots)) fail(`receipt dependency exact set ${id}`);
}
if ([...receiptsById].length !== 0) fail("unreviewed external receipt inserted");
if ([...authoritiesById].length !== 0) fail("unreviewed authority receipt inserted");
if (contract.evidence_token_awards.length !== 0) fail("unreviewed evidence token award inserted");
if (contract.production_public_real_money !== "OFF" || !task.forbidden.includes("real money")) fail("safety boundary drift");

if (laneA.status !== "PENDING_INDEPENDENT_REVIEW" || laneA.exact_sha !== contract.baseline_sha || !laneA.independent_refresh) fail("Lane A pending binding");
for (const service of [laneA.staging.web, laneA.staging.worker]) {
  if (service.branch !== "staging/exact-46499ac-20260827" || service.auto_deploy !== "no" || service.suspended !== "not_suspended" || service.deploy_status !== "live" || service.deploy_sha !== contract.baseline_sha) fail(`Lane A service parity ${service.service_id}`);
}
if (laneA.staging.web.maintenance !== false || laneA.staging.web.pre_deploy_command !== "node scripts/migrate-postgres-runtime.mjs") fail("Lane A web readback");
const health = laneA.staging.health;
if (health.http_status !== 200 || !health.ok || health.build_sha !== contract.baseline_sha || health.payments_env !== "sandbox" || health.payments_live !== false || !health.classifier.capable || !health.classifier.ffmpeg || !health.classifier.ffprobe || !health.classifier.tesseract || !health.classifier.ocr_language || !health.classifier.smoke) fail("Lane A health");
const job = laneA.staging.readback_job;
if (job.status !== "succeeded" || job.exact_sha !== contract.baseline_sha || !job.database_connected || job.database_name !== "racun_staging" || job.migration_count !== 36 || job.latest_migration !== "0036_product_type_confirmation" || !job.r2_connected || job.mutation !== false || Object.values(job.required_slots_present).some((value) => value !== true)) fail("Lane A managed readback job");
if (laneA.staging.postgres_control_plane.status !== "available" || laneA.staging.postgres_control_plane.database_name !== "racun_staging" || laneA.staging.postgres_control_plane.high_availability !== false) fail("Lane A PostgreSQL control plane");
const oldControl = readJson(path.join(root, laneA.production_no_touch.baseline_source));
for (const [name, current, key] of [["web",laneA.production_no_touch.web,"production_web"],["worker",laneA.production_no_touch.worker,"production_worker"]]) {
  const old = oldControl.final[key];
  if (current.deploy_id !== old.deploy_id || current.deploy_sha !== old.sha || !current.matches_committed_baseline) fail(`production no-touch ${name}`);
}
if (laneA.production_no_touch.mutation_performed_by_refresh !== false || !laneA.production_no_touch.release_control_blocker_auto_deploy_yes_remains || !laneA.safety.commands_read_only || laneA.safety.deploy_created || laneA.safety.service_or_database_updated || laneA.safety.provider_called || laneA.safety.payment_or_real_money || laneA.safety.secret_values_persisted) fail("Lane A safety boundary");

if (laneB.status !== "PENDING_INDEPENDENT_REVIEW" || laneB.exact_sha !== contract.baseline_sha || laneB.browser.result !== "PASS") fail("Lane B pending binding");
if (laneB.baseline.branch !== "staging/exact-46499ac-20260827" || laneB.baseline.auto_deploy !== "no" || laneB.baseline.suspended !== "not_suspended" || laneB.baseline.maintenance !== false) fail("Lane B baseline");
const recovery = laneB.controlled_failure_recovery;
if (recovery.failure_sample.http_status !== 503 || recovery.recovery_samples.length !== 3 || recovery.recovery_samples.some((sample) => sample.http_status !== 200 || sample.body_sha256 !== laneB.baseline.health_body_sha256) || recovery.restored_control_plane.branch !== laneB.baseline.branch || recovery.restored_control_plane.auto_deploy !== "no" || recovery.restored_control_plane.suspended !== "not_suspended" || recovery.restored_control_plane.maintenance !== false || !recovery.web_deploy_unchanged || !recovery.worker_deploy_unchanged || !recovery.exact_sha_unchanged) fail("Lane B recovery");
if (laneB.kpi.status !== "succeeded" || laneB.kpi.window_days !== 7 || laneB.kpi.sample_n !== 0 || laneB.kpi.classification !== "NON_REPRESENTATIVE" || laneB.kpi.point_eligible !== false) fail("Lane B KPI classification");
if (!laneB.safety.staging_only || laneB.safety.production_mutation || laneB.safety.provider_call || laneB.safety.payment_or_real_money || laneB.safety.final_maintenance || laneB.safety.payments_env !== "sandbox" || laneB.safety.payments_live !== false) fail("Lane B safety boundary");

const manifest = fs.readFileSync(path.join(dir, "MANIFEST.sha256"), "utf8").trim().split("\n");
for (const line of manifest) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) fail(`bad manifest line ${line}`);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.resolve(dir, match[2]))).digest("hex");
  if (digest !== match[1]) fail(`checksum ${match[2]}`);
}
const secret = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{16,})/i;
for (const name of ["RUBRIC-CONTRACT.json","SOURCE-TASK.json","README.md","verify.mjs","VALIDATION.json","AUTHORITY-REGISTRY.json","FOUNDER-80-DIRECTION.json","SCORE-80-POINT-MATRIX.json","LANE-A-READONLY-ARTIFACT.json","LANE-A-COMMAND-LEDGER.md","LANE-B-READONLY-ARTIFACT.json"]) if (secret.test(fs.readFileSync(path.join(dir, name), "utf8"))) fail(`secret-like literal ${name}`);

console.log(JSON.stringify({source_rows:13,raw_sum:77,certified_score:58,target_80_raw:104,deterministic_58_to_80_point_tokens:27,pitr_required_for_80:false,slot_count:Object.keys(slots).length,receipt_registry_slots:Object.keys(contract.receipt_registry).length,receipts:0,authority_receipts:0,lane_A_artifact:"PENDING_INDEPENDENT_REVIEW",lane_B_artifact:"PENDING_INDEPENDENT_REVIEW",lane_B_kpi:"NON_REPRESENTATIVE_N_0",evidence_token_awards:0,production_public_real_money:"OFF",pass:true}));
