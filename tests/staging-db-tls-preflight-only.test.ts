import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  exactRunnerAllowList,
  STAGING_DATABASE_PRINCIPAL,
  STAGING_POSTGRES_ID,
} from "../scripts/managed-staging-db-tls-window.mjs";
import { runTlsPreflight } from "../scripts/run-staging-database-tls-preflight.mjs";

const source = fs.readFileSync(new URL("../scripts/run-staging-database-tls-preflight.mjs", import.meta.url), "utf8");
const metadata = {
  id: STAGING_POSTGRES_ID,
  name: "racun-ai-staging-postgres",
  databaseName: "racun_staging",
  databaseUser: "racun_ai_staging_postgres_user",
  region: "singapore",
  ipAllowList: [],
};
const externalHost = `${STAGING_POSTGRES_ID}.singapore-postgres.render.com`;
const env = {
  ...process.env,
  STAGING_RENDER_POSTGRES_ID: STAGING_POSTGRES_ID,
  STAGING_RENDER_API_KEY: "fixture-render-token",
  STAGING_DATABASE_EXPECTED_USER: STAGING_DATABASE_PRINCIPAL,
  MANAGED_DATABASE_URL: `postgresql://${STAGING_DATABASE_PRINCIPAL}:fixture-password@${externalHost}:5432/${metadata.databaseName}?sslmode=verify-full`,
};
const dbPass = {
  transaction_read_only_verified: true,
  select_one_verified: true,
  current_database_verified: true,
  current_user_verified: true,
  role_not_superuser_verified: true,
  role_no_create_role_verified: true,
  role_no_create_database_verified: true,
  role_no_replication_verified: true,
  role_no_bypass_rls_verified: true,
  pg_stat_ssl_verified: true,
  certificate_hostname_verified: true,
};

function deps(calls: string[], overrides: Record<string, unknown> = {}) {
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
    emitReceipt: () => {},
    ...overrides,
  };
}

test("preflight-only opens one exact window, proves TLS principal, cleans, and has no E2E hook", async () => {
  const calls: string[] = [];
  const receipt = await runTlsPreflight(env, deps(calls));
  assert.equal(receipt.preflight_only, true);
  assert.equal(receipt.current_user_verified, true);
  assert.equal(receipt.role_no_bypass_rls_verified, true);
  assert.equal(receipt.evidence_executed, false);
  assert.equal(receipt.cleanup_readback_empty, true);
  assert.deepEqual(calls, [
    "read:metadata",
    `patch:${JSON.stringify(exactRunnerAllowList("8.8.8.8"))}`,
    `readback:${JSON.stringify(exactRunnerAllowList("8.8.8.8"))}`,
    "tls",
    "patch:[]",
    "readback:[]",
  ]);
  assert.doesNotMatch(source, /runEvidence|run-mobile-evidence|EVIDENCE_|docker|spawn\s*\(/);
});

test("preflight-only cleanup is unconditional after window mutation or TLS failure", async () => {
  for (const stage of ["readback", "tls"] as const) {
    const calls: string[] = [];
    let firstReadback = true;
    const overrides: Record<string, unknown> = {};
    if (stage === "readback") overrides.waitForAllowList = async (_id: string, _token: string, value: unknown[]) => {
      calls.push(`readback:${JSON.stringify(value)}`);
      if (firstReadback) { firstReadback = false; throw new Error("not converged"); }
    };
    if (stage === "tls") overrides.verifyDatabaseTls = async () => { calls.push("tls"); throw new Error("TLS failed"); };
    await assert.rejects(runTlsPreflight(env, deps(calls, overrides)), /TLS preflight failed/);
    assert.ok(calls.includes("patch:[]"), `${stage} must close allow-list`);
    assert.ok(calls.includes("readback:[]"), `${stage} must prove empty allow-list`);
  }
});

test("preflight-only rejects missing or noncanonical expected user before any dependency call", async () => {
  for (const configured of [undefined, "racun_staging", "racun_ai_production_postgres_user"]) {
    const calls: string[] = [];
    await assert.rejects(runTlsPreflight({ ...env, STAGING_DATABASE_EXPECTED_USER: configured }, deps(calls)),
      /TLS preflight failed/);
    assert.deepEqual(calls, []);
  }
});

test("preflight-only rejects PostgreSQL query overrides or wrong port before any dependency call", async () => {
  for (const databaseUrl of [
    `${env.MANAGED_DATABASE_URL}&host=evil.example&user=racun_staging`,
    `${env.MANAGED_DATABASE_URL}&port=6543`,
    env.MANAGED_DATABASE_URL.replace(":5432/", ":6543/"),
    `${env.MANAGED_DATABASE_URL}&sslmode=verify-full`,
    env.MANAGED_DATABASE_URL.replace("sslmode=verify-full", "SSLMODE=verify-full"),
  ]) {
    const calls: string[] = [];
    await assert.rejects(runTlsPreflight({ ...env, MANAGED_DATABASE_URL: databaseUrl }, deps(calls)),
      /TLS preflight failed/);
    assert.deepEqual(calls, []);
  }
});
