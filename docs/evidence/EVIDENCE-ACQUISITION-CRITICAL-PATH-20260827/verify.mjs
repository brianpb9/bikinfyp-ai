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
const amendedTask = read("AMENDED-SOURCE-TASK.json");
const amendedRawBytes = fs.readFileSync(path.join(dir,"AMENDED-SOURCE-TASK.raw.json"));
const amendedRaw = JSON.parse(amendedRawBytes);
const compressionTask = read("COMPRESSION-SOURCE-TASK.json");
const compressionRawBytes = fs.readFileSync(path.join(dir,"COMPRESSION-SOURCE-TASK.raw.json"));
const compressionRaw = JSON.parse(compressionRawBytes);
const matrix80 = read("SCORE-80-POINT-MATRIX.json");
const founder80 = read("FOUNDER-80-DIRECTION.json");
const authorityRegistry = read("AUTHORITY-REGISTRY.json");
const negativeCases = read("NEGATIVE-CASES.json");
const laneA = read("LANE-A-READONLY-ARTIFACT.json");
const laneB = read("LANE-B-READONLY-ARTIFACT.json");

if (contract.task !== task.task || task.task_id !== task.task || task.owner_id !== task.worker_id) fail("task binding");
if (contract.review_status !== "CHANGES_REQUESTED_CANONICAL_TOKEN_MAPPING_REQUIRED" || contract.authority_trust_state?.status !== "CANONICAL_REVIEWER_BUS" || contract.authority_trust_state?.crypto_or_hsm_required !== false || contract.authority_trust_state?.builder_may_author_review_verdict !== false) fail("review authority state");
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
if (contract.score_delta?.canonical_58_to_80 !== 22 || contract.score_delta?.fixed_rubric_raw_77_to_104 !== 27 || !contract.score_delta?.raw_delta_is_not_canonical_delta || !contract.score_delta?.mandatory_noncompensable_gates_are_separate_from_scored_tokens || contract.score_delta?.c5_mandatory_gate_point_gain !== "UNDEFINED_ZERO_AWARDED") fail("score delta distinction");

