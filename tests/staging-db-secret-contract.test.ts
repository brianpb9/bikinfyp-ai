import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { parse as parsePgConnectionString } from "pg-connection-string";
import {
  PRODUCTION_DATABASE_HOST,
  STAGING_DATABASE_EXPECTED_USER,
  STAGING_DATABASE_HOST,
  STAGING_DATABASE_NAME,
  validateStagingDatabaseSecretContract,
} from "../scripts/validate-staging-database-secret-contract.mjs";

const source = fs.readFileSync(new URL("../scripts/validate-staging-database-secret-contract.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/managed-mobile-evidence.yml", import.meta.url), "utf8");
const secret = "fixture-contract-password-never-print";
const validUrl = `postgresql://${STAGING_DATABASE_EXPECTED_USER}:${secret}@${STAGING_DATABASE_HOST}:5432/${STAGING_DATABASE_NAME}?sslmode=verify-full`;

test("exact staging database secret contract emits booleans only and never the secret", () => {
  const receipt = validateStagingDatabaseSecretContract(validUrl, STAGING_DATABASE_EXPECTED_USER);
  assert.ok(Object.values(receipt).every((value) => typeof value === "boolean"));
  assert.equal(receipt.expected_user_configured, true);
  assert.equal(receipt.scheme_verified, true);
  assert.equal(receipt.external_host_verified, true);
  assert.equal(receipt.port_verified, true);
  assert.equal(receipt.database_verified, true);
  assert.equal(receipt.user_verified, true);
  assert.equal(receipt.sslmode_verify_full, true);
  assert.equal(receipt.query_exact, true);
  assert.equal(receipt.fragment_absent, true);
  assert.equal(receipt.production_host_absent, true);
  assert.equal(receipt.secret_not_printed, true);
  assert.equal(receipt.network_attempted, false);
  assert.equal(receipt.render_api_token_requested, false);
  assert.equal(receipt.egress_discovery_attempted, false);
  assert.equal(receipt.allow_list_mutation_attempted, false);
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(secret));
});

test("contract fails closed for scheme, host, database, user, sslmode, production, or missing input", () => {
  const rejected = [
    validUrl.replace("postgresql:", "https:"),
    validUrl.replace(STAGING_DATABASE_HOST, "internal-host"),
    validUrl.replace(`/${STAGING_DATABASE_NAME}`, "/wrong_database"),
    validUrl.replace(STAGING_DATABASE_EXPECTED_USER, "racun_staging"),
    validUrl.replace("sslmode=verify-full", "sslmode=require"),
    validUrl.replace(":5432/", ":6543/"),
    validUrl.replace(STAGING_DATABASE_HOST, PRODUCTION_DATABASE_HOST),
    validUrl.replace("?sslmode=verify-full", ""),
    `${validUrl}&host=evil.example`,
    `${validUrl}&user=racun_staging`,
    `${validUrl}&port=6543`,
    `${validUrl}&dbname=wrong_database`,
    `${validUrl}&sslmode=verify-full`,
    validUrl.replace("sslmode=verify-full", "SSLMODE=verify-full"),
    validUrl.replace("sslmode=verify-full", "%73slmode=verify-full"),
    `${validUrl}#override`,
  ];
  for (const url of rejected)
    assert.throws(() => validateStagingDatabaseSecretContract(url, STAGING_DATABASE_EXPECTED_USER), /contract invalid/);
  assert.throws(() => validateStagingDatabaseSecretContract(undefined, STAGING_DATABASE_EXPECTED_USER), /contract invalid/);
  assert.throws(() => validateStagingDatabaseSecretContract(validUrl, undefined), /contract invalid/);
});

