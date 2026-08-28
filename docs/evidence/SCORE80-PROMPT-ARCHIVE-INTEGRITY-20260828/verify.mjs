import fs from "node:fs";
import assert from "node:assert/strict";

const receipt = JSON.parse(fs.readFileSync(new URL("./RECEIPT.json", import.meta.url)));
assert.equal(receipt.task, "SCORE80-PROMPT-ARCHIVE-INTEGRITY-20260828");
assert.equal(receipt.scope, "ZERO_SPEND_READ_ONLY_CORRELATION_PREREQUISITE");
assert.equal(receipt.production_mutation, false);
assert.equal(receipt.provider_calls, 0);
assert.equal(receipt.spend_idr, 0);
assert.equal(receipt.claim, "NO_SCORE");
assert.deepEqual(receipt.correlation, ["prompt", "model", "verdict", "artifact", "provider_request"]);
for (const path of ["lib/prompt-archive-trace.mjs", "scripts/prompt-archive-trace.mjs", "tests/prompt-archive-trace.test.mjs"]) {
  assert.ok(fs.existsSync(path), `${path} missing`);
}
process.stdout.write("SCORE80_PROMPT_ARCHIVE_INTEGRITY_EVIDENCE=PASS\n");