for (const [threshold, expected] of [[80,104],[90,117],[100,130]]) {
  if (contract.thresholds[String(threshold)].minimum_raw_sum !== expected || expected !== Math.ceil(threshold * 130 / 100)) fail(`threshold ${threshold}`);
}
if (contract.thresholds["90"].gate !== "NOT_AUTHORIZED_FOR_CURRENT_WORK" || contract.thresholds["90"].gate_source !== null) fail("90 scope boundary");
if (!contract.point_rule.evidence_receipt_changes_points || contract.point_rule.default_delta !== 0 || contract.point_rule.missing_authority_result !== "NO_SCORE_CHANGE" || contract.point_rule.weights_may_not_be_redistributed !== true || contract.point_rule.partial_tokens_allowed || contract.point_rule.token_value_raw_points !== 1 || !contract.point_rule.tokens_must_be_cumulative_within_row || contract.point_rule.ladder !== "SCORE-80-POINT-MATRIX.json") fail("point rule drift");
if (amendedTask.id !== "1787845709000-reviewer-TASK" || amendedTask.from !== "reviewer" || amendedTask.to !== "builder" || amendedTask.type !== "TASK" || amendedTask.sha !== "" || amendedTask.task !== contract.task || amendedTask.task_id !== contract.task || amendedTask.owner_id !== task.owner_id || amendedTask.worker_id !== task.worker_id || amendedTask.source_archive_sha256 !== "32d9c64bd8b162338ab749b2ab1d101345b26aa262ba368fb0c585b09a75444e" || crypto.createHash("sha256").update(amendedTask.body).digest("hex") !== "c66ba2bb31edf70760472864c0cdd67e9c0cc4787c7618314c50edded1e61ac7" || crypto.createHash("sha256").update(amendedRawBytes).digest("hex") !== amendedTask.source_archive_sha256 || amendedRaw.id !== amendedTask.id || amendedRaw.body !== amendedTask.body || amendedRaw.ts !== amendedTask.ts) fail("amended authority task binding");
if (contract.compression_source_task !== "COMPRESSION-SOURCE-TASK.json" || compressionTask.id !== "1787849638000-reviewer-TASK" || compressionTask.from !== "reviewer" || compressionTask.to !== "builder" || compressionTask.type !== "TASK" || compressionTask.sha !== "" || compressionTask.task !== contract.task || compressionTask.task_id !== contract.task || compressionTask.owner_id !== task.owner_id || compressionTask.worker_id !== task.worker_id || compressionTask.scope !== "COMPRESSION_ROUND_SCORE_80_ONLY" || compressionTask.canonical_score_delta !== 22 || compressionTask.minimum_raw_delta !== 27 || compressionTask.review_authority !== "CANONICAL_SINGLETON_INDEPENDENT_CODEX_EXACT_SHA_REVIEWER_OVER_AGENT_BUS" || compressionTask.source_archive_sha256 !== "de4e306a991263d5ed2e4e68b10542ef79a4aca2edea634524ff302073bd7f7c" || crypto.createHash("sha256").update(compressionRawBytes).digest("hex") !== compressionTask.source_archive_sha256 || compressionRaw.id !== compressionTask.id || compressionRaw.body !== "COMPRESSION_ROUND_SCORE_80_ONLY. Arithmetic correction: certified 58 to 80 is +22 canonical, but fixed 13x10 rubric raw 77 must reach >=104, so minimum is +27 raw; do not claim +22 raw. Distinguish scored tokens from mandatory noncompensable gates. Payment: closed internal max-1 real-money transaction aggregate<=IDR50000, public disabled, exactly-once, ambiguous STOP_NO_RETRY; obtain canary/provider receipt/DB truth/settlement reconciliation/Reviewer PASS before separate PAYMENTS_GO_LIVE decision. Reviewer independence: canonical rubric does not require crypto/HSM; remove invented signing requirement and rely on canonical singleton independent Codex exact-SHA Reviewer + durable append-only bus/stale protection. C5 implement approved fail-closed quarantine, no provider/spend/publication, release only by Authorized Human Review Role; exact role field remains missing. Remove PITR/legal/representative KPI/stable operational cycle/incident-DR from 80 path. Compress canary economics fields. Parallelize Lane A/B receipt acceptance, managed OTP/E2E, 375 mobile, hydration, C5, prompt archive, zero-spend NSFW fixtures. No unrelated work.") fail("compression authority task binding");
if (contract.founder_80_direction !== "FOUNDER-80-DIRECTION.json" || founder80.task !== contract.task || founder80.scope !== "SCORE_80_CRITICAL_PATH_ONLY" || founder80.production_public_real_money !== "OFF" || founder80.authority_source !== "AMENDED-SOURCE-TASK.json" || founder80.authority_message_id !== amendedTask.id) fail("Founder 80 direction binding");
const c5 = founder80.category_unknown_policy;
if (c5.decision !== "APPROVED" || c5.result !== "FAIL_CLOSED_MANUAL_REVIEW_QUARANTINE" || c5.heuristic_auto_map !== "FORBIDDEN" || !c5.implementation_and_exact_sha_review_still_required || c5.forbidden_before_authorized_release.length !== 4) fail("C5 Founder policy");
const canary = founder80.payment_canary;
if (!canary.approved_in_principle || canary.execution_now !== "FORBIDDEN_PENDING_PREREQUISITES" || canary.boundary.audience !== "internal_closed" || canary.boundary.maximum_transactions !== 1 || canary.boundary.aggregate_spend_idr_max !== 50000 || canary.boundary.public_payments || canary.ambiguous_result !== "STOP_NO_RETRY" || canary.settlement_or_refund_failure !== "FAIL_CLOSED") fail("payment canary boundary");
if (JSON.stringify(founder80.release_model.required_named_roles) !== JSON.stringify(["Release Approver","Release Operator","Rollback Authority"]) || !founder80.release_model.roles_must_be_separate || founder80.release_model.names_status !== "MISSING") fail("release role slots");
const expectedPriceFields = ["currency","customer_price_idr","provider_generation_cogs_idr","payment_fee_idr","total_cogs_idr","maximum_authorized_spend_idr","approved_by","approval_reference"];
if (JSON.stringify(founder80.price_cogs_required_fields) !== JSON.stringify(expectedPriceFields)) fail("price/COGS required fields");
if (founder80.pitr_required_for_80.decision !== false || !founder80.pitr_required_for_80.non_waiver.includes("100")) fail("PITR 80 determination");
if (matrix80.schema !== "score-80-point-matrix/v2" || matrix80.scope !== "SCORE_80_ONLY" || matrix80.current_raw !== 77 || matrix80.target_raw !== 104 || matrix80.required_raw_delta !== 27 || matrix80.allocation_status !== "CHANGES_REQUESTED_NO_ACCEPTED_CANONICAL_COMBINATION" || matrix80.accepted_token_count !== 0 || matrix80.rules.partial_tokens_allowed || matrix80.rules.token_value_raw_points !== 1 || matrix80.rules.max_score_per_row !== 10 || matrix80.rules.weight_redistribution_allowed || !matrix80.rules.arithmetic_alone_does_not_close_noncompensable_80_slots || !matrix80.rules.unmapped_points_may_not_be_invented) fail("80 matrix rules");
if (JSON.stringify(matrix80.rows.map((row) => [row.row,row.current])) !== JSON.stringify(contract.source_rows)) fail("80 matrix row binding");
const matrixTokens = matrix80.rows.flatMap((row) => row.tokens);
if (matrixTokens.length !== 0 || matrix80.rows.some((row) => !Array.isArray(row.tokens) || (row.accepted_target_80 !== null && row.accepted_target_80 !== row.current))) fail("80 matrix invented allocation");
const tokenById = new Map(matrix80.rows.flatMap((row) => row.tokens.map((token) => [token.token_id,{...token,row:row.row,current:row.current}])));
if (JSON.stringify(matrix80.gate_classification["80_INHERITED_BY_90"]) !== JSON.stringify(["A","L","C5","P","G","B","R"]) || matrix80.gate_classification["90_INCREMENTAL"] !== "UNDEFINED_FOUNDER_AUTHORITY_REQUIRED" || JSON.stringify(matrix80.gate_classification["100_ONLY_ADDITIONAL"]) !== JSON.stringify(["M","Q","I","U","K","O"]) || JSON.stringify(matrix80.gate_classification.EXCLUDED_FROM_80_EVIDENCE) !== JSON.stringify(["PITR","LEGAL_COUNSEL","REPRESENTATIVE_KPI_SAMPLE","STABLE_OPERATIONAL_CYCLE","INCIDENT_DR"])) fail("80/90 slot classification");
const pitrSource = fs.readFileSync(path.join(root, "docs/evidence/SHIP-READINESS-CANONICAL-20260824.md"), "utf8");
if (!pitrSource.includes("100/100") || !pitrSource.includes("backup/PITR restore")) fail("PITR canonical source");

