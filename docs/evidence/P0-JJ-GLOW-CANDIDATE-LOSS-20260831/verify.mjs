import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const incident = JSON.parse(await readFile(new URL("INCIDENT.json", root), "utf8"));
const backlog = JSON.parse(await readFile(new URL("BACKLOG-CONTRACT.json", root), "utf8"));

assert.equal(incident.schema, "bikinfyp.staging-candidate-loss-incident/v1");
assert.equal(incident.accepted_implementation.sha, "952276cae06be50b124894f611c85a8bce218d9d");
assert.equal(incident.accepted_implementation.review, "PASS");
assert.equal(incident.accepted_implementation.health.build_sha, incident.accepted_implementation.sha);
assert.equal(incident.worker_control_plane.state, "suspended");
assert.deepEqual(incident.worker_control_plane.suspenders, ["user"]);
assert.equal(incident.accepted_implementation.lineage_endpoint_http, 409);
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
assert.equal(backlog.mutation_performed, false);
assert.equal(backlog.provider_called, false);
assert.equal(backlog.secret_value_recorded, false);

const serialized = JSON.stringify({ incident, backlog });
assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{12,}/);
assert.doesNotMatch(serialized, /AKIA[0-9A-Z]{16}/);

console.log("JJ_GLOW_CANDIDATE_LOSS_EVIDENCE=PASS");
