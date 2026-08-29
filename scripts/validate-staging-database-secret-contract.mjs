#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const STAGING_DATABASE_EXPECTED_USER = "racun_staging_ci";
export const STAGING_DATABASE_NAME = "racun_staging";
export const STAGING_DATABASE_HOST = "dpg-d9n21fnlk1mc73djm8q0-a.singapore-postgres.render.com";
export const PRODUCTION_DATABASE_HOST = "dpg-d9nh7rrncjis73a6e5b0-a.singapore-postgres.render.com";

const blankReceipt = () => ({
  expected_user_configured: false,
  scheme_verified: false,
  external_host_verified: false,
  port_verified: false,
  database_verified: false,
  user_verified: false,
  credential_present: false,
  sslmode_verify_full: false,
  query_exact: false,
  fragment_absent: false,
  production_host_absent: false,
  secret_not_printed: true,
  network_attempted: false,
  render_api_token_requested: false,
  egress_discovery_attempted: false,
  allow_list_mutation_attempted: false,
});

function required(name, value) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new Error(`missing ${name}`);
  return value;
}

function fail(receipt) {
  const error = new Error("staging database secret contract invalid");
  error.receipt = receipt;
  throw error;
}

export function validateStagingDatabaseSecretContract(rawUrl, configuredUser) {
  const receipt = blankReceipt();
  let expectedUser;
  let url;
  try {
    expectedUser = required("STAGING_DATABASE_EXPECTED_USER", configuredUser);
    receipt.expected_user_configured = expectedUser === STAGING_DATABASE_EXPECTED_USER;
    url = new URL(required("STAGING_DATABASE_URL", rawUrl));
  } catch {
    fail(receipt);
  }

  receipt.scheme_verified = url.protocol === "postgres:" || url.protocol === "postgresql:";
  receipt.external_host_verified = url.hostname === STAGING_DATABASE_HOST;
  receipt.port_verified = url.port === "5432";
  receipt.database_verified = decodeURIComponent(url.pathname.slice(1)) === STAGING_DATABASE_NAME;
  receipt.user_verified = decodeURIComponent(url.username) === STAGING_DATABASE_EXPECTED_USER;
  receipt.credential_present = url.password.length > 0;
  receipt.sslmode_verify_full = url.searchParams.getAll("sslmode").length === 1 &&
    url.searchParams.get("sslmode") === "verify-full";
  receipt.query_exact = url.search === "?sslmode=verify-full";
  receipt.fragment_absent = url.hash === "";
  receipt.production_host_absent = url.hostname !== PRODUCTION_DATABASE_HOST;

  const falseOnly = new Set([
    "network_attempted", "render_api_token_requested", "egress_discovery_attempted", "allow_list_mutation_attempted",
  ]);
  if (Object.entries(receipt).some(([key, value]) => falseOnly.has(key) ? value !== false : value !== true)) {
    fail(receipt);
  }
  return receipt;
}

function emit(receipt) {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

async function main() {
  try {
    emit(validateStagingDatabaseSecretContract(
      process.env.STAGING_DATABASE_URL,
      process.env.STAGING_DATABASE_EXPECTED_USER
    ));
  } catch (error) {
    emit(error?.receipt ?? blankReceipt());
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
