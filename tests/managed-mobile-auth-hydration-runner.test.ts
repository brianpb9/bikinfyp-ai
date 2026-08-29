import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const source = fs.readFileSync(new URL("../scripts/managed-mobile-auth-hydration.ts", import.meta.url), "utf8");
const evidenceDockerfile = fs.readFileSync(new URL("../Dockerfile.mobile-evidence", import.meta.url), "utf8");
const evidenceBuild = fs.readFileSync(new URL("../scripts/build-mobile-evidence-image.sh", import.meta.url), "utf8");
const evidenceLaunch = fs.readFileSync(new URL("../scripts/run-mobile-evidence-image.sh", import.meta.url), "utf8");

test("managed mobile runner is exact-SHA, 375px, provider-free, and cleanup-bound", () => {
  assert.match(source, /EVIDENCE_SOURCE_SHA[\s\S]*EXPECTED_RUNNER_SHA/);
  assert.match(source, /EXPECTED_SHA[\s\S]*health\.build_sha/);
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
  assert.match(source, /Network\.requestWillBeSent/);
  assert.match(source, /networkRequestId/);
  assert.match(source, /classifyManagedBrowserDiagnostic/);
  assert.match(source, /pendingFailureFixtures\.push\("wrong-otp"\)/);
  assert.match(source, /wrong OTP wajib punya satu explicit CDP request-id correlation/);
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
  assert.match(source, /receipt\.pending\.json/);
  assert.match(source, /receipt\.final\.json/);
  assert.match(source, /putAndVerify\(terminalReceiptKey,terminalBytes/);
  assert.match(source, /draft_receipt_sha256/);
  assert.match(source, /terminal_receipt_sha256/);
  assert.match(source, /if\(receipt\.result!=="PASS"\)process\.exitCode=1/);
  assert.match(source, /consoleErrors\.push\(diagnostic\.text\)/);
  assert.match(source, /receipt\.console_errors = consoleErrors/);
  assert.match(source, /browser_error_classification/);
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
  assert.match(evidenceBuild, /EXPECTED_EVIDENCE_RUNNER_SHA/);
  assert.match(evidenceBuild, /test "\$sha" = "\$expected_runner"/);
  assert.match(evidenceBuild, /git archive --format=tar HEAD/);
  assert.match(evidenceBuild, /git bundle create/);
  assert.match(evidenceBuild, /docker image inspect --format '\{\{\.Id\}\}'/);
  assert.match(evidenceLaunch, /docker create[\s\S]*"\$image_id"/);
  assert.match(evidenceLaunch, /docker container inspect --format '\{\{\.Image\}\}'/);
  assert.match(evidenceLaunch, /docker container inspect --format '\{\{\.Config\.Image\}\}'/);
  assert.match(evidenceLaunch, /test "\$inspected_image" = "\$image_id"/);
  assert.match(evidenceLaunch, /test "\$config_image" = "\$image_id"/);
  assert.match(evidenceLaunch, /test "\$source_sha" = "\$expected_runner_sha"/);
  assert.match(evidenceLaunch, /EXPECTED_EVIDENCE_RUNNER_SHA=\$expected_runner_sha/);
  assert.match(evidenceLaunch, /mobile-evidence-launch\/v1/);
  assert.match(evidenceLaunch, /EVIDENCE_RECEIPT_EXPORT_DIR/);
  assert.match(evidenceLaunch, /chmod 0555 "\$launch_dir"/);
  assert.match(evidenceLaunch, /docker cp "\$container_id:\/srv\/receipts\/\." "\$export_stage\/"/);
  assert.match(evidenceLaunch, /receipt\.exact_sha!==appSha/);
  assert.match(evidenceLaunch, /evidence\?\.source\?\.commit!==runnerSha/);
  assert.match(evidenceLaunch, /launch\?\.source_sha!==runnerSha/);
  assert.match(evidenceLaunch, /launch\?\.container_id!==containerId/);
  assert.match(evidenceLaunch, /retained container \$container_id/);
  assert.match(evidenceLaunch, /docker start --attach "\$container_id"/);
});

test("launcher gives non-root evidence access and exports receipts before removing a failed container", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mobile-evidence-launcher-"));
  try {
    const bin=path.join(dir,"bin"),state=path.join(dir,"state"),receipts=path.join(dir,"export");
    fs.mkdirSync(bin);fs.mkdirSync(state);
    const docker=path.join(bin,"docker");
    fs.writeFileSync(docker,`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_STATE/log"
image_id="sha256:$(printf '%064d' 0 | tr 0 a)"
container_id="$(printf '%064d' 0 | tr 0 b)"
if test "$1 $2" = "image inspect"; then
  case "$4" in
    '{{.Id}}') printf '%s\\n' "$image_id" ;;
    *org.opencontainers.image.revision*) printf '%040d\\n' 0 | tr 0 c ;;
    *ai.hdrv.source.tree*) printf '%040d\\n' 0 | tr 0 d ;;
  esac
elif test "$1" = create; then
  previous=""
  for argument in "$@"; do
    if test "$previous" = --mount; then printf '%s\\n' "$argument" | sed -E 's/^type=bind,src=([^,]+),.*/\\1/' > "$FAKE_DOCKER_STATE/launch-dir"; fi
    previous="$argument"
  done
  printf '%s\\n' "$container_id"
elif test "$1 $2" = "container inspect"; then
  printf '%s\\n' "$image_id"
elif test "$1" = start; then
  launch_dir="$(cat "$FAKE_DOCKER_STATE/launch-dir")"
  node -e 'const fs=require("fs"),d=process.argv[1],f=d+"/attestation.json";const mode=p=>(fs.statSync(p).mode&0o777).toString(8);const a=JSON.parse(fs.readFileSync(f,"utf8"));fs.writeFileSync(process.env.FAKE_DOCKER_STATE+"/access",mode(d)+":"+mode(f)+":"+a.schema)' "$launch_dir"
  exit 19
elif test "$1" = cp; then
  if test "\${FAKE_DOCKER_CP_FAIL:-false}" = true; then exit 23; fi
  destination="\${@: -1}"
  mkdir -p "$destination"
  if test "\${FAKE_DOCKER_EMPTY_COPY:-false}" != true; then
    receipt_sha="cccccccccccccccccccccccccccccccccccccccc"
    if test "\${FAKE_DOCKER_STALE_RECEIPT:-false}" = true; then receipt_sha="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; fi
    printf '%s\\n' "{\\\"exact_sha\\\":\\\"$receipt_sha\\\",\\\"result\\\":\\\"FAIL_ARTIFACT_VERIFICATION\\\",\\\"evidence_runner\\\":{\\\"source\\\":{\\\"commit\\\":\\\"cccccccccccccccccccccccccccccccccccccccc\\\"},\\\"launch\\\":{\\\"source_sha\\\":\\\"cccccccccccccccccccccccccccccccccccccccc\\\",\\\"container_id\\\":\\\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\\",\\\"image_id\\\":\\\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\",\\\"config_image\\\":\\\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\"}}}" > "$destination/receipt.json"
  fi
elif test "$1" = rm; then
  :
else
  printf '%s\\n' "unexpected fake docker command: $*" >&2
  exit 98
fi
`,{mode:0o755});
    const envFile=path.join(dir,"evidence.env");fs.writeFileSync(envFile,"");
    const env={...process.env,PATH:`${bin}:${process.env.PATH}`,FAKE_DOCKER_STATE:state,
      EVIDENCE_IMAGE:"fixture:latest",EXPECTED_APP_SHA:"c".repeat(40),EXPECTED_EVIDENCE_RUNNER_SHA:"c".repeat(40),EVIDENCE_ENV_FILE:envFile,
      EVIDENCE_RECEIPT_EXPORT_DIR:receipts};
    assert.throws(()=>execFileSync(new URL("../scripts/run-mobile-evidence-image.sh",import.meta.url).pathname,
      [],{env:{...env,EXPECTED_EVIDENCE_RUNNER_SHA:"e".repeat(40)},stdio:"pipe"}));
    assert.doesNotMatch(fs.readFileSync(path.join(state,"log"),"utf8"),/^create /m,
      "unreviewed runner SHA must fail before container creation");
    fs.writeFileSync(path.join(state,"log"),"");
    assert.throws(()=>execFileSync(new URL("../scripts/run-mobile-evidence-image.sh",import.meta.url).pathname,
      [],{env,stdio:"pipe"}));
    assert.equal(fs.readFileSync(path.join(state,"access"),"utf8"),"555:444:mobile-evidence-launch/v1");
    const exportedRun=path.join(receipts,"b".repeat(64));
    assert.equal(JSON.parse(fs.readFileSync(path.join(exportedRun,"receipt.json"),"utf8")).result,
      "FAIL_ARTIFACT_VERIFICATION");
    const log=fs.readFileSync(path.join(state,"log"),"utf8");
    assert.ok(log.indexOf("cp ") < log.indexOf("rm -f "),"receipts must be exported before removal");
    fs.writeFileSync(path.join(state,"log"),"");
    assert.throws(()=>execFileSync(new URL("../scripts/run-mobile-evidence-image.sh",import.meta.url).pathname,
      [],{env:{...env,FAKE_DOCKER_CP_FAIL:"true",EVIDENCE_RECEIPT_EXPORT_DIR:path.join(dir,"failed-export")},stdio:"pipe"}));
    const failedExportLog=fs.readFileSync(path.join(state,"log"),"utf8");
    assert.match(failedExportLog,/^cp /m);
    assert.doesNotMatch(failedExportLog,/^rm -f /m,"container must remain available when export fails");
    fs.writeFileSync(path.join(state,"log"),"");
    assert.throws(()=>execFileSync(new URL("../scripts/run-mobile-evidence-image.sh",import.meta.url).pathname,
      [],{env:{...env,FAKE_DOCKER_EMPTY_COPY:"true",EVIDENCE_RECEIPT_EXPORT_DIR:path.join(dir,"empty-export")},stdio:"pipe"}));
    const emptyExportLog=fs.readFileSync(path.join(state,"log"),"utf8");
    assert.match(emptyExportLog,/^cp /m);
    assert.doesNotMatch(emptyExportLog,/^rm -f /m,"container must remain when copied export has no current receipt");
    fs.writeFileSync(path.join(state,"log"),"");
    assert.throws(()=>execFileSync(new URL("../scripts/run-mobile-evidence-image.sh",import.meta.url).pathname,
      [],{env:{...env,FAKE_DOCKER_STALE_RECEIPT:"true",EVIDENCE_RECEIPT_EXPORT_DIR:path.join(dir,"stale-export")},stdio:"pipe"}));
    const staleExportLog=fs.readFileSync(path.join(state,"log"),"utf8");
    assert.doesNotMatch(staleExportLog,/^rm -f /m,"container must remain when receipt is bound to another SHA");
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
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
