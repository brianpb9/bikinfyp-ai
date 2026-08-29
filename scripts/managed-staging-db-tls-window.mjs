#!/usr/bin/env node

import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export const STAGING_POSTGRES_ID = "dpg-d9n21fnlk1mc73djm8q0-a";
export const PRODUCTION_POSTGRES_ID = "dpg-d9nh7rrncjis73a6e5b0-a";
export const STAGING_POSTGRES_NAME = "racun-ai-staging-postgres";
export const PUBLIC_IPV4_SOURCE = "https://checkip.amazonaws.com/";
const RENDER_API_ORIGIN = "https://api.render.com";
const WINDOW_DESCRIPTION = "temporary-github-runner-one-run";

const blankRunReceipt = () => ({
  target_verified: false,
  authoritative_identity_verified: false,
  initial_allow_list_empty: false,
  public_ipv4_verified: false,
  single_32_applied: false,
  allow_list_readback_verified: false,
  external_hostname_verified: false,
  sslmode_verify_full: false,
  transaction_read_only_verified: false,
  select_one_verified: false,
  current_database_verified: false,
  current_user_verified: false,
  pg_stat_ssl_verified: false,
  certificate_hostname_verified: false,
  evidence_executed_once: false,
  cleanup_patch_empty: false,
  cleanup_readback_empty: false,
  secret_values_exposed: false,
  ip_value_exposed: false,
  production_access_attempted: false,
});

const blankCloseReceipt = () => ({
  target_verified: false,
  cleanup_patch_empty: false,
  cleanup_readback_empty: false,
  secret_values_exposed: false,
  ip_value_exposed: false,
  production_access_attempted: false,
});

function required(name, value) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new Error(`missing ${name}`);
  return value;
}

export function validateTarget(postgresId) {
  if (postgresId === PRODUCTION_POSTGRES_ID) throw new Error("production target forbidden");
  if (postgresId !== STAGING_POSTGRES_ID) throw new Error("unexpected target");
  return postgresId;
}

export function parsePublicIPv4(raw) {
  const value = String(raw ?? "").trim();
  if (value.includes("/") || net.isIP(value) !== 4) throw new Error("public IPv4 required");
  const octets = value.split(".").map(Number);
  if (
    octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 0 && (octets[2] === 0 || octets[2] === 2)) ||
    (octets[0] === 192 && octets[1] === 88 && octets[2] === 99) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51 && octets[2] === 100)) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) || octets[0] >= 224
  ) throw new Error("globally routable IPv4 required");
  return value;
}

export function exactRunnerAllowList(ip) {
  return [{ cidrBlock: `${parsePublicIPv4(ip)}/32`, description: WINDOW_DESCRIPTION }];
}

export function allowListIsExact(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) =>
    item && Object.keys(item).every((key) => ["cidrBlock", "description"].includes(key)) &&
    item.cidrBlock === expected[index].cidrBlock && item.description === expected[index].description
  );
}

export function postgresShape(raw) {
  const value = raw?.postgres ?? raw;
  if (!value || value.id !== STAGING_POSTGRES_ID || value.name !== STAGING_POSTGRES_NAME) {
    throw new Error("staging identity mismatch");
  }
  if (typeof value.databaseName !== "string" || !value.databaseName ||
      typeof value.databaseUser !== "string" || !value.databaseUser ||
      value.region !== "singapore" || !Array.isArray(value.ipAllowList)) {
    throw new Error("authoritative staging metadata missing");
  }
  return value;
}

export function externalTlsDatabaseUrl(raw, metadata) {
  const url = new URL(required("MANAGED_DATABASE_URL", raw));
  const expectedHost = `${metadata.id}.${metadata.region}-postgres.render.com`;
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("postgres URL required");
  if (url.hostname !== expectedHost) throw new Error("external staging hostname required");
  if (decodeURIComponent(url.pathname.slice(1)) !== metadata.databaseName) throw new Error("database identity mismatch");
  if (decodeURIComponent(url.username) !== metadata.databaseUser) throw new Error("database user mismatch");
  if (!url.password) throw new Error("database credential missing");
  for (const key of ["ssl", "sslmode", "uselibpqcompat", "sslnegotiation", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(key);
  url.searchParams.set("sslmode", "verify-full");
  return url;
}

function mask(value) {
  process.stdout.write(`::add-mask::${value}\n`);
}

function renderUrl(postgresId) {
  validateTarget(postgresId);
  return `${RENDER_API_ORIGIN}/v1/postgres/${encodeURIComponent(postgresId)}`;
}

async function renderRequest(postgresId, token, init = {}) {
  const response = await fetch(renderUrl(postgresId), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new Error("Render control request failed");
  return response.json();
}

async function readPostgres(postgresId, token) {
  return postgresShape(await renderRequest(postgresId, token));
}

async function replaceAllowList(postgresId, token, ipAllowList) {
  const updated = postgresShape(await renderRequest(postgresId, token, {
    method: "PATCH",
    body: JSON.stringify({ ipAllowList }),
  }));
  if (!allowListIsExact(updated.ipAllowList, ipAllowList)) throw new Error("PATCH readback mismatch");
}

async function waitForAllowList(postgresId, token, expected, attempts = 20) {
  for (let index = 0; index < attempts; index++) {
    if (allowListIsExact((await readPostgres(postgresId, token)).ipAllowList, expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("allow-list convergence failed");
}

export async function verifyDatabaseTls(url, metadata, poolFactory = (config) => new Pool(config),
  hostnameVerifier = tls.checkServerIdentity) {
  const pool = poolFactory({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  let client;
  let transactionStarted = false;
  let rolledBack = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    const one = await client.query("SELECT 1 AS one");
    const database = await client.query("SELECT current_database() AS current_database");
    const user = await client.query("SELECT current_user AS current_user");
    const ssl = await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
    const stream = client.connection?.stream;
    const certificate = typeof stream?.getPeerCertificate === "function" ? stream.getPeerCertificate(true) : null;
    const hostnameError = certificate ? hostnameVerifier(url.hostname, certificate) : new Error("certificate missing");
    return {
      transaction_read_only_verified: transactionStarted,
      select_one_verified: one.rowCount === 1 && one.rows[0]?.one === 1,
      current_database_verified: database.rowCount === 1 && database.rows[0]?.current_database === metadata.databaseName,
      current_user_verified: user.rowCount === 1 && user.rows[0]?.current_user === metadata.databaseUser,
      pg_stat_ssl_verified: ssl.rowCount === 1 && ssl.rows[0]?.ssl === true,
      certificate_hostname_verified: stream?.encrypted === true && stream?.authorized === true &&
        stream?.authorizationError == null && !hostnameError,
    };
  } finally {
    let rollbackError;
    try {
      if (client && transactionStarted) {
        await client.query("ROLLBACK");
        rolledBack = true;
      }
    } catch (error) { rollbackError = error; }
    finally {
      client?.release();
      await pool.end();
    }
    if (transactionStarted && (!rolledBack || rollbackError)) throw new Error("read-only transaction rollback failed");
  }
}

function runCommand(file, args, env, abortSignal) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: "inherit", signal: abortSignal });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`child failed ${code ?? signal}`)));
  });
}

