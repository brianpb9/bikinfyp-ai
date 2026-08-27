import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const source = fs.readFileSync(new URL("../scripts/managed-mobile-auth-hydration.ts", import.meta.url), "utf8");
const evidenceDockerfile = fs.readFileSync(new URL("../Dockerfile.mobile-evidence", import.meta.url), "utf8");
const evidenceBuild = fs.readFileSync(new URL("../scripts/build-mobile-evidence-image.sh", import.meta.url), "utf8");

test("managed mobile runner is exact-SHA, 375px, provider-free, and cleanup-bound", () => {
  assert.match(source, /EVIDENCE_SOURCE_SHA[\s\S]*EXPECTED_SHA/);
  assert.match(source, /health\.build_sha, EXPECTED_SHA/);
  assert.match(source, /RACUN_DEPLOY_ENV[\s\S]*staging/);
  assert.match(source, /width: 375, height: 812/);
  assert.match(source, /width: 375, height: 520/);
  assert.match(source, /page\.route\("\*\*\/api\/\*\*"/);
  assert.match(source, /request\.method\(\) === "GET"/);
  assert.match(source, /route\.abort\("blockedbyclient"\)/);
  assert.match(source, /\/api\/auth\/verify-otp/);
  assert.match(source, /otpStarted/);
  assert.match(source, /releaseOtpRoute/);
  assert.match(source, /wrong\.status\(\), 401/);
  assert.match(source, /correct\.status\(\), 200/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /keyboard\.press\("Escape"\)/);
  assert.match(source, /document\.activeElement === element/);
  assert.match(source, /message\.type\(\) !== "error"/);
  assert.match(source, /'koreksi'/);
  assert.match(source, /history_rows_preserved/);
  assert.match(source, /'credit\.koreksi'/);
  assert.match(source, /entity='credit_ledger'[\s\S]*entity_id=l\.id/);
  assert.match(source, /BEGIN[\s\S]*INSERT INTO credit_ledger[\s\S]*INSERT INTO audit_log[\s\S]*COMMIT/);
  assert.doesNotMatch(source, /DELETE FROM (credit_ledger|audit_log|users)/);
  assert.match(source, /DELETE FROM otp_codes/);
  assert.match(source, /DELETE FROM org_members/);
  assert.match(source, /DELETE FROM organizations/);
  assert.match(source, /DELETE FROM org_members WHERE id=\$1/);
  assert.match(source, /DELETE FROM organizations WHERE id=\$1/);
  assert.match(source, /RETAINED TEST IDENTITY/);
  assert.match(source, /onboarded_at/);
  assert.match(source, /INSERT INTO organizations[\s\S]*INSERT INTO org_members/);
  assert.match(source, /SELECT id FROM users WHERE email=\$1/);
  assert.match(source, /cleanupErrors/);
  assert.match(source, /private-r2/);
  assert.match(source, /config\.storageMode, "r2"/);
  assert.match(source, /storage\.stat/);
  assert.match(source, /storage\.get/);
  assert.match(source, /R2 readback SHA mismatch/);
  assert.match(source, /managed-mobile-auth-hydration-manifest\/v1/);
  assert.match(source, /manifest_key/);
  assert.match(source, /manifest_sha256/);
  assert.match(source, /PENDING_ARTIFACT_VERIFICATION/);
  assert.match(source, /FAIL_ARTIFACT_VERIFICATION/);
  assert.match(source, /artifact_verification = \{ verified: true/);
  assert.match(source, /consoleErrors\.push\(message\.text\(\)/);
  assert.match(source, /receipt\.console_errors = consoleErrors/);
  assert.ok(source.indexOf('cleanupStep("pool"') < source.indexOf("const cleanup = receipt.cleanup"),
    "pool close outcome must precede final cleanup result");
  assert.match(source, /sha256/);
  assert.match(source, /PENDING_INDEPENDENT_REVIEW/);
  assert.match(source, /points_claimed: 0/);
  assert.match(source, /fullPage: false/);
  assert.match(source, /visualViewport/);
  assert.match(source, /focused_visible/);
  assert.match(source, /payments_live, false/);
  for (const endpoint of ["/api/scripts/generate", "/api/dashboard/campaign/generate", "/api/dashboard/campaign/confirm",
    "/api/dashboard/matrix", "/api/jobs", "/api/promo/jobs", "/api/credits/checkout", "/api/credits/topup"]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(source, /createDuitkuInvoice|createMidtransTransaction|enqueueJob/);
});

test("mobile evidence runner has a truthful exact-SHA external image contract", () => {
  assert.match(evidenceDockerfile, /ARG EVIDENCE_SOURCE_SHA/);
  assert.match(evidenceDockerfile, /org\.opencontainers\.image\.revision=\$EVIDENCE_SOURCE_SHA/);
  assert.match(evidenceDockerfile, /npx playwright install --with-deps chromium/);
  assert.match(evidenceDockerfile, /playwright['"]\)\.chromium\.executablePath/);
  assert.match(evidenceDockerfile, /ENTRYPOINT \["npx", "tsx", "scripts\/managed-mobile-auth-hydration\.ts"\]/);
  assert.match(evidenceDockerfile, /git clone \/tmp\/source\.bundle/);
  assert.match(evidenceDockerfile, /rev-parse HEAD\^\{tree\}/);
  assert.match(evidenceDockerfile, /cmp \/tmp\/source\.tar \/tmp\/from-bundle\.tar/);
  assert.match(evidenceDockerfile, /USER node[\s\S]*test -w "\$RECEIPT_DIR"[\s\S]*\.node-write-smoke/);
  assert.match(evidenceBuild, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(evidenceBuild, /git archive --format=tar HEAD/);
  assert.match(evidenceBuild, /git bundle create/);
  assert.match(evidenceBuild, /docker image inspect --format '\{\{\.Id\}\}'/);
});

test("source content attestation verifies bytes and fails after mutation", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mobile-evidence-source-"));
  try {
    fs.writeFileSync(path.join(dir,"source.txt"),"exact bytes\n");
    fs.copyFileSync(new URL("../scripts/verify-mobile-evidence-source.mjs",import.meta.url),path.join(dir,"verify.mjs"));
    const manifest=path.join(dir,".evidence-source-attestation.json");
    const commit="a".repeat(40),tree="b".repeat(40);
    execFileSync(process.execPath,[new URL("../scripts/create-mobile-evidence-attestation.mjs",import.meta.url).pathname,
      dir,commit,tree,manifest]);
    const env={...process.env,EVIDENCE_SOURCE_SHA:commit,EVIDENCE_SOURCE_TREE:tree};
    const verified=JSON.parse(execFileSync(process.execPath,["verify.mjs"],{cwd:dir,env,encoding:"utf8"}));
    assert.equal(verified.commit,commit);assert.equal(verified.tree,tree);assert.equal(verified.files,2);
    fs.writeFileSync(path.join(dir,"source.txt"),"mutated\n");
    assert.throws(()=>execFileSync(process.execPath,["verify.mjs"],{cwd:dir,env,stdio:"pipe"}));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
