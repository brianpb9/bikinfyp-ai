import fs from "node:fs";
import assert from "node:assert/strict";

const receipt = JSON.parse(fs.readFileSync(new URL("./RECEIPT.json", import.meta.url)));
assert.equal(receipt.task, "SCORE80-BRAND-ANTISLOP-ZERO-SPEND-20260828");
assert.equal(receipt.scope, "ZERO_SPEND_NO_SCORE_PREREQUISITE");
assert.equal(receipt.production_mutation, false);
assert.equal(receipt.provider_calls, 0);
assert.equal(receipt.spend_idr, 0);
assert.equal(receipt.public_action, false);
assert.equal(receipt.claim, "NO_SCORE");
for (const path of ["lib/brand-antislop-evidence.mjs", "scripts/verify-brand-antislop-evidence.mjs", "tests/brand-antislop-evidence.test.mjs", "tests/qcf1-immutable-bytes.test.ts", "lib/media/qc-frame.ts"]) {
  assert.ok(fs.existsSync(path), `${path} missing`);
}
process.stdout.write("SCORE80_BRAND_ANTISLOP_ZERO_SPEND_EVIDENCE=PASS\n");
