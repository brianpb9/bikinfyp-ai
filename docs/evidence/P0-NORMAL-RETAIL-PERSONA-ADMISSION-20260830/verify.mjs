import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("./", import.meta.url);
const closure = JSON.parse(fs.readFileSync(new URL("OPERATIONAL-CLOSURE.json", root), "utf8"));
const decision = JSON.parse(fs.readFileSync(new URL("FOUNDER-DECISION.json", root), "utf8"));

assert.equal(closure.rollback_health.build_sha, "ee767201679ae2213c40be6f913241f372d2378a");
assert.equal(closure.rollback_health.six_consecutive_samples_exact, true);
assert.equal(closure.staging_control_plane_after.worker_suspended, true);
assert.equal(closure.candidate.authenticated_post_attempts, 0);
assert.equal(closure.candidate.eligible_products, 0);
assert.equal(closure.no_write_proof.pass, true);
for (const key of ["evidence_runs", "jobs_created", "ledger_rows_created", "holds_created", "captures_or_releases_created", "provider_tasks_created", "payments_created", "outputs_for_new_jobs"]) {
  assert.equal(closure.no_write_proof[key], 0, key);
}
assert.equal(closure.provider_requests, 0);
assert.equal(closure.spend_idr, 0);
assert.equal(closure.publication_count, 0);
assert.equal(decision.approved_hq_15s_script_count, 7);
assert.equal(decision.near_miss_product_count, 4);
assert.equal(new Set(decision.products.map((p) => p.product_id)).size, 4);
assert.equal(decision.products.flatMap((p) => p.script_ids).length, 7);
for (const product of decision.products) {
  assert.deepEqual(product.missing_truth, ["PRODUCT_TYPE_CONFIRMATION", "CATEGORY_DISPOSITION", "REFERENCE_ASSET_AUTHORIZATION"]);
  assert.equal(product.reference.bytes_present, true);
  assert.equal(product.reference.sidecar_present, false);
  assert.equal(product.reference.authorized_all, false);
}
console.log("PASS operational closure and Founder decision packet");
