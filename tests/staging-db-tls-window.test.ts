import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  allowListIsExact,
  closeWindow,
  exactRunnerAllowList,
  externalTlsDatabaseUrl,
  parsePublicIPv4,
  PRODUCTION_POSTGRES_ID,
  PUBLIC_IPV4_SOURCE,
  STAGING_EXTERNAL_HOST,
  STAGING_POSTGRES_ID,
  validateTarget,
} from "../scripts/managed-staging-db-tls-window.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/managed-mobile-evidence.yml", import.meta.url), "utf8");
const control = fs.readFileSync(new URL("../scripts/managed-staging-db-tls-window.mjs", import.meta.url), "utf8");

test("only an actual globally routable IPv4 becomes one exact /32 rule", () => {
  assert.equal(parsePublicIPv4("8.8.8.8\n"), "8.8.8.8");
  assert.deepEqual(exactRunnerAllowList("8.8.8.8"), [
    { source: "8.8.8.8/32", description: "temporary-github-runner-one-run" },
  ]);
  for (const rejected of ["0.0.0.0/0", "203.0.113.0/24", "203.0.113.17", "10.0.0.1", "127.0.0.1", "::1", "AzureCloud", "github-meta"])
    assert.throws(() => parsePublicIPv4(rejected));
  assert.equal(PUBLIC_IPV4_SOURCE, "https://checkip.amazonaws.com/");
  assert.doesNotMatch(control, /api\.github\.com\/meta|AzureCloud|0\.0\.0\.0\/0/);
});

test("Render control is hard-bound to staging and cannot address production", () => {
  assert.equal(validateTarget(STAGING_POSTGRES_ID), STAGING_POSTGRES_ID);
  assert.throws(() => validateTarget(PRODUCTION_POSTGRES_ID), /production target forbidden/);
  assert.throws(() => validateTarget("dpg-unknown"), /unexpected target/);
  assert.match(workflow, new RegExp(`STAGING_RENDER_POSTGRES_ID: ${STAGING_POSTGRES_ID}`));
  assert.doesNotMatch(workflow, new RegExp(PRODUCTION_POSTGRES_ID));
});

test("database URL is forced onto exact external hostname with verify-full", () => {
  const url = externalTlsDatabaseUrl(`postgresql://fixture-user:fixture-password@${STAGING_EXTERNAL_HOST}/fixture-db?sslmode=disable&ssl=0`);
  assert.equal(url.hostname, STAGING_EXTERNAL_HOST);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.has("ssl"), false);
  assert.throws(() => externalTlsDatabaseUrl("postgresql://u:p@internal-host/db"));
  assert.match(control, /SELECT 1 AS one/);
  assert.match(control, /SELECT current_database\(\)/);
  assert.match(control, /SELECT current_user/);
  assert.match(control, /FROM pg_stat_ssl WHERE pid = pg_backend_pid\(\)/);
  assert.match(control, /tls\.checkServerIdentity\(url\.hostname, certificate\)/);
  assert.match(control, /stream\?\.authorized === true/);
  assert.doesNotMatch(control, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(control, /process\.stdout\.write\([^)]*(?:token|password|MANAGED_DATABASE_URL|STAGING_RENDER_API_KEY)/i);
});

test("allow-list readback must be byte-for-byte one /32 or empty", () => {
  const expected = exactRunnerAllowList("8.8.8.8");
  assert.equal(allowListIsExact(expected, expected), true);
  assert.equal(allowListIsExact([], []), true);
  assert.equal(allowListIsExact([{ ...expected[0], source: "203.0.113.0/24" }], expected), false);
  assert.equal(allowListIsExact([...expected, ...expected], expected), false);
});

test("workflow preserves R2, gates E2E on TLS preflight, then always cleans before upload", () => {
  const r2 = workflow.indexOf("      - name: Preflight staging R2 write-read-delete round trip");
  const open = workflow.indexOf("      - name: Open temporary exact-runner staging database TLS window");
  const runner = workflow.indexOf("      - name: Run and sanitize provider-free staging evidence with managed secret injection");
  const cleanup = workflow.indexOf("      - name: Always close temporary staging database TLS window");
  const upload = workflow.indexOf("      - name: Upload sanitized immutable receipt bundle");
  assert.ok(r2 > 0 && r2 < open && open < runner && runner < cleanup && cleanup < upload);
  const openStep = workflow.slice(open, runner);
  const runnerStep = workflow.slice(runner, cleanup);
  const cleanupStep = workflow.slice(cleanup, upload);
  assert.match(openStep, /STAGING_RENDER_API_KEY: \$\{\{ secrets\.STAGING_RENDER_API_KEY \}\}/);
  assert.match(openStep, /MANAGED_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.doesNotMatch(runnerStep, /secrets\.STAGING_DATABASE_URL|STAGING_RENDER_API_KEY/);
  assert.match(cleanupStep, /if: always\(\) && steps\.staging_db_tls_window\.outcome != 'skipped'/);
  assert.match(cleanupStep, /managed-staging-db-tls-window\.mjs close/);
});

test("cleanup failure is terminal and empty readback is mandatory", async () => {
  const calls: string[] = [];
  await assert.rejects(closeWindow({
    ...process.env,
    STAGING_RENDER_POSTGRES_ID: STAGING_POSTGRES_ID,
    STAGING_RENDER_API_KEY: "fixture-token",
  }, {
    replaceAllowList: async (_id: string, _token: string, value: unknown[]) => {
      calls.push(`patch:${JSON.stringify(value)}`);
    },
    waitForAllowList: async () => {
      calls.push("readback");
      throw new Error("not empty");
    },
  }), /cleanup failed/);
  assert.deepEqual(calls, ["patch:[]", "readback"]);
  assert.match(control, /cleanup_readback_empty/);
  assert.match(control, /throw new Error\("managed staging DB TLS window cleanup failed"\)/);
});
