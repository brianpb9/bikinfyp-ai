import assert from "node:assert/strict";
import fs from "node:fs";

const read=(rel)=>fs.readFileSync(new URL(rel,import.meta.url),"utf8");
const migration=read("../../../migrations/postgres/0047_candidate4_provider_runtime_authorization.sql");
const provider=read("../../../lib/providers/normal-evidence.ts");
const store=read("../../../lib/postgres/normal-evidence.ts");
const jobs=read("../../../lib/postgres/jobs.ts");
const worker=read("../../../lib/postgres/worker.ts");
const authorizer=read("../../../scripts/staging-jj-glow-candidate4-runtime-authorize.ts");
const webDocker=read("../../../Dockerfile.web");

assert.match(migration,/job_id='2c49a5c8-9465-4400-a214-159336a2c097'/);
assert.match(migration,/activation_deploy_sha='13c22bc7a3a340f0ea5f4bb0db9a905691676c77'/);
assert.match(migration,/database_binding_sha256='f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610'/);
assert.match(migration,/authorization_task_id='FINAL-POST-SWEEP-CANDIDATE-4-R3-20260901'/);
assert.match(migration,/evidence\.deploy_sha<>NEW\.activation_deploy_sha/);
assert.match(migration,/evidence\.lease_expires_at<=CURRENT_TIMESTAMP/);
assert.match(migration,/BEFORE UPDATE OR DELETE/);

assert.match(provider,/providerRuntimeSha\?: string/);
assert.match(provider,/const authorized = contract\.providerRuntimeSha \|\| contract\.deploySha/);
assert.match(provider,/assertNormalEvidenceRuntimeSha\(contract, env\.RENDER_GIT_COMMIT\)/);
assert.match(store,/LEFT JOIN normal_evidence_runtime_authorizations/);
assert.match(store,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
assert.match(store,/status:"ACCEPTED_NO_POST"/);
assert.doesNotMatch(store.slice(store.indexOf("jjGlowCandidate4RuntimePreflightNoPost")),/claimPost\(/);

assert.match(jobs,/postgresRuntimeBinding\(receiptClient\)/);
assert.match(jobs,/transactionOnClient\(receiptClient/);
assert.match(worker,/database_binding_sha256:sweep\.databaseBindingSha256/);
assert.match(worker,/candidate4_provider_runtime_preflight:candidate4ProviderRuntimePreflight/);

assert.match(authorizer,/BEGIN ISOLATION LEVEL SERIALIZABLE/);
assert.match(authorizer,/INSERT INTO normal_evidence_runtime_authorizations/);
assert.match(authorizer,/JJ_GLOW_PROVIDER_RUNTIME_AUTHORIZED_NO_POST/);
assert.match(authorizer,/lease_expires_at/);
assert.doesNotMatch(authorizer,/fetch\(|createTask|enqueueJob|claimPost|provider_tasks\s+INSERT/i);
assert.match(webDocker,/esbuild scripts\/staging-jj-glow-candidate4-runtime-authorize\.ts/);
assert.match(webDocker,/COPY --from=build[^\n]+staging-jj-glow-candidate4-runtime-authorize\.cjs/);
assert.match(webDocker,/test -f \/srv\/app\/scripts\/staging-jj-glow-candidate4-runtime-authorize\.cjs/);
assert.match(webDocker,/node --check \/srv\/app\/scripts\/staging-jj-glow-candidate4-runtime-authorize\.cjs/);

console.log("CANDIDATE_4_R3_RUNTIME_AUTHORIZATION_AND_SWEEP_BINDING_CONTRACT=PASS");
