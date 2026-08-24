import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const runner = path.join(root, "scripts", "verify-duitku-sandbox.ts");
const tsx = path.join(root, "node_modules", ".bin", "tsx");

function run(overrides: Record<string, string> = {}) {
  const env = {
    ...process.env,
    RACUN_NO_DOTENV: "1",
    PAYMENT_GATEWAY: "duitku",
    DUITKU_MERCHANT_CODE: "merchant-fixture-secret",
    DUITKU_API_KEY: "api-fixture-secret",
    DUITKU_IS_PRODUCTION: "false",
    PAYMENTS_GO_LIVE: "false",
    DUITKU_SANDBOX_CALLBACK_BASE: "https://racun-ai-staging-web.onrender.com",
    DUITKU_SANDBOX_JOURNAL: path.join(root, ".agent-bus", "tmp", `must-not-execute-${process.pid}.json`),
    ...overrides,
  };
  return spawnSync(tsx, [runner], { cwd: root, env, encoding: "utf8" });
}

test("runner bawaan hanya PLAN dan tidak membocorkan credential", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(output.execution, "PLAN_ONLY");
  assert.doesNotMatch(result.stdout, /merchant-fixture-secret|api-fixture-secret/);
  assert.match(result.stdout, /"provider": "duitku"/);
  assert.match(result.stdout, /"payments_env": "sandbox"/);
  assert.match(result.stdout, /"payments_live": false/);
  assert.match(result.stdout, /"price_idr": 60000/);
});

test("runner mengunci redirect real hanya ke app-sandbox.duitku.com", () => {
  const source = fs.readFileSync(runner, "utf8");
  assert.match(source, /APPROVED_SANDBOX_REDIRECT_ORIGIN = "https:\/\/app-sandbox\.duitku\.com"/);
  assert.match(source, /redirect\.origin !== APPROVED_SANDBOX_REDIRECT_ORIGIN/);
  assert.doesNotMatch(source, /api-prod\.duitku\.com/);
  assert.ok(
    source.indexOf('state: "CREATE_ACCEPTED"') < source.indexOf("redirect.origin !== APPROVED_SANDBOX_REDIRECT_ORIGIN"),
    "CREATE_ACCEPTED journal wajib durable sebelum validasi redirect pasca-create",
  );
  assert.ok(
    source.indexOf('state: "CREATE_ACCEPTED"') < source.lastIndexOf("duitku.duitkuTransactionStatusDetailed(orderId)"),
    "CREATE_ACCEPTED journal wajib durable sebelum status query",
  );
  assert.match(source, /transactionStatus\.verification\.outcome !== "PASS"/);
  assert.match(source, /DUITKU_STATUS_VERIFICATION_HOLD/);
});

for (const [name, overrides, expected] of [
  ["production", { DUITKU_IS_PRODUCTION: "true" }, "DUITKU_IS_PRODUCTION=false"],
  ["go-live", { PAYMENTS_GO_LIVE: "true" }, "PAYMENTS_GO_LIVE harus false/absent"],
  ["gateway", { PAYMENT_GATEWAY: "midtrans" }, "PAYMENT_GATEWAY=duitku"],
  ["callback production", { DUITKU_SANDBOX_CALLBACK_BASE: "https://bikinfyp.com" }, "racun-ai-staging-web.onrender.com"],
  ["credential", { DUITKU_API_KEY: "" }, "DUITKU_API_KEY"],
] as const) {
  test(`runner fail-closed untuk ${name}`, () => {
    const result = run(overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /merchant-fixture-secret|api-fixture-secret/);
  });
}
