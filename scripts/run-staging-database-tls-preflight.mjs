#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  allowListIsExact,
  createSignalGuard,
  exactRunnerAllowList,
  externalTlsDatabaseUrl,
  parsePublicIPv4,
  postgresShape,
  PUBLIC_IPV4_SOURCE,
  renderRequest,
  replaceAllowList,
  STAGING_POSTGRES_ID,
  validateExpectedUser,
  validateTarget,
  verifyDatabaseTls,
  waitForAllowList,
} from "./managed-staging-db-tls-window.mjs";
import { validateStagingDatabaseSecretContract } from "./validate-staging-database-secret-contract.mjs";

const CLEANUP_TOTAL_BUDGET_MS = 25_000;
const CLEANUP_REQUEST_POLICY = { attempts: 3, baseDelayMs: 250, maxDelayMs: 1_000, attemptTimeoutMs: 2_000 };
const CLEANUP_WAIT_OPTIONS = {
  attempts: 4,
  intervalMs: 500,
  requestPolicy: { attempts: 2, baseDelayMs: 250, maxDelayMs: 1_000, attemptTimeoutMs: 2_000 },
};

const blankReceipt = () => ({
  preflight_only: true,
  expected_user_configured: false,
  target_verified: false,
  authoritative_identity_verified: false,
  initial_allow_list_empty: false,
  public_ipv4_verified: false,
  single_32_applied: false,
  allow_list_readback_verified: false,
  external_hostname_verified: false,
  database_url_user_verified: false,
  sslmode_verify_full: false,
  transaction_read_only_verified: false,
  select_one_verified: false,
  current_database_verified: false,
  current_user_verified: false,
  role_not_superuser_verified: false,
  role_no_create_role_verified: false,
  role_no_create_database_verified: false,
  role_no_replication_verified: false,
  role_no_bypass_rls_verified: false,
  pg_stat_ssl_verified: false,
  certificate_hostname_verified: false,
  evidence_executed: false,
  cleanup_patch_empty: false,
  cleanup_readback_empty: false,
  secret_values_exposed: false,
  production_access_attempted: false,
});

function required(name, value) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new Error(`missing ${name}`);
  return value;
}

function mask(value) {
  process.stdout.write(`::add-mask::${value}\n`);
}

async function readPostgres(postgresId, token, policy) {
  return postgresShape(await renderRequest(postgresId, token, {}, policy));
}

async function discoverPublicIPv4() {
  const response = await fetch(PUBLIC_IPV4_SOURCE, { headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error("public IPv4 discovery failed");
  return parsePublicIPv4(await response.text());
}

function emitReceipt(receipt) {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

const defaultDeps = {
  readPostgres,
  replaceAllowList,
  waitForAllowList,
  verifyDatabaseTls,
  discoverPublicIPv4,
  emitReceipt,
};

export async function runTlsPreflight(env = process.env, deps = defaultDeps) {
  const receipt = blankReceipt();
  const abortController = new AbortController();
  let cleanupRequired = false;
  let cleanupPromise;
  let mutationSettled = Promise.resolve();
  let signalGuard;
  let operationError;
  const cleanupOnce = async () => {
    if (!cleanupRequired) return;
    cleanupPromise ??= (async () => {
      await mutationSettled;
      const deadlineAt = Date.now() + CLEANUP_TOTAL_BUDGET_MS;
      await deps.replaceAllowList(STAGING_POSTGRES_ID, required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY), [],
        { ...CLEANUP_REQUEST_POLICY, deadlineAt });
      receipt.cleanup_patch_empty = true;
      await deps.waitForAllowList(STAGING_POSTGRES_ID, required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY), [],
        { ...CLEANUP_WAIT_OPTIONS, deadlineAt,
          requestPolicy: { ...CLEANUP_WAIT_OPTIONS.requestPolicy, deadlineAt } });
      receipt.cleanup_readback_empty = true;
    })();
    return cleanupPromise;
  };

  try {
    validateStagingDatabaseSecretContract(env.MANAGED_DATABASE_URL, env.STAGING_DATABASE_EXPECTED_USER);
    const expectedUser = validateExpectedUser(env.STAGING_DATABASE_EXPECTED_USER);
    receipt.expected_user_configured = true;
    const postgresId = validateTarget(required("STAGING_RENDER_POSTGRES_ID", env.STAGING_RENDER_POSTGRES_ID));
    receipt.target_verified = true;
    const token = required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY);
    const metadata = postgresShape(await deps.readPostgres(postgresId, token));
    receipt.authoritative_identity_verified = true;
    if (!allowListIsExact(metadata.ipAllowList, [])) throw new Error("initial allow-list is not empty");
    receipt.initial_allow_list_empty = true;

    const ip = parsePublicIPv4(await deps.discoverPublicIPv4());
    mask(ip);
    receipt.public_ipv4_verified = true;
    const expectedAllowList = exactRunnerAllowList(ip);

    cleanupRequired = true;
    signalGuard = createSignalGuard(cleanupOnce, abortController);
    signalGuard.install();
    const applyingWindow = Promise.resolve().then(() => deps.replaceAllowList(postgresId, token, expectedAllowList));
    mutationSettled = applyingWindow.then(() => undefined, () => undefined);
    await applyingWindow;
    abortController.signal.throwIfAborted();
    receipt.single_32_applied = true;
    await deps.waitForAllowList(postgresId, token, expectedAllowList);
    abortController.signal.throwIfAborted();
    receipt.allow_list_readback_verified = true;

    const tlsUrl = externalTlsDatabaseUrl(env.MANAGED_DATABASE_URL, metadata, expectedUser);
    receipt.external_hostname_verified = true;
    receipt.database_url_user_verified = true;
    receipt.sslmode_verify_full = tlsUrl.searchParams.get("sslmode") === "verify-full";
    mask(tlsUrl.toString());
    const dbReceipt = await deps.verifyDatabaseTls(tlsUrl, metadata, expectedUser);
    abortController.signal.throwIfAborted();
    Object.assign(receipt, dbReceipt);
    if (Object.values(dbReceipt).some((value) => value !== true)) throw new Error("TLS preflight failed");
  } catch (error) {
    operationError = error;
  } finally {
    try { await cleanupOnce(); }
    catch (error) { operationError = operationError ?? error; }
    signalGuard?.disarm();
  }

  (deps.emitReceipt ?? emitReceipt)(receipt);
  if (operationError || !receipt.cleanup_readback_empty) throw new Error("staging database TLS preflight failed");
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTlsPreflight().catch(() => { process.exitCode = 1; });
}