test("pg-connection-string effective destination stays exact and override syntax is rejected", () => {
  validateStagingDatabaseSecretContract(validUrl, STAGING_DATABASE_EXPECTED_USER);
  const effective = parsePgConnectionString(validUrl);
  assert.equal(effective.host, STAGING_DATABASE_HOST);
  assert.equal(effective.port, "5432");
  assert.equal(effective.database, STAGING_DATABASE_NAME);
  assert.equal(effective.user, STAGING_DATABASE_EXPECTED_USER);
  const poisoned = `${validUrl}&host=evil.example&user=racun_staging&port=6543`;
  const overridden = parsePgConnectionString(poisoned);
  assert.equal(overridden.host, "evil.example");
  assert.equal(overridden.user, "racun_staging");
  assert.equal(overridden.port, "6543");
  assert.throws(() => validateStagingDatabaseSecretContract(poisoned, STAGING_DATABASE_EXPECTED_USER), /contract invalid/);
});

test("CLI output is one boolean-only receipt and excludes both URL and password", () => {
  const script = new URL("../scripts/validate-staging-database-secret-contract.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, STAGING_DATABASE_URL: validUrl,
      STAGING_DATABASE_EXPECTED_USER },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  assert.doesNotMatch(result.stdout, /postgres(?:ql)?:\/\//);
  const receipt = JSON.parse(result.stdout);
  assert.ok(Object.values(receipt).every((value) => typeof value === "boolean"));

  const rejected = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, STAGING_DATABASE_URL: validUrl.replace("sslmode=verify-full", "sslmode=require"),
      STAGING_DATABASE_EXPECTED_USER },
  });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stderr, "");
  assert.doesNotMatch(rejected.stdout, new RegExp(secret));
  assert.ok(Object.values(JSON.parse(rejected.stdout)).every((value) => typeof value === "boolean"));
});

test("secret-contract mode has no Render token, egress discovery, allow-list, or E2E capability", () => {
  assert.doesNotMatch(source, /fetch\s*\(|node:https|node:http|checkip|STAGING_RENDER_API_KEY|ipAllowList|runEvidence/);
  const contractJob = workflow.slice(
    workflow.indexOf("  staging-database-secret-contract:"),
    workflow.indexOf("  staging-database-tls-preflight:")
  );
  assert.match(contractJob, /inputs\.mode == 'secret-contract'/);
  assert.match(contractJob, /STAGING_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.match(contractJob, /STAGING_DATABASE_EXPECTED_USER: \$\{\{ vars\.STAGING_DATABASE_EXPECTED_USER \}\}/);
  assert.doesNotMatch(contractJob, /STAGING_RENDER_API_KEY|checkip|managed-staging-db-tls-window|run-mobile-evidence|docker run/);
});

test("dispatch modes are mutually isolated and full E2E remains explicit", () => {
  assert.match(workflow, /default: secret-contract/);
  assert.match(workflow, /- secret-contract\n          - tls-preflight-only\n          - full-e2e/);
  const preflightJob = workflow.slice(
    workflow.indexOf("  staging-database-tls-preflight:"),
    workflow.indexOf("  exact-sha-mobile-evidence:")
  );
  assert.match(preflightJob, /inputs\.mode == 'tls-preflight-only'/);
  assert.match(preflightJob, /run-staging-database-tls-preflight\.mjs/);
  assert.doesNotMatch(preflightJob, /managed-staging-db-tls-window\.mjs (?:run|preflight)/);
  assert.match(preflightJob, /if: always\(\) && steps\.staging_db_tls_preflight\.outcome != 'skipped'/);
  assert.doesNotMatch(preflightJob, /run-mobile-evidence|EVIDENCE_INHERIT_STAGING_ENV|R2_|AUTH_SECRET|docker run/);
  const fullJob = workflow.slice(workflow.indexOf("  exact-sha-mobile-evidence:"));
  assert.match(fullJob, /inputs\.mode == 'full-e2e'/);
  assert.match(fullJob, /managed-staging-db-tls-window\.mjs run/);
  assert.match(fullJob, /run-mobile-evidence-image|EVIDENCE_INHERIT_STAGING_ENV/);
  const contractAt = fullJob.indexOf("Validate staging database secret contract before evidence work");
  const shaAt = fullJob.indexOf("Validate hard-bound reviewed SHA and immutable control checkout");
  const buildAt = fullJob.indexOf("Build immutable exact-source evidence image");
  assert.ok(contractAt > 0 && contractAt < shaAt && shaAt < buildAt);
});
