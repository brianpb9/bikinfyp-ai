import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("./", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, root), "utf8"));
const closure = read("OPERATIONAL-CLOSURE.json");
const decision = read("FOUNDER-DECISION.json");
const control = read("RAW-CONTROL-PLANE.json");
const health = read("RAW-HEALTH-SAMPLES.json");
const logs = read("RAW-READONLY-JOB-LOGS.json");
const lineage = read("RAW-TEMPORARY-DEPLOY-LINEAGE.json");
const exactRollback = "ee767201679ae2213c40be6f913241f372d2378a";
const exactFix = "6ac032ad8f294761d615bcfddccbd5e46b15025f";

assert.deepEqual(closure.source_receipts, ["RAW-CONTROL-PLANE.json", "RAW-HEALTH-SAMPLES.json", "RAW-READONLY-JOB-LOGS.json", "RAW-TEMPORARY-DEPLOY-LINEAGE.json"]);
const temporaryDeploy = lineage.deploys.find((deploy) => deploy.id === closure.temporary_fix_deploy.id);
const lineageRollback = lineage.deploys.find((deploy) => deploy.id === closure.rollback_deploy.id);
assert.equal(temporaryDeploy.commit.id, exactFix);
assert.equal(temporaryDeploy.status, "deactivated");
assert.equal(closure.temporary_fix_deploy.status_during_read_only_jobs, "live");
assert.equal(closure.temporary_fix_deploy.final_status_after_rollback, temporaryDeploy.status);
assert.equal(lineageRollback.commit.id, exactRollback);
assert.equal(lineageRollback.status, "live");
assert.ok(Math.abs(new Date(temporaryDeploy.updatedAt) - new Date(lineageRollback.finishedAt)) < 1000, "temporary deploy deactivation must coincide with rollback becoming live");
assert.equal(closure.temporary_fix_deploy.commit, exactFix);
assert.equal(lineage.temporary_health_capture.response.ok, true);
assert.equal(lineage.temporary_health_capture.response.intake, "open");
assert.equal(lineage.temporary_health_capture.response.payments_live, closure.temporary_fix_deploy.payments_live);
assert.equal(lineage.temporary_health_capture.response.build_sha, exactFix);
assert.equal(new Date(lineage.temporary_health_capture.observed_after).getTime(), new Date(temporaryDeploy.finishedAt).getTime());
const reviewedWindowJobIds = [closure.read_only_discovery.successful_job, closure.read_only_discovery.diagnostics_job, closure.read_only_discovery.decision_packet_job];
for (const id of reviewedWindowJobIds) {
  const job = lineage.read_only_jobs.find((entry) => entry.id === id);
  assert.equal(job.status, "succeeded");
  assert.equal(job.serviceId, lineage.scope.service_id);
  assert.ok(new Date(job.startedAt) >= new Date(temporaryDeploy.finishedAt), `${id} started before exact-fix deploy was live`);
  assert.ok(new Date(job.finishedAt) < new Date(lineageRollback.finishedAt), `${id} did not finish before rollback became live`);
}
assert.equal(control.scope.rollback_deploy_id, closure.rollback_deploy.id);
assert.equal(control.deploy.id, "dep-da9jbagn74is738a4060");
assert.equal(control.deploy.commit.id, exactRollback);
assert.equal(control.deploy.status, "live");
assert.equal(control.deploy.finishedAt, closure.rollback_deploy.finished_at);
const web = control.services.find((service) => service.id === closure.staging_service_id);
const worker = control.services.find((service) => service.id === closure.worker_service_id);
assert.equal(web.autoDeploy, "no");
assert.equal(web.suspended, "not_suspended");
assert.equal(worker.autoDeploy, "no");
assert.equal(worker.suspended, "suspended");
assert.equal(closure.staging_control_plane_after.worker_suspended, true);