const slots = contract.slots;
const expectedGates = {
  "80":["A","L","C5","P","G","B","R"],
  "90":["80"],
  "100":["80","M","Q","I","U","K","O"],
};
for (const [threshold, required] of Object.entries(expectedGates)) if (JSON.stringify(contract.thresholds[threshold].requires) !== JSON.stringify(required)) fail(`canonical gate membership ${threshold}`);
if (contract.thresholds["90"].incremental_requirements !== "UNDEFINED_FOUNDER_AUTHORITY_REQUIRED") fail("90 incremental allocation invented");
const visit = (id, stack = []) => {
  if (stack.includes(id)) fail(`dependency cycle ${[...stack,id].join("->")}`);
  if (id === "80") return;
  if (!slots[id]) fail(`missing slot ${id}`);
  for (const dep of slots[id].depends_on) visit(dep, [...stack,id]);
};
for (const id of Object.keys(slots)) visit(id);
for (const threshold of ["80","90","100"]) for (const id of contract.thresholds[threshold].requires) visit(id);
if (contract.slots.B.depends_on.join(",") !== "A" || contract.slots.L.depends_on.join(",") !== "A") fail("lane dependency drift");
if (contract.slots.P.state !== "NOT_READY_CHEAPEST_SKU_60000_EXCEEDS_50000_CAP") fail("payment canary readiness");

