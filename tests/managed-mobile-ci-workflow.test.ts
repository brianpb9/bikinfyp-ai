import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const workflow = fs.readFileSync(new URL("../.github/workflows/managed-mobile-evidence.yml", import.meta.url), "utf8");
const ciWorkflow = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const launcher = fs.readFileSync(new URL("../scripts/run-mobile-evidence-image.sh", import.meta.url), "utf8");
const r2Preflight = fs.readFileSync(new URL("../scripts/preflight-staging-r2.mjs", import.meta.url), "utf8");

test("managed mobile workflow is manual, exact-SHA, staging-only, and secret-reference-only", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:\n    branches: \[main\]/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /reviewed_sha:/);
  assert.match(workflow, /REVIEWED_SHA: acf1fd49fadc3387c3ae6a13f711689f1e0d9397/);
  assert.match(workflow, /test "\$REQUESTED_SHA" = "\$REVIEWED_SHA"/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /git checkout --detach "\$REVIEWED_SHA"/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git cat-file -t/);
  assert.match(workflow, /ref: acf1fd49fadc3387c3ae6a13f711689f1e0d9397/);
  assert.match(workflow, /path: reviewed-bundle/);
  assert.match(workflow, /path: reviewed-bundle[\s\S]*sparse-checkout: \/Dockerfile\.mobile-evidence/);
  assert.match(workflow, /sparse-checkout-cone-mode: false/);
  assert.match(workflow, /working-directory: reviewed-bundle[\s\S]*test "\$\(git rev-parse HEAD\)" = "\$REVIEWED_SHA"/);
  assert.doesNotMatch(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /EVIDENCE_SOURCE_SHA/);
  assert.match(workflow, /org\.opencontainers\.image\.revision/);
  assert.match(workflow, /ai\.hdrv\.source\.tree/);
  assert.match(workflow, /EVIDENCE_INHERIT_STAGING_ENV: "1"/);
  for (const slot of ["DATABASE_URL", "AUTH_SECRET", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    assert.ok(workflow.includes(`${slot}: \${{ secrets.STAGING_${slot} }}`));
  }
  assert.match(workflow, /BASE: https:\/\/racun-ai-staging-web\.onrender\.com/);
  assert.match(workflow, /RACUN_DEPLOY_ENV: staging/);
  assert.match(workflow, /STORAGE_MODE: r2/);
  assert.match(workflow, /verify-mobile-evidence-receipt\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node|upload-artifact)@v\d/);
  assert.doesNotMatch(workflow, /push:|schedule:/);
  assert.doesNotMatch(workflow, /MIDTRANS|DUITKU|BYTEPLUS|RESEND/);
  assert.doesNotMatch(workflow, /EVIDENCE_ENV_FILE/);
  const fullJob = workflow.slice(workflow.indexOf("  exact-sha-mobile-evidence:"));
  assert.match(fullJob, /STAGING_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}[\s\S]*validate-staging-database-secret-contract\.mjs/);
  assert.doesNotMatch(fullJob, /STAGING_(?:AUTH_SECRET|R2_[A-Z_]+):/);
  assert.match(launcher, /docker_env_args\+=\(--env "\$slot"\)/);
  assert.doesNotMatch(launcher, /docker_env_args\+=\(--env "\$slot=/);
  const prJob = workflow.slice(workflow.indexOf("  pr-static-validation:"), workflow.indexOf("  staging-database-secret-contract:"));
  assert.doesNotMatch(prJob, /environment:|secrets\.|EVIDENCE_INHERIT_STAGING_ENV|bash control\/scripts\/run-mobile-evidence-image\.sh/);
  assert.doesNotMatch(prJob, /managed-mobile-auth-hydration-runner\.test\.ts/);
});

