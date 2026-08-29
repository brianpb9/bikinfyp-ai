import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  allowListIsExact,
  closeWindow,
  createSignalGuard,
  exactRunnerAllowList,
  externalTlsDatabaseUrl,
  openWindow,
  parsePublicIPv4,
  postgresShape,
  PRODUCTION_POSTGRES_ID,
  PUBLIC_IPV4_SOURCE,
  renderRequest,
  STAGING_POSTGRES_ID,
  validateTarget,
  verifyDatabaseTls,
} from "../scripts/managed-staging-db-tls-window.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/managed-mobile-evidence.yml", import.meta.url), "utf8");
const control = fs.readFileSync(new URL("../scripts/managed-staging-db-tls-window.mjs", import.meta.url), "utf8");
const metadata = {
  id: STAGING_POSTGRES_ID,
  name: "racun-ai-staging-postgres",
  databaseName: "fixture-db",
  databaseUser: "fixture-user",
  region: "singapore",
  ipAllowList: [],
};
const externalHost = `${STAGING_POSTGRES_ID}.singapore-postgres.render.com`;
const managedUrl = `postgresql://fixture-user:fixture-password@${externalHost}/fixture-db`;
const env = {
  ...process.env,
  STAGING_RENDER_POSTGRES_ID: STAGING_POSTGRES_ID,
  STAGING_RENDER_API_KEY: "fixture-token",
  MANAGED_DATABASE_URL: managedUrl,
};
const dbPass = {
  transaction_read_only_verified: true,
  select_one_verified: true,
  current_database_verified: true,
  current_user_verified: true,
  pg_stat_ssl_verified: true,
  certificate_hostname_verified: true,
};

function mockedDeps(calls: string[], overrides: Record<string, unknown> = {}) {
  return {
    readPostgres: async () => { calls.push("read:metadata"); return metadata; },
    discoverPublicIPv4: async () => "8.8.8.8",
    replaceAllowList: async (_id: string, _token: string, value: unknown[]) => {
      calls.push(`patch:${JSON.stringify(value)}`);
    },
    waitForAllowList: async (_id: string, _token: string, value: unknown[]) => {
      calls.push(`readback:${JSON.stringify(value)}`);
    },
    verifyDatabaseTls: async () => { calls.push("tls"); return dbPass; },
    runEvidence: async () => { calls.push("evidence"); },
    ...overrides,
  };
}

test("only an actual globally routable IPv4 becomes one exact cidrBlock /32", () => {
  assert.equal(parsePublicIPv4("8.8.8.8\n"), "8.8.8.8");
  assert.deepEqual(exactRunnerAllowList("8.8.8.8"), [
    { cidrBlock: "8.8.8.8/32", description: "temporary-github-runner-one-run" },
  ]);
  for (const rejected of ["0.0.0.0/0", "203.0.113.0/24", "203.0.113.17", "10.0.0.1", "127.0.0.1", "::1", "AzureCloud", "github-meta"])
    assert.throws(() => parsePublicIPv4(rejected));
  assert.equal(PUBLIC_IPV4_SOURCE, "https://checkip.amazonaws.com/");
  assert.doesNotMatch(control, /api\.github\.com\/meta|AzureCloud|0\.0\.0\.0\/0/);
});

test("provider schema and exact readback reject source, broad, extra, or duplicate entries", () => {
  const expected = exactRunnerAllowList("8.8.8.8");
  assert.deepEqual(postgresShape({ ...metadata, ipAllowList: expected }).ipAllowList, expected);
  assert.equal(allowListIsExact(expected, expected), true);
  assert.equal(allowListIsExact([], []), true);
  assert.equal(allowListIsExact([{ source: "8.8.8.8/32", description: expected[0].description }], expected), false);
  assert.equal(allowListIsExact([{ cidrBlock: "8.8.8.0/24", description: expected[0].description }], expected), false);
  assert.equal(allowListIsExact([{ ...expected[0], providerExtra: true }], expected), false);
  assert.equal(allowListIsExact([...expected, ...expected], expected), false);
});