const slotIds = Object.keys(slots);
if (contract.authority_registry !== "AUTHORITY-REGISTRY.json") fail("authority registry binding");
if (authorityRegistry.task !== contract.task || authorityRegistry.schema !== "evidence-authority-registry/v3" || !Array.isArray(authorityRegistry.entries)) fail("authority registry header");
const PINNED_ISSUERS = Object.freeze({
  FOUNDER_SCOPE_DIRECTION:["reviewer-on-founder-authority"],
  REVIEWER_PASS:["reviewer"],
  FOUNDER_DECISION_AND_REVIEWER_PASS:["founder+reviewer"],
  PAYMENT_OWNER_AND_REVIEWER_PASS:["payment-owner+reviewer"],
  FOUNDER_DECISION:["founder"],
  RELEASE_OWNER_AND_REVIEWER_PASS:["release-owner+reviewer"],
  QA_RELEASE_REVIEWER_PASS:["qa-release-reviewer"],
  COUNSEL_SIGNOFF:["counsel"],
  INCIDENT_OWNER_AND_REVIEWER_PASS:["incident-owner+reviewer"],
  INDEPENDENT_REVIEWER_PASS:["independent-reviewer"]
});
const PINNED_DECISIONS = Object.freeze({SCOPE:"AUTHORIZED",SLOT:"PASS",TOKEN:"PASS"});
if (JSON.stringify(authorityRegistry.allowed_issuers_by_class) !== JSON.stringify(PINNED_ISSUERS)) fail("authority issuer policy drift");
if (JSON.stringify(authorityRegistry.decision_by_kind) !== JSON.stringify(PINNED_DECISIONS)) fail("authority decision policy drift");
if (!authorityRegistry.authority_source_contract?.SCOPE?.startsWith("Only the pinned amended Founder TASK") || !authorityRegistry.authority_source_contract?.SLOT_OR_TOKEN?.includes("canonical .agent-bus Reviewer PASS") || !authorityRegistry.authority_source_contract?.SLOT_OR_TOKEN?.includes("STALE=false") || !authorityRegistry.authority_source_contract?.SLOT_OR_TOKEN?.includes("Builder cannot author PASS")) fail("authority source contract drift");
const authorityRequired = ["authority_receipt_id","kind","authority_class","subject","scope","issuer","decision","approved_at","source_message_id","source_archive_sha256","artifact_path","artifact_sha256","exact_sha"];
if (JSON.stringify(authorityRegistry.required_entry_fields) !== JSON.stringify(authorityRequired)) fail("authority registry fields");
const validateBusAuthoritySource = (authority,source) => {
  if (authority.kind === "SCOPE") {
    if (source.type !== "TASK" || source.from !== "reviewer" || source.to !== "builder" || source.sha !== "" || source.id !== amendedTask.id || source.task !== contract.task || source.task_id !== contract.task || source.body !== amendedTask.body || authority.source_message_id !== source.id) fail(`authority source task/SHA ${authority.authority_receipt_id}`);
    return;
  }
  if (authority.kind !== "SLOT" && authority.kind !== "TOKEN") fail(`authority source kind ${authority.authority_receipt_id}`);
  if (source.type !== "PASS" || source.from !== "reviewer" || source.to !== "builder") fail(`authority source role/type ${authority.authority_receipt_id}`);
  if (source.task !== contract.task || source.task_id !== contract.task || source.owner_id !== task.owner_id || source.worker_id !== task.worker_id || !/^[0-9a-f]{40}$/.test(source.sha) || git(["merge-base","--is-ancestor",source.sha,authority.exact_sha],{stdio:"ignore"}).status !== 0) fail(`authority source task/SHA ${authority.authority_receipt_id}`);
};
const validateAuthoritySource = (authority,source,{fixture=false,fixturePublicKey=null}={}) => {
  if (fixture) {
    if (source.schema !== "score-80-full-path-fixture-source/v1" || source.decision !== "PASS" || !source.scope.includes("validator-only")) fail(`authority fixture source ${authority.authority_receipt_id}`);
    return;
  }
  validateBusAuthoritySource(authority,source);
};
const validateAuthorities = (entries,{fixture=false,fixturePublicKey=null}={}) => {
  const result = new Map();
  for (const authority of entries) {
    for (const field of authorityRequired) if (!(field in authority)) fail(`authority missing ${field}`);
    if (!Object.hasOwn(PINNED_DECISIONS, authority.kind) || authority.decision !== PINNED_DECISIONS[authority.kind]) fail(`authority decision ${authority.authority_receipt_id}`);
    if (!authority.scope || typeof authority.scope !== "object" || !authority.approved_at || !authority.source_message_id || !/^[0-9a-f]{64}$/.test(authority.source_archive_sha256)) fail(`authority scope/source ${authority.authority_receipt_id}`);
    if (authority.kind === "SLOT" && (!slotIds.includes(authority.slot_id) || authority.authority_class !== slots[authority.slot_id].closure_authority || authority.subject !== `${contract.task}:${authority.slot_id}`)) fail(`authority slot subject/class ${authority.authority_receipt_id}`);
    if (authority.kind === "TOKEN") {
      const token = tokenById.get(authority.token_id);
      if (!token || authority.authority_class !== token.authority_class || authority.subject !== `${contract.task}:TOKEN:${authority.token_id}`) fail(`authority token subject/class ${authority.authority_receipt_id}`);
    }
    if (authority.kind === "SCOPE" && (authority.authority_class !== "FOUNDER_SCOPE_DIRECTION" || authority.subject !== contract.task || JSON.stringify(authority.scope) !== JSON.stringify(["C5_POLICY","PAYMENT_CANARY_POSTURE","RELEASE_CONTROL_MODEL","SCORE_80_REQUIRED_OUTPUT"]))) fail(`authority task scope ${authority.authority_receipt_id}`);
    if (!PINNED_ISSUERS[authority.authority_class]?.includes(authority.issuer)) fail(`authority issuer ${authority.authority_receipt_id}`);
    if (!authority.artifact_path.startsWith("docs/evidence/") || authority.artifact_path.includes("..") || !/^[0-9a-f]{64}$/.test(authority.artifact_sha256) || !/^[0-9a-f]{40}$/.test(authority.exact_sha) || result.has(authority.authority_receipt_id)) fail(`authority identity ${authority.authority_receipt_id}`);
    const bytes = committedBytes(authority.exact_sha, authority.artifact_path, `authority ${authority.authority_receipt_id}`);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== authority.artifact_sha256 || digest !== authority.source_archive_sha256) fail(`authority source bytes ${authority.authority_receipt_id}`);
    let source; try { source=JSON.parse(bytes); } catch { fail(`authority source JSON ${authority.authority_receipt_id}`); }
    if (!fixture && (source.id !== authority.source_message_id || source.ts !== authority.approved_at || source.from !== "reviewer")) fail(`authority source identity ${authority.authority_receipt_id}`);
    validateAuthoritySource(authority,source,{fixture,fixturePublicKey});
    result.set(authority.authority_receipt_id, authority);
  }
  return result;
};
const authoritiesById = validateAuthorities(authorityRegistry.entries);
const founderScopeAuthority = authoritiesById.get(founder80.authority_receipt_id);
if (!founderScopeAuthority || founderScopeAuthority.kind !== "SCOPE" || founderScopeAuthority.source_message_id !== amendedTask.id || founderScopeAuthority.source_archive_sha256 !== amendedTask.source_archive_sha256 || founderScopeAuthority.approved_at !== amendedTask.ts || founderScopeAuthority.artifact_path !== `docs/evidence/${contract.task}/AMENDED-SOURCE-TASK.raw.json`) fail("Founder authority registry binding");
if (JSON.stringify(Object.keys(contract.receipt_registry)) !== JSON.stringify(slotIds)) fail("receipt registry slot coverage");
const requiredReceiptFields = ["receipt_id","slot_id","artifact_path","artifact_sha256","exact_sha","evidence_tier","authority_class","authority_receipt_id","dependency_receipt_ids","verdict"];
if (JSON.stringify(contract.receipt_contract.required_fields) !== JSON.stringify(requiredReceiptFields) || contract.receipt_contract.required_verdict !== "PASS" || contract.receipt_contract.closed_state !== "VERIFIED") fail("receipt contract drift");
const validateReceiptRegistry = (registry,authorityMap,slotState) => {
 const result = new Map();
 if (JSON.stringify(Object.keys(registry)) !== JSON.stringify(slotIds)) fail("receipt registry slot coverage");
 for (const id of slotIds) {
  const receipts = registry[id];
  if (!Array.isArray(receipts)) fail(`receipt registry shape ${id}`);
  for (const receipt of receipts) {
    for (const field of requiredReceiptFields) if (!(field in receipt)) fail(`receipt ${id} missing ${field}`);
    if (receipt.slot_id !== id || receipt.evidence_tier !== slots[id].tier || receipt.authority_class !== slots[id].closure_authority || receipt.verdict !== "PASS") fail(`receipt binding ${id}`);
    if (!receipt.authority_receipt_id || result.has(receipt.receipt_id)) fail(`receipt authority/identity ${id}`);
    if (!receipt.artifact_path.startsWith(contract.receipt_contract.artifact_path_prefix) || receipt.artifact_path.includes("..") || !/^[0-9a-f]{64}$/.test(receipt.artifact_sha256) || !/^[0-9a-f]{40}$/.test(receipt.exact_sha)) fail(`receipt artifact identity ${id}`);
    const bytes = committedBytes(receipt.exact_sha, receipt.artifact_path, `receipt ${receipt.receipt_id}`);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== receipt.artifact_sha256) fail(`receipt artifact bytes ${id}`);
    const authority = authorityMap.get(receipt.authority_receipt_id);
    if (!authority || authority.kind !== "SLOT" || authority.slot_id !== id || authority.authority_class !== receipt.authority_class || authority.subject !== `${contract.task}:${id}` || authority.decision !== "PASS") fail(`receipt authority resolution ${id}`);
    const expectedScope = {receipt_id:receipt.receipt_id,slot_id:id,artifact_path:receipt.artifact_path,artifact_sha256:receipt.artifact_sha256,exact_sha:receipt.exact_sha,dependency_receipt_ids:receipt.dependency_receipt_ids};
    if (JSON.stringify(authority.scope) !== JSON.stringify(expectedScope)) fail(`receipt authority scope ${id}`);
    const dependencyIds = slots[id].depends_on.flatMap((dep) => dep === "80" ? contract.thresholds["80"].requires : [dep]);
    if (receipt.dependency_receipt_ids.length !== dependencyIds.length || new Set(receipt.dependency_receipt_ids).size !== dependencyIds.length) fail(`receipt dependency cardinality ${id}`);
    result.set(receipt.receipt_id, receipt);
  }
  if (slotState[id] === contract.receipt_contract.closed_state && receipts.length === 0) fail(`closed slot without receipt ${id}`);
}
for (const id of slotIds) for (const receipt of registry[id]) {
  const expectedDependencySlots = slots[id].depends_on.flatMap((dep) => dep === "80" ? contract.thresholds["80"].requires : [dep]).sort();
  const actualDependencySlots = receipt.dependency_receipt_ids.map((dependencyReceiptId) => {
    const dependencyReceipt = result.get(dependencyReceiptId);
    if (!dependencyReceipt || dependencyReceipt.verdict !== "PASS") fail(`receipt dependency identity ${id}`);
    return dependencyReceipt.slot_id;
  }).sort();
  if (JSON.stringify(actualDependencySlots) !== JSON.stringify(expectedDependencySlots)) fail(`receipt dependency exact set ${id}`);
}
return result;
};
const actualSlotState = Object.fromEntries(slotIds.map((id) => [id,slots[id].state]));
const receiptsById = validateReceiptRegistry(contract.receipt_registry,authoritiesById,actualSlotState);
const awardFields = ["award_id","authority_receipt_id","token_id","row","prior_score","new_score","evidence_receipt_ids"];
if (JSON.stringify(contract.point_rule.token_award_requires) !== JSON.stringify(awardFields)) fail("token award fields");
const validateAwards = (awards, receiptMap, authorityMap, slotState, claimed) => {
  const seenAwardIds = new Set();
  const seenTokenIds = new Set();
  const awardsByToken = new Map();
  for (const award of awards) {
    for (const field of awardFields) if (!(field in award)) fail(`award missing ${field}`);
    const token = tokenById.get(award.token_id);
    if (!token) fail("award unknown token");
    if (seenAwardIds.has(award.award_id)) fail("award duplicate id");
    if (seenTokenIds.has(award.token_id)) fail("award duplicate token");
    seenAwardIds.add(award.award_id); seenTokenIds.add(award.token_id); awardsByToken.set(award.token_id, award);
    if (award.row !== token.row || award.new_score !== token.target_score || award.prior_score !== token.target_score - 1) fail("award row/score binding");
    const authority = authorityMap.get(award.authority_receipt_id);
    if (!authority || authority.kind !== "TOKEN" || authority.token_id !== award.token_id || authority.authority_class !== token.authority_class || authority.subject !== `${contract.task}:TOKEN:${award.token_id}` || authority.decision !== "PASS") fail("award authority");
    if (!Array.isArray(award.evidence_receipt_ids) || award.evidence_receipt_ids.length !== token.required_slots.length || new Set(award.evidence_receipt_ids).size !== token.required_slots.length) fail("award evidence cardinality");
    const evidenceReceipts = award.evidence_receipt_ids.map((id) => {
      const receipt = receiptMap.get(id);
      if (!receipt || receipt.verdict !== "PASS") fail("award evidence receipt");
      return receipt;
    });
    const evidenceSlots = evidenceReceipts.map((receipt) => receipt.slot_id).sort();
    if (JSON.stringify(evidenceSlots) !== JSON.stringify([...token.required_slots].sort())) fail("award evidence slots");
    const expectedAuthorityScope = {
      token_id:award.token_id,
      evidence_receipts:evidenceReceipts.map((receipt) => ({receipt_id:receipt.receipt_id,slot_id:receipt.slot_id,artifact_sha256:receipt.artifact_sha256,exact_sha:receipt.exact_sha})),
      score_transition:{row:award.row,prior_score:award.prior_score,new_score:award.new_score,raw_delta:1}
    };
    if (JSON.stringify(authority.scope) !== JSON.stringify(expectedAuthorityScope)) fail("award authority scope");
  }
  for (const row of matrix80.rows) {
    let gap = false;
    for (const token of row.tokens) {
      if (!awardsByToken.has(token.token_id)) gap = true;
      else if (gap) fail("award cumulative order");
    }
  }
  const rawSum = raw + awards.length;
  const normalizedRounded = Math.round(rawSum / contract.current.denominator * 100);
  const receiptValues = [...receiptMap.values()];
  const gate80Closed = contract.thresholds["80"].requires.every((id) => slotState[id] === contract.receipt_contract.closed_state && receiptValues.some((receipt) => receipt.slot_id === id && receipt.verdict === "PASS"));
  const evidenceCeiling = gate80Closed ? 80 : contract.current.evidence_ceiling;
  const certifiedScore = Math.min(normalizedRounded,evidenceCeiling);
  if (claimed.raw_sum !== rawSum) fail("score raw claim");
  if (claimed.normalized_rounded !== normalizedRounded) fail("score normalized claim");
  if (claimed.gate_80_closed !== gate80Closed) fail("score gate claim");
  if (claimed.evidence_ceiling !== evidenceCeiling) fail("score ceiling claim");
  if (claimed.certified_score !== certifiedScore) fail("score certified claim");
  if (certifiedScore === 80 && (awards.length !== 27 || rawSum < 104 || !gate80Closed)) fail("score 80 incomplete");
  return {rawSum,normalizedRounded,gate80Closed,evidenceCeiling,certifiedScore};
};
const actualScore = validateAwards(contract.evidence_token_awards,receiptsById,authoritiesById,actualSlotState,contract.score_state);