test("managed R2 preflight runs before the full runner on the exact reviewed image", () => {
  const preflightAt = workflow.indexOf("      - name: Preflight staging R2 write-read-delete round trip");
  const runnerAt = workflow.indexOf("      - name: Run provider-free evidence inside temporary staging database TLS window");
  assert.ok(preflightAt > 0 && runnerAt > preflightAt);
  const step = workflow.slice(preflightAt, runnerAt);
  assert.match(step, /RACUN_DEPLOY_ENV: staging/);
  assert.match(step, /"\$EVIDENCE_IMAGE_DIGEST"/);
  assert.match(step, /preflight-staging-r2\.mjs,dst=\/srv\/evidence\/scripts\/preflight-staging-r2\.mjs,readonly/);
  assert.match(step, /--read-only/);
  assert.match(step, /--cap-drop ALL/);
  for (const slot of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    assert.ok(step.includes(`${slot}: \${{ secrets.STAGING_${slot} }}`));
    assert.match(step, new RegExp(`--env ${slot}(?:\\s|\\\\)`));
    assert.doesNotMatch(step, new RegExp(`--env ["']?${slot}=`));
  }
});

test("secret-bearing run and close share a locked control dependency bootstrap", () => {
  const job = workflow.slice(workflow.indexOf("  exact-sha-mobile-evidence:"));
  const setupAt = job.indexOf("      - name: Set up pinned Node runtime for trusted control");
  const installAt = job.indexOf("      - name: Install locked trusted control dependencies without lifecycle scripts");
  const runAt = job.indexOf("node control/scripts/managed-staging-db-tls-window.mjs run");
  const closeAt = job.indexOf("node control/scripts/managed-staging-db-tls-window.mjs close");
  assert.ok(setupAt > 0 && setupAt < installAt && installAt < runAt && runAt < closeAt);
  const bootstrap = job.slice(setupAt, runAt);
  assert.match(bootstrap, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(bootstrap, /node-version: "22"/);
  assert.match(bootstrap, /cache-dependency-path: control\/package-lock\.json/);
  assert.match(bootstrap, /working-directory: control\n        run: npm ci --ignore-scripts/);
  assert.equal((job.match(/npm ci --ignore-scripts/g) ?? []).length, 1);
});

test("R2 preflight is fail-closed, cleans up in finally, and emits booleans only", () => {
  assert.match(r2Preflight, /EXPECTED_STAGING_BUCKET_SHA256 = "[0-9a-f]{64}"/);
  assert.match(r2Preflight, /EXPECTED_STAGING_ENDPOINT_SHA256 = "[0-9a-f]{64}"/);
  assert.match(r2Preflight, /finally \{/);
  assert.match(r2Preflight, /DeleteObjectCommand/);
  assert.match(r2Preflight, /HeadObjectCommand/);
  assert.match(r2Preflight, /cleanup_absent_verified/);
  assert.doesNotMatch(r2Preflight, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(r2Preflight, /process\.stdout\.write\([^)]*(?:R2_|bucket|endpoint|key)/i);
});

test("catalog debt remains visible without contradicting its documented non-gate status", () => {
  const catalogJob = ciWorkflow.slice(ciWorkflow.indexOf("  catalog-debt-audit:"));
  assert.match(catalogJob, /id: catalog-debt[\s\S]*continue-on-error: true[\s\S]*npm run audit:script-catalog/);
  assert.match(catalogJob, /if: steps\.catalog-debt\.outcome == 'failure'/);
  assert.match(catalogJob, /::warning title=Catalog debt remains::/);
});

test("receipt verifier accepts a sanitized exact-SHA bundle and rejects a connection secret", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-ci-receipt-"));
  const run = path.join(root, "a".repeat(64));
  fs.mkdirSync(run);
  const sha = "b".repeat(40);
  const image = `sha256:${"c".repeat(64)}`;
  const screenshots = Array.from({ length: 6 }, (_, index) => {
    const name = `0${index}-fixture.png`;
    const bytes = Buffer.from(`png-${index}`);
    fs.writeFileSync(path.join(run, name), bytes);
    return { name, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), private_key: `managed/${sha}/${name}` };
  });
  const launch = { schema: "mobile-evidence-launch/v1", container_id: "a".repeat(64), image_id: image,
    config_image: image, source_sha: sha, source_tree: "d".repeat(40) };
  const draftKey = `managed/${sha}/receipt.pending.json`;
  const manifestKey = `managed/${sha}/manifest.json`;
  const draftSha = "e".repeat(64);
  const manifest = { schema: "managed-mobile-auth-hydration-manifest/v1", exact_sha: sha, artifacts: [
    ...screenshots.map((item) => ({ key: item.private_key, sha256: item.sha256, bytes: item.bytes, content_type: "image/png" })),
    { key: draftKey, sha256: draftSha, bytes: 1234, content_type: "application/json" },
  ] };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const receipt = {
    schema: "managed-mobile-auth-hydration/v1", exact_sha: sha, result: "PASS",
    runtime: { build_sha: sha, payments_live: false }, otp_provider_calls: 0, payment_generation_calls: 0,
    console_errors: [], page_errors: [], cleanup_errors: [], cleanup: { otp: true, membership: true, organization: true,
      identity_retained_with_provenance: true, net_zero: true, correction_audit_linked: true, payments: true },
    artifact_verification: { verified: true, manifest_key: manifestKey,
      manifest_sha256: crypto.createHash("sha256").update(manifestBytes).digest("hex"),
      draft_receipt_key: draftKey, draft_receipt_sha256: draftSha },
    artifact_manifest: { manifest_key: manifestKey, receipt_key: draftKey },
    review_status: "PENDING_INDEPENDENT_REVIEW", points_claimed: 0,
    evidence_runner: { launch, source: { commit: sha } }, screenshots,
  };
  fs.writeFileSync(path.join(run, "launch-attestation.json"), JSON.stringify(launch));
  fs.writeFileSync(path.join(run, "receipt.json"), JSON.stringify(receipt));
  fs.writeFileSync(path.join(run, "manifest.json"), manifestBytes);
  try {
    const verifier = new URL("../scripts/verify-mobile-evidence-receipt.mjs", import.meta.url).pathname;
    const managedEnv = { ...process.env, DATABASE_URL: "managed-db-value", AUTH_SECRET: "managed-auth-value",
      R2_ENDPOINT: "managed-endpoint-value", R2_BUCKET: "managed-bucket-value",
      R2_ACCESS_KEY_ID: "managed-access-value", R2_SECRET_ACCESS_KEY: "managed-secret-value" };
    const verified = JSON.parse(execFileSync(process.execPath, [verifier, root, sha], { encoding: "utf8", env: managedEnv }));
    assert.equal(verified.result, "PASS");
    fs.writeFileSync(path.join(run, "receipt.json"), JSON.stringify({ ...receipt, database_url: "postgresql://forbidden" }));
    assert.throws(() => execFileSync(process.execPath, [verifier, root, sha], { stdio: "pipe", env: managedEnv }));
    fs.writeFileSync(path.join(run, "receipt.json"), JSON.stringify({ ...receipt, harmless_note: managedEnv.AUTH_SECRET }));
    assert.throws(() => execFileSync(process.execPath, [verifier, root, sha], { stdio: "pipe", env: managedEnv }));
    fs.writeFileSync(path.join(run, "receipt.json"), JSON.stringify(receipt));
    fs.writeFileSync(path.join(run, "unexpected.txt"), managedEnv.DATABASE_URL);
    assert.throws(() => execFileSync(process.execPath, [verifier, root, sha], { stdio: "pipe", env: managedEnv }));
    fs.rmSync(path.join(run, "unexpected.txt"));
    fs.symlinkSync(path.join(run, "receipt.json"), path.join(run, "unexpected-link.json"));
    assert.throws(() => execFileSync(process.execPath, [verifier, root, sha], { stdio: "pipe", env: managedEnv }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
