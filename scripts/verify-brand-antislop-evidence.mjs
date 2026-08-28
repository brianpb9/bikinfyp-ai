#!/usr/bin/env node
import fs from "node:fs";
import { verifyBrandAntiSlopEvidence } from "../lib/brand-antislop-evidence.mjs";

const [file, archiveRoot, trustPolicyFile] = process.argv.slice(2);
if (!file || !archiveRoot || !trustPolicyFile) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", reason: "usage: verify-brand-antislop-evidence <packet.json> <job-archive-root> <trust-policy.json>" })}\n`);
  process.exitCode = 1;
} else {
  try {
    const packet = JSON.parse(fs.readFileSync(file, "utf8"));
    const policy = JSON.parse(fs.readFileSync(trustPolicyFile, "utf8"));
    const runtime = {
      readJobArchive(key) {
        if (!key.startsWith(`jobs/${packet.job_id}/evidence/`) || key.includes("..")) throw new Error("JOB_ARCHIVE_KEY_INVALID");
        return fs.readFileSync(new URL(key, `file://${archiveRoot.replace(/\/$/, "")}/`));
      },
      trustedActorRoles: policy.trusted_actor_roles,
      approvedExtractors: policy.approved_extractors,
      approvedEvaluatorIdentities: policy.approved_evaluator_identities,
    };
    process.stdout.write(`${JSON.stringify(verifyBrandAntiSlopEvidence(packet, runtime))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAIL", reason: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