test("Render cleanup transport retries network, 429 Retry-After, and 5xx before success", async () => {
  const waits: number[] = [];
  let call = 0;
  const result = await renderRequest(STAGING_POSTGRES_ID, "fixture-token", {
    method: "PATCH",
    body: JSON.stringify({ ipAllowList: [] }),
  }, {
    attempts: 4,
    baseDelayMs: 100,
    maxDelayMs: 500,
    sleep: async (ms: number) => { waits.push(ms); },
    fetchImpl: async () => {
      call++;
      if (call === 1) throw new Error("network");
      if (call === 2) return { ok: false, status: 429, headers: { get: () => "2" } };
      if (call === 3) return { ok: false, status: 503, headers: { get: () => null } };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => metadata };
    },
  });
  assert.equal(result.id, STAGING_POSTGRES_ID);
  assert.deepEqual(waits, [100, 500, 400]);

  let rejectedCalls = 0;
  await assert.rejects(renderRequest(STAGING_POSTGRES_ID, "fixture-token", {}, {
    attempts: 6,
    sleep: async () => {},
    fetchImpl: async () => { rejectedCalls++; return { ok: false, status: 401, headers: { get: () => null } }; },
  }), /rejected/);
  assert.equal(rejectedCalls, 1);
});

test("Render control is hard-bound to staging and authoritative database identity", () => {
  assert.equal(validateTarget(STAGING_POSTGRES_ID), STAGING_POSTGRES_ID);
  assert.throws(() => validateTarget(PRODUCTION_POSTGRES_ID), /production target forbidden/);
  assert.throws(() => validateTarget("dpg-unknown"), /unexpected target/);
  assert.throws(() => postgresShape({ ...metadata, id: PRODUCTION_POSTGRES_ID }));
  assert.throws(() => postgresShape({ ...metadata, databaseName: "" }));
  assert.match(workflow, new RegExp(`STAGING_RENDER_POSTGRES_ID: ${STAGING_POSTGRES_ID}`));
  assert.doesNotMatch(workflow, new RegExp(PRODUCTION_POSTGRES_ID));
});

test("database URL binds authoritative host, database, user, and verify-full", () => {
  const url = externalTlsDatabaseUrl(`${managedUrl}?sslmode=disable&ssl=0`, metadata);
  assert.equal(url.hostname, externalHost);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.has("ssl"), false);
  assert.throws(() => externalTlsDatabaseUrl("postgresql://fixture-user:p@internal-host/fixture-db", metadata));
  assert.throws(() => externalTlsDatabaseUrl(`postgresql://fixture-user:p@${externalHost}/wrong-db`, metadata));
  assert.throws(() => externalTlsDatabaseUrl(`postgresql://wrong-user:p@${externalHost}/fixture-db`, metadata));
});

test("TLS probe uses fixed SELECT order inside READ ONLY and always ROLLBACK", async () => {
  const queries: string[] = [];
  let released = false;
  let ended = false;
  const client = {
    connection: { stream: { encrypted: true, authorized: true, authorizationError: null,
      getPeerCertificate: () => ({}) } },
    query: async (sql: string) => {
      queries.push(sql);
      if (sql === "SELECT 1 AS one") return { rowCount: 1, rows: [{ one: 1 }] };
      if (sql.includes("current_database")) return { rowCount: 1, rows: [{ current_database: metadata.databaseName }] };
      if (sql.includes("current_user")) return { rowCount: 1, rows: [{ current_user: metadata.databaseUser }] };
      if (sql.includes("pg_stat_ssl")) return { rowCount: 1, rows: [{ ssl: true }] };
      return { rowCount: 0, rows: [] };
    },
    release: () => { released = true; },
  };
  const result = await verifyDatabaseTls(new URL(managedUrl), metadata,
    (() => ({ connect: async () => client, end: async () => { ended = true; } })) as never, () => undefined);
  assert.deepEqual(queries, [
    "BEGIN TRANSACTION READ ONLY",
    "SELECT 1 AS one",
    "SELECT current_database() AS current_database",
    "SELECT current_user AS current_user",
    "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    "ROLLBACK",
  ]);
  assert.deepEqual(result, dbPass);
  assert.equal(released, true);
  assert.equal(ended, true);
});

