import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const workflow = fs.readFileSync(new URL("../.github/workflows/managed-mobile-evidence.yml", import.meta.url), "utf8");
const launcher = fs.readFileSync(new URL("../scripts/run-mobile-evidence-image.sh", import.meta.url), "utf8");

test("managed mobile workflow is manual, exact-SHA, staging-only, and secret-reference-only", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:\n    branches: \[main\]/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /reviewed_sha:/);
  assert.match(workflow, /github\.event_name == 'pull_request' && 'acf1fd49fadc3387c3ae6a13f711689f1e0d9397'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /git checkout --detach "\$REVIEWED_SHA"/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git cat-file -t/);
  assert.match(workflow, /git merge-base --is-ancestor "\$REVIEWED_SHA" HEAD/);
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
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /push:|schedule:/);
  assert.doesNotMatch(workflow, /MIDTRANS|DUITKU|BYTEPLUS|RESEND/);
  assert.doesNotMatch(workflow, /EVIDENCE_ENV_FILE/);
  assert.doesNotMatch(workflow, /STAGING_(?:DATABASE_URL|AUTH_SECRET|R2_[A-Z_]+):/);
  assert.match(launcher, /docker_env_args\+=\(--env "\$slot"\)/);
  assert.doesNotMatch(launcher, /docker_env_args\+=\(--env "\$slot=/);
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
  const receipt = {
    schema: "managed-mobile-auth-hydration/v1", exact_sha: sha, result: "PASS",
    runtime: { build_sha: sha, payments_live: false }, otp_provider_calls: 0, payment_generation_calls: 0,
    console_errors: [], page_errors: [], cleanup_errors: [], cleanup: { otp: true, membership: true, organization: true,
      identity_retained_with_provenance: true, net_zero: true, correction_audit_linked: true, payments: true },
    artifact_verification: { verified: true }, review_status: "PENDING_INDEPENDENT_REVIEW", points_claimed: 0,
    evidence_runner: { launch, source: { commit: sha } }, screenshots,
  };
  const manifest = { schema: "managed-mobile-auth-hydration-manifest/v1", exact_sha: sha, artifacts: [] };
  fs.writeFileSync(path.join(run, "launch-attestation.json"), JSON.stringify(launch));
  fs.writeFileSync(path.join(run, "receipt.json"), JSON.stringify(receipt));
  fs.writeFileSync(path.join(run, "manifest.json"), JSON.stringify(manifest));
  try {
    const verifier = new URL("../scripts/verify-mobile-evidence-receipt.mjs", import.meta.url).pathname;
    const verified = JSON.parse(execFileSync(process.execPath, [verifier, root, sha], { encoding: "utf8" }));
    assert.equal(verified.result, "PASS");
    fs.writeFileSync(path.join(run, "receipt.json"), JSON.stringify({ ...receipt, database_url: "postgresql://forbidden" }));
    assert.throws(() => execFileSync(process.execPath, [verifier, root, sha], { stdio: "pipe" }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