const fixtureExactSha = "1d3e95e46c412634a6da95226fdafa43fb63a220";
const fixtureArtifactPath = `docs/evidence/${contract.task}/FULL-PATH-FIXTURE-SOURCE.json`;
const fixtureArtifactSha256 = "763706fcf75dc13e290ccc116474430fe5d87f24ef1768ed5e1857ad399c9c7b";
const fixtureAuthorityBase = {approved_at:"2026-08-27T00:00:00Z",source_message_id:"FIXTURE-SOURCE",source_archive_sha256:fixtureArtifactSha256,artifact_path:fixtureArtifactPath,artifact_sha256:fixtureArtifactSha256,exact_sha:fixtureExactSha};
const fixtureRegistry = Object.fromEntries(slotIds.map((id) => [id,[]]));
const fixtureAuthorities = [];
for (const id of contract.thresholds["80"].requires) {
  const dependencySlots = slots[id].depends_on.flatMap((dep) => dep === "80" ? contract.thresholds["80"].requires : [dep]);
  const receipt = {receipt_id:`fixture-receipt-${id}`,slot_id:id,artifact_path:fixtureArtifactPath,artifact_sha256:fixtureArtifactSha256,exact_sha:fixtureExactSha,evidence_tier:slots[id].tier,authority_class:slots[id].closure_authority,authority_receipt_id:`fixture-slot-authority-${id}`,dependency_receipt_ids:dependencySlots.map((dep) => `fixture-receipt-${dep}`),verdict:"PASS"};
  fixtureRegistry[id].push(receipt);
  fixtureAuthorities.push({...fixtureAuthorityBase,authority_receipt_id:`fixture-slot-authority-${id}`,kind:"SLOT",slot_id:id,authority_class:slots[id].closure_authority,subject:`${contract.task}:${id}`,scope:{receipt_id:receipt.receipt_id,slot_id:id,artifact_path:receipt.artifact_path,artifact_sha256:receipt.artifact_sha256,exact_sha:receipt.exact_sha,dependency_receipt_ids:receipt.dependency_receipt_ids},issuer:PINNED_ISSUERS[slots[id].closure_authority][0],decision:"PASS"});
}
const fixtureAuthorityMap = validateAuthorities(fixtureAuthorities,{fixture:true});
const fixtureSlotState = Object.fromEntries(slotIds.map((id) => [id,contract.thresholds["80"].requires.includes(id) ? "VERIFIED" : "OPEN"]));
const fixtureReceiptMap = validateReceiptRegistry(fixtureRegistry,fixtureAuthorityMap,fixtureSlotState);
const gateOnlyClaim = {raw_sum:77,normalized_rounded:59,gate_80_closed:true,evidence_ceiling:80,certified_score:59};
validateAwards([],fixtureReceiptMap,fixtureAuthorityMap,fixtureSlotState,gateOnlyClaim);
const expectFailure = (expected, fn) => { try { fn(); } catch (error) { if (error.message.includes(expected)) return; throw error; } fail(`negative case did not fail: ${expected}`); };
if (negativeCases.cases.length !== 6) fail("negative case count");
for (const test of negativeCases.cases) {
  const slotAuthority=fixtureAuthorityMap.get("fixture-slot-authority-A");
  if (test.id === "unknown_token") { const award={award_id:"invented",authority_receipt_id:"invented",token_id:"UNKNOWN",row:"Money safety",prior_score:9,new_score:10,evidence_receipt_ids:[]}; expectFailure(test.expected_error,()=>validateAwards([award],fixtureReceiptMap,fixtureAuthorityMap,fixtureSlotState,{...gateOnlyClaim,raw_sum:78,normalized_rounded:60})); }
  else if (test.id === "unrelated_authority_source") { const source={from:"reviewer",to:"builder",type:"PASS",task:"UNRELATED",task_id:"UNRELATED",owner_id:task.owner_id,worker_id:task.worker_id,sha:contract.baseline_sha}; expectFailure(test.expected_error,()=>validateBusAuthoritySource({...slotAuthority,kind:"SLOT"},source)); }
  else if (test.id === "owner_routing_mismatch") { const source={from:"reviewer",to:"builder",type:"PASS",task:contract.task,task_id:contract.task,owner_id:"wrong-owner",worker_id:"wrong-owner",sha:contract.baseline_sha}; expectFailure(test.expected_error,()=>validateBusAuthoritySource({...slotAuthority,kind:"SLOT"},source)); }
  else if (test.id === "builder_authored_pass") { const source={from:"builder",to:"reviewer",type:"PASS",task:contract.task,task_id:contract.task,owner_id:task.owner_id,worker_id:task.worker_id,sha:contract.baseline_sha}; expectFailure(test.expected_error,()=>validateBusAuthoritySource({...slotAuthority,kind:"SLOT"},source)); }
  else if (test.id === "raw_recompute") expectFailure(test.expected_error,()=>validateAwards([],fixtureReceiptMap,fixtureAuthorityMap,fixtureSlotState,{...gateOnlyClaim,raw_sum:78}));
  else if (test.id === "incomplete_noncompensable_gate") { const state={...fixtureSlotState,L:"OPEN"}; expectFailure(test.expected_error,()=>validateAwards([],fixtureReceiptMap,fixtureAuthorityMap,state,gateOnlyClaim)); }
  else fail(`unknown negative case ${test.id}`);
}
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
for (const name of ["RUBRIC-CONTRACT.json","SOURCE-TASK.json","AMENDED-SOURCE-TASK.json","AMENDED-SOURCE-TASK.raw.json","COMPRESSION-SOURCE-TASK.json","COMPRESSION-SOURCE-TASK.raw.json","README.md","verify.mjs","VALIDATION.json","AUTHORITY-REGISTRY.json","TRUST-STORE-REFERENCE.json","TRUST-BOOTSTRAP.json","TRUST-BOOTSTRAP.sig.base64","FOUNDER-80-DIRECTION.json","SCORE-80-POINT-MATRIX.json","NEGATIVE-CASES.json","FULL-PATH-FIXTURE-SOURCE.json","LANE-A-READONLY-ARTIFACT.json","LANE-A-COMMAND-LEDGER.md","LANE-B-READONLY-ARTIFACT.json"]) if (secret.test(fs.readFileSync(path.join(dir, name), "utf8"))) fail(`secret-like literal ${name}`);