test("successful same-process window executes evidence once then cleans before return", async () => {
  const calls: string[] = [];
  const result = await openWindow(env, mockedDeps(calls));
  assert.equal(result.evidence_executed_once, true);
  assert.equal(result.cleanup_readback_empty, true);
  assert.deepEqual(calls, [
    "read:metadata",
    `patch:${JSON.stringify(exactRunnerAllowList("8.8.8.8"))}`,
    `readback:${JSON.stringify(exactRunnerAllowList("8.8.8.8"))}`,
    "tls",
    "evidence",
    "patch:[]",
    "readback:[]",
  ]);
});

test("failures after PATCH, readback, TLS, identity, or E2E all clean and fail terminal", async () => {
  for (const stage of ["readback", "tls", "identity", "evidence"] as const) {
    const calls: string[] = [];
    let firstReadback = true;
    const overrides: Record<string, unknown> = {};
    if (stage === "readback") overrides.waitForAllowList = async (_id: string, _token: string, value: unknown[]) => {
      calls.push(`readback:${JSON.stringify(value)}`);
      if (firstReadback) { firstReadback = false; throw new Error("provider mismatch"); }
    };
    if (stage === "tls") overrides.verifyDatabaseTls = async () => { calls.push("tls"); throw new Error("tls failed"); };
    if (stage === "identity") overrides.readPostgres = async () => {
      calls.push("read:metadata"); return { ...metadata, databaseUser: "authoritative-other-user" };
    };
    if (stage === "evidence") overrides.runEvidence = async () => { calls.push("evidence"); throw new Error("E2E failed"); };
    await assert.rejects(openWindow(env, mockedDeps(calls, overrides)), /window run failed/);
    assert.ok(calls.includes("patch:[]"), `${stage} must PATCH empty`);
    assert.ok(calls.includes("readback:[]"), `${stage} must read back empty`);
    assert.equal(calls.includes("evidence"), stage === "evidence");
  }
});

test("cleanup failure is terminal and secondary close also requires empty readback", async () => {
  const calls: string[] = [];
  await assert.rejects(openWindow(env, mockedDeps(calls, {
    waitForAllowList: async (_id: string, _token: string, value: unknown[]) => {
      calls.push(`readback:${JSON.stringify(value)}`);
      if (value.length === 0) throw new Error("not empty");
    },
  })), /window run failed/);
  assert.ok(calls.includes("patch:[]"));

  const secondary: string[] = [];
  await assert.rejects(closeWindow(env, {
    ...mockedDeps(secondary),
    waitForAllowList: async () => { secondary.push("readback"); throw new Error("not empty"); },
  }), /cleanup failed/);
  assert.deepEqual(secondary, ["patch:[]", "readback"]);
});

test("signal guard aborts child and cleans once before terminal exit", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const guard = createSignalGuard(async () => { calls.push("cleanup"); }, controller,
    (code: number) => { calls.push(`exit:${code}`); });
  guard.install();
  await guard.handle();
  await guard.handle();
  guard.disarm();
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(calls, ["cleanup", "exit:1"]);
});

test("workflow preserves R2, runs E2E inside opener finally, then secondary cleanup before upload", () => {
  const r2 = workflow.indexOf("      - name: Preflight staging R2 write-read-delete round trip");
  const run = workflow.indexOf("      - name: Run provider-free evidence inside temporary staging database TLS window");
  const cleanup = workflow.indexOf("      - name: Always close temporary staging database TLS window");
  const upload = workflow.indexOf("      - name: Upload sanitized immutable receipt bundle");
  assert.ok(r2 > 0 && r2 < run && run < cleanup && cleanup < upload);
  const runStep = workflow.slice(run, cleanup);
  const cleanupStep = workflow.slice(cleanup, upload);
  assert.match(runStep, /STAGING_RENDER_API_KEY: \$\{\{ secrets\.STAGING_RENDER_API_KEY \}\}/);
  assert.match(runStep, /MANAGED_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.match(runStep, /managed-staging-db-tls-window\.mjs run/);
  assert.match(cleanupStep, /if: always\(\) && steps\.staging_db_tls_window\.outcome != 'skipped'/);
  assert.match(cleanupStep, /managed-staging-db-tls-window\.mjs close/);
  assert.doesNotMatch(control, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(control, /process\.stdout\.write\([^)]*(?:token|password|MANAGED_DATABASE_URL|STAGING_RENDER_API_KEY)/i);
});
