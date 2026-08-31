import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const contract = JSON.parse(read("PRE-CREATION-CONTRACT.json"));
const admission = read("../../../lib/staging-jj-glow-exact-admission.ts");
const runner = read("../../../scripts/staging-jj-glow-candidate.cjs");
const freeze = read("../../../scripts/staging-jj-glow-final-evidence.ts");
const provider = read("../../../lib/providers/normal-evidence.ts");

assert.equal(contract.task, "FINAL-POST-SWEEP-CANDIDATE-4-20260901");
assert.equal(contract.candidate_ordinal, 4);
assert.equal(contract.max_canonical_candidates_created, 4);
assert.equal(contract.candidate_5_authorized, false);
assert.equal(contract.lease_kind, "ACTIVE_EVIDENCE_LEASE");
assert.equal(contract.lease_ttl_seconds, 21600);
assert.match(admission, /candidate4Authority[\s\S]*final_candidate_ordinal === 4[\s\S]*max_canonical_candidates_created === 4/);
assert.match(runner, /JJ_GLOW_CANDIDATE_4_AUTHORITY_REQUIRED/);
assert.match(runner, /candidate #4 historical preflight invariant mismatch/);
assert.match(runner, /prior\[0\]\.state !== "REFUNDED"/);
assert.match(runner, /prior\[0\]\.candidate4_scripts !== 0/);
assert.match(runner, /const expectedTotal = CANDIDATE_4_MODE \? 2 : 1/);
assert.match(freeze, /JJ_GLOW_EVIDENCE_CANDIDATE_ORDINAL === "4"/);
assert.match(freeze, /normalEvidenceLeaseWindow\(now\)/);
assert.match(provider, /JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK/);
console.log("CANDIDATE_4_PRE_CREATION_CONTRACT=PASS");