assert.equal(health.samples.length, 6);
for (const [index, sample] of health.samples.entries()) {
  assert.equal(sample.sample, index + 1);
  assert.equal(sample.response.ok, true);
  assert.equal(sample.response.intake, "open");
  assert.equal(sample.response.payments_live, false);
  assert.equal(sample.response.build_sha, exactRollback);
}
assert.equal(closure.rollback_health.build_sha, exactRollback);
assert.equal(closure.rollback_health.six_consecutive_samples_exact, true);

const receipt = (id) => logs.receipts.find((entry) => entry.job_id === id);
const discovery = receipt(closure.read_only_discovery.successful_job);
const diagnostics = receipt(closure.read_only_discovery.diagnostics_job);
const founder = receipt(closure.read_only_discovery.decision_packet_job);
const noWrite = receipt(closure.no_write_proof.job);
for (const item of [discovery, diagnostics, founder, noWrite]) assert.equal(item.status, "succeeded");
assert.equal(discovery.output.mode, "READ_ONLY_DISCOVERY");
assert.equal(discovery.output.evidence_run_count, 0);
assert.equal(discovery.output.eligible_count_capped, 0);
assert.equal(discovery.output.chosen, null);
assert.equal(closure.candidate.authenticated_post_attempts, 0);
assert.equal(closure.candidate.eligible_products, discovery.output.eligible_count_capped);
for (const [receiptKey, closureKey] of [["retail_products","retail_products"],["authoritative_products","authoritative_products"],["approved_scripts","approved_scripts"],["approved_hq15_scripts","approved_hq_15s_scripts"],["personas","personas"],["funded_users","funded_users"],["fully_funded_pairs","fully_funded_pairs"]]) {
  assert.equal(diagnostics.output[receiptKey], closure.read_only_discovery[closureKey], receiptKey);
}

assert.equal(noWrite.output.mode, "READ_ONLY_NO_WRITE_PROOF");
assert.equal(noWrite.output.since, closure.no_write_proof.since);
assert.equal(noWrite.output.pass, true);
for (const key of ["evidence_runs", "jobs_created", "ledger_rows_created", "holds_created", "captures_or_releases_created", "provider_tasks_created", "payments_created", "outputs_for_new_jobs"]) {
  assert.equal(noWrite.output[key], 0, key);
  assert.equal(closure.no_write_proof[key], noWrite.output[key], key);
}

assert.equal(founder.output.mode, "READ_ONLY_FOUNDER_DECISION_PACKET");
assert.equal(founder.output.near_miss_count, 4);
assert.equal(decision.near_miss_product_count, founder.output.near_miss_count);
assert.equal(decision.approved_hq_15s_script_count, 7);
assert.equal(founder.output.products.flatMap((p) => p.script_ids).length, 7);
assert.deepEqual(decision.products.map((p) => p.product_id), founder.output.products.map((p) => p.product_id));
for (const [index, product] of decision.products.entries()) {
  const raw = founder.output.products[index];
  assert.equal(product.product_name, raw.product_name);
  assert.deepEqual(product.script_ids, raw.script_ids);
  assert.deepEqual(product.product_type, raw.product_type);
  assert.deepEqual(product.category_disposition, raw.category_disposition);
  assert.deepEqual(product.missing_truth, raw.missing_truth);
  assert.deepEqual(product.missing_truth, ["PRODUCT_TYPE_CONFIRMATION", "CATEGORY_DISPOSITION", "REFERENCE_ASSET_AUTHORIZATION"]);
  assert.equal(product.reference.count, raw.references.count);
  assert.equal(product.reference.bytes_present, raw.references.checks[0].bytes_present);
  assert.equal(product.reference.sidecar_present, raw.references.checks[0].sidecar_present);
  assert.equal(product.reference.authorized_all, raw.references.authorized_all);
}
assert.equal(closure.provider_requests, 0);
assert.equal(closure.spend_idr, 0);
assert.equal(closure.publication_count, 0);
console.log("PASS raw receipts cross-check operational closure and Founder decision packet");