console.log(JSON.stringify({source_rows:13,raw_sum:actualScore.rawSum,certified_score:actualScore.certifiedScore,canonical_score_delta_58_to_80:22,target_80_raw:104,minimum_raw_delta_77_to_104:27,accepted_score_80_tokens:0,accepted_score_80_combination:"NONE_CANONICAL_MAPPING_REQUIRED",c5_mandatory_gate_point_gain:"UNDEFINED_ZERO_AWARDED",noncompensable_gates_separate:true,negative_award_cases:negativeCases.cases.length,review_status:contract.review_status,review_authority:"CANONICAL_SINGLETON_INDEPENDENT_CODEX_EXACT_SHA_REVIEWER_AGENT_BUS",crypto_or_hsm_required:false,payment_canary_ready:"NO_CHEAPEST_SKU_60000_EXCEEDS_50000_CAP",pitr_required_for_80:false,slot_count:Object.keys(slots).length,receipt_registry_slots:Object.keys(contract.receipt_registry).length,receipts:receiptsById.size,authority_receipts:authoritiesById.size,lane_A_artifact:"PENDING_INDEPENDENT_REVIEW",lane_B_artifact:"PENDING_INDEPENDENT_REVIEW",lane_B_kpi_80_eligible:false,evidence_token_awards:contract.evidence_token_awards.length,production_public_real_money:"OFF",pass:true}));
