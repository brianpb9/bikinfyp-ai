import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const incident = JSON.parse(await readFile(new URL("INCIDENT.json", root), "utf8"));
const backlog = JSON.parse(await readFile(new URL("BACKLOG-CONTRACT.json", root), "utf8"));
const manifest = JSON.parse(await readFile(new URL("SOURCE-MANIFEST.json", root), "utf8"));
const receipts = {};
for (const [name, expectedSha] of Object.entries(manifest.receipts)) {
  const bytes = await readFile(new URL(name, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedSha, `${name} digest`);
  receipts[name] = JSON.parse(bytes.toString("utf8"));
}

const review = receipts["RAW-R12-REVIEW-DEPLOY.json"];
const control = receipts["RAW-CONTROL-PLANE-ENDPOINT.json"];
const postgres = receipts["RAW-POSTGRES.json"];
const r2 = receipts["RAW-R2.json"];
const redis = receipts["RAW-REDIS.json"];
const timeline = receipts["RAW-TIMELINE-RECOVERY.json"];
const authority = receipts["RAW-AUTHORITY.json"];
const secretReceipt = receipts["RAW-SECRET-BINDING.json"];

assert.equal(manifest.schema, "bikinfyp.incident-source-manifest/v1");
assert.equal(Object.keys(manifest.receipts).length, 8);

const pass = review.sources.find((source) => source.kind === "canonical_agent_bus_message");
const deploy = review.sources.find((source) => source.kind === "render_deploy_readback");
const health = review.sources.find((source) => source.kind === "http_health_readback");
assert.equal(pass.type, "PASS");
assert.equal(pass.sha, deploy.commit_id);
assert.equal(deploy.commit_id, health.response.build_sha);
assert.equal(deploy.status, "live");
assert.equal(health.response.ok, true);
assert.equal(health.response.payments_live, false);

const worker = control.sources.find((source) => source.kind === "render_service_readback");
const endpoint = control.sources.find((source) => source.kind === "authenticated_http_readback");
assert.equal(worker.suspended, "suspended");
assert.deepEqual(worker.suspenders, ["user"]);
assert.equal(endpoint.http_status, 409);
assert.equal(endpoint.body.code, "STAGING_LINEAGE_UNAVAILABLE");
assert.match(endpoint.matching_service_log, /sole exact candidate required/);

const pgCounts = postgres.sources.find((source) => source.render_job_id === "job-daad5edg1s2s73cr85gg");
const pgTrace = postgres.sources.find((source) => source.render_job_id === "job-daad6pe7bikc7383qlb0");
assert.equal(pgCounts.product_count, 1);
assert.equal(pgCounts.script_count, 0);
assert.equal(pgCounts.product_job_count, 0);
assert.equal(pgCounts.exact_candidate_count, 0);
assert.equal(pgTrace.ledger_append_only, true);
assert.deepEqual(pgTrace.recovered_job_ids, []);
assert.equal(pgTrace.candidate_hold_rows, 0);
assert.equal(pgTrace.candidate_audit_rows, 0);
assert.equal(pgTrace.candidate_local_persona_rows, 0);
assert.equal(pgTrace.retained_ledger_rows[0].id, "jj-glow-candidate-credit-grant-20260831");
assert.equal(r2.source.found, 0);
assert.ok(r2.source.checks.every((check) => check.result === "NoSuchKey"));

const queue = redis.sources.find((source) => source.render_job_id === "job-daad8te7bikc73840teg");
const runtime = redis.sources.find((source) => source.render_job_id === "job-daad9dhsrm7s73ekmon0");
const events = redis.sources.find((source) => source.render_job_id === "job-daad9nm7bikc73843b40");
const stream = redis.sources.find((source) => source.render_job_id === "job-daad9tlg1s2s73critig");
assert.ok(Object.values(queue.counts).every((count) => count === 0));
assert.equal(queue.candidate_window_job_rows, 0);
assert.ok(runtime.uptime_in_seconds > 15 * 24 * 60 * 60);
assert.equal(runtime.evicted_keys, 0);
assert.deepEqual(runtime.queue_key_suffixes, ["events", "id", "meta"]);
assert.equal(events.event_count, 0);
assert.ok(stream.event_stream_length > 0);
assert.ok(BigInt(stream.last_entry.stream_id.split("-")[0]) < BigInt(events.range[0].split("-")[0]));

assert.equal(timeline.independent_committed_observations.at(-1).completed_at, timeline.loss_window.after);
assert.equal(timeline.first_absence.created_at, timeline.loss_window.before);
assert.ok(Date.parse(timeline.loss_window.after) < Date.parse(timeline.loss_window.before));
assert.equal(timeline.control_plane_window_readback.one_off_jobs_between_last_presence_and_first_absence, 0);
assert.equal(timeline.control_plane_window_readback.web_deploys_between_last_presence_and_first_absence, 0);
assert.ok(Object.values(timeline.retained_app_job_id_sources).every((present) => present === false));

const maxDirective = authority.directives.find((directive) => directive.key === "MAX_CANONICAL_CANDIDATES_CREATED");
const replacementDirective = authority.directives.find((directive) => directive.key === "replacement_candidate_increment");
const grokDirective = authority.directives.find((directive) => directive.key === "SECONDARY_GENERATION_PROVIDER");
assert.equal(maxDirective.value, 1);
assert.equal(maxDirective.status, "consumed");
assert.equal(replacementDirective.status, "not_authorized");
assert.equal(grokDirective.value, "GROK_IMAGINE");
assert.equal(grokDirective.status, "approved_backlog_contract_only");
assert.equal(authority.provider_post_authorized, false);
assert.equal(authority.secret_entry_receipt_source_sha256, "65befa4a4eb85b20f9286be498f3a2e2ea907327b97da55314123ec4ae202d6e");
assert.equal(authority.embedded_sanitized_copy, "RAW-SECRET-BINDING.json");
assert.equal(authority.embedded_sanitized_copy_sha256, manifest.receipts[authority.embedded_sanitized_copy]);
assert.equal(secretReceipt.secret_value_observed, false);
assert.equal(secretReceipt.required_human_actions.length, 2);
assert.deepEqual(secretReceipt.required_bindings, {
  github_staging: false,
  render_staging_web: false,
  render_staging_worker: true,
});

const founderDecisionRequired = maxDirective.status === "consumed"
  && replacementDirective.status === "not_authorized"
  && pgCounts.exact_candidate_count === 0
  && Object.values(timeline.retained_app_job_id_sources).every((present) => present === false);
assert.equal(founderDecisionRequired, true);

assert.equal(incident.schema, "bikinfyp.staging-candidate-loss-incident/v1");
assert.equal(incident.accepted_implementation.sha, "952276cae06be50b124894f611c85a8bce218d9d");
assert.equal(incident.accepted_implementation.sha, pass.sha);
assert.equal(incident.accepted_implementation.review, "PASS");
assert.equal(incident.accepted_implementation.health.build_sha, incident.accepted_implementation.sha);
assert.equal(incident.worker_control_plane.state, "suspended");
assert.deepEqual(incident.worker_control_plane.suspenders, ["user"]);
assert.equal(incident.accepted_implementation.lineage_endpoint_http, 409);
assert.equal(incident.accepted_implementation.lineage_endpoint_http, endpoint.http_status);
assert.equal(incident.postgres_readback.exact_candidate_count, 0);
assert.equal(incident.postgres_readback.candidate_hold_rows, 0);
assert.equal(incident.postgres_readback.append_only_ledger_trigger_present, true);
assert.equal(incident.r2_readback.lineage_keys_found, 0);
assert.equal(incident.redis_readback.evicted_keys, 0);
assert.equal(incident.redis_readback.candidate_window_event_count, 0);
assert.equal(incident.redis_readback.older_events_retained, true);
assert.equal(incident.redis_readback.candidate_was_enqueued_to_current_queue, false);
assert.equal(incident.candidate.app_job_id_recoverable, false);
assert.equal(incident.candidate.max_canonical_candidates_created, 1);
assert.equal(incident.candidate.canonical_candidates_created, 1);
assert.equal(incident.candidate.replacement_authorized, false);
assert.equal(incident.classification.incident_state, "FOUNDER_DECISION_REQUIRED");
assert.equal(incident.classification.incident_state, founderDecisionRequired ? "FOUNDER_DECISION_REQUIRED" : "UNSUPPORTED");
assert.match(incident.authority_required.decision, /from 1 to 2/);
for (const value of Object.values(incident.safety)) assert.ok(value === false || value === 0);

assert.equal(backlog.schema, "bikinfyp.post-lane-backlog-contract/v1");
assert.deepEqual(backlog.approved_configuration_intent, {
  key: "SECONDARY_GENERATION_PROVIDER",
  value: "GROK_IMAGINE",
  phase: "POST_JJ_GLOW_CANDIDATE_LANE",
  scope: "backlog_contract_only",
});
assert.equal(backlog.implementation_status, "NOT_STARTED");
assert.equal(backlog.provider_post_gate.allowed_now, false);
assert.equal(backlog.provider_post_gate.required_human_actions.length, 2);
const secret = backlog.provider_post_gate.required_human_actions[1];
assert.equal(secret.canonical_env_name, "BYTEPLUS_ARK_API_KEY");
assert.deepEqual(secret.required_bindings, {
  github_staging: false,
  render_staging_web: false,
  render_staging_worker: true,
});
assert.equal(secret.worker.destination, "https://dashboard.render.com/worker/srv-d9n28ue417fc73ch2b60");
assert.equal(secret.worker.navigation, "Environment -> Environment Variables");
assert.equal(secret.worker.save_mode, "Save only, then resume/deploy this worker only");
assert.equal(secret.web.destination, "https://dashboard.render.com/web/srv-d9n28tijnfac73a87lt0");
assert.equal(secret.web.operation, "delete");
assert.equal(secret.web.save_mode, "Save and deploy");
assert.equal(secret.production_mutation_authorized, false);
assert.deepEqual(secret.required_bindings, secretReceipt.required_bindings);
assert.equal(secret.worker.destination, secretReceipt.required_human_actions[0].destination);
assert.equal(secret.web.destination, secretReceipt.required_human_actions[1].destination);
assert.equal(backlog.mutation_performed, false);
assert.equal(backlog.provider_called, false);
assert.equal(backlog.secret_value_recorded, false);

for (const receipt of Object.values(receipts)) {
  if ("mutation" in receipt) assert.equal(receipt.mutation, false);
}
assert.equal(review.secret_values_recorded, false);
assert.equal(control.authentication_material_recorded, false);
assert.equal(postgres.raw_database_identifiers_recorded, false);
assert.equal(r2.r2_credentials_recorded, false);
assert.equal(redis.redis_url_recorded, false);
assert.equal(secretReceipt.provider_called, false);
assert.equal(secretReceipt.production_mutation_authorized, false);

const serialized = JSON.stringify({ incident, backlog, receipts });
assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{12,}/);
assert.doesNotMatch(serialized, /AKIA[0-9A-Z]{16}/);

console.log("JJ_GLOW_CANDIDATE_LOSS_EVIDENCE=PASS");