async function runEvidence(tlsUrl, env, abortSignal) {
  const childEnv = { ...env, DATABASE_URL: tlsUrl.toString() };
  await runCommand("bash", ["control/scripts/run-mobile-evidence-image.sh"], childEnv, abortSignal);
  await runCommand(process.execPath, ["control/scripts/verify-mobile-evidence-receipt.mjs",
    required("EVIDENCE_RECEIPT_EXPORT_DIR", env.EVIDENCE_RECEIPT_EXPORT_DIR),
    required("REVIEWED_SHA", env.REVIEWED_SHA)], childEnv, abortSignal);
}

export function createSignalGuard(cleanup, abortController, terminate = (code) => { process.exitCode = code; }) {
  let active = true;
  let handling;
  const handle = () => {
    if (!active) return handling;
    active = false;
    abortController.abort();
    handling = Promise.resolve().then(cleanup).then(() => terminate(1), () => terminate(1));
    return handling;
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  return {
    install() { for (const signal of signals) process.once(signal, handle); },
    disarm() { active = false; for (const signal of signals) process.removeListener(signal, handle); },
    handle,
  };
}

async function discoverPublicIPv4() {
  const response = await fetch(PUBLIC_IPV4_SOURCE, { headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error("public IPv4 discovery failed");
  return parsePublicIPv4(await response.text());
}

const defaultDeps = { readPostgres, replaceAllowList, waitForAllowList, verifyDatabaseTls, runEvidence, discoverPublicIPv4 };

export async function openWindow(env = process.env, deps = defaultDeps) {
  const receipt = blankRunReceipt();
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
      await deps.replaceAllowList(STAGING_POSTGRES_ID, required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY), []);
      receipt.cleanup_patch_empty = true;
      await deps.waitForAllowList(STAGING_POSTGRES_ID, required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY), []);
      receipt.cleanup_readback_empty = true;
    })();
    return cleanupPromise;
  };
  try {
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

    const tlsUrl = externalTlsDatabaseUrl(env.MANAGED_DATABASE_URL, metadata);
    receipt.external_hostname_verified = true;
    receipt.sslmode_verify_full = tlsUrl.searchParams.get("sslmode") === "verify-full";
    mask(tlsUrl.toString());
    const dbReceipt = await deps.verifyDatabaseTls(tlsUrl, metadata);
    abortController.signal.throwIfAborted();
    Object.assign(receipt, dbReceipt);
    if (Object.values(dbReceipt).some((value) => value !== true)) throw new Error("TLS preflight failed");

    receipt.evidence_executed_once = true;
    await deps.runEvidence(tlsUrl, env, abortController.signal);
  } catch (error) {
    operationError = error;
  } finally {
    try { await cleanupOnce(); }
    catch (error) { operationError = operationError ?? error; }
    signalGuard?.disarm();
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (operationError || !receipt.cleanup_readback_empty) throw new Error("managed staging DB TLS window run failed");
  return receipt;
}

export async function closeWindow(env = process.env, deps = defaultDeps) {
  const receipt = blankCloseReceipt();
  try {
    const postgresId = validateTarget(required("STAGING_RENDER_POSTGRES_ID", env.STAGING_RENDER_POSTGRES_ID));
    receipt.target_verified = true;
    const token = required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY);
    await deps.replaceAllowList(postgresId, token, []);
    receipt.cleanup_patch_empty = true;
    await deps.waitForAllowList(postgresId, token, []);
    receipt.cleanup_readback_empty = true;
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } catch {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    throw new Error("managed staging DB TLS window cleanup failed");
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "run") await openWindow();
  else if (mode === "close") await closeWindow();
  else throw new Error("expected run or close");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.exitCode = 1; });
}
