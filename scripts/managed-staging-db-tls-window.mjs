#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export const STAGING_POSTGRES_ID = "dpg-d9n21fnlk1mc73djm8q0-a";
export const PRODUCTION_POSTGRES_ID = "dpg-d9nh7rrncjis73a6e5b0-a";
export const STAGING_POSTGRES_NAME = "racun-ai-staging-postgres";
export const STAGING_EXTERNAL_HOST = `${STAGING_POSTGRES_ID}.singapore-postgres.render.com`;
export const PUBLIC_IPV4_SOURCE = "https://checkip.amazonaws.com/";
const RENDER_API_ORIGIN = "https://api.render.com";
const WINDOW_DESCRIPTION = "temporary-github-runner-one-run";

const blankOpenReceipt = () => ({
  target_verified: false,
  initial_allow_list_empty: false,
  public_ipv4_verified: false,
  single_32_applied: false,
  allow_list_readback_verified: false,
  external_hostname_verified: false,
  sslmode_verify_full: false,
  select_one_verified: false,
  current_database_verified: false,
  current_user_verified: false,
  pg_stat_ssl_verified: false,
  certificate_hostname_verified: false,
  github_env_written: false,
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
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`missing ${name}`);
  }
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
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
    octets[0] >= 224
  ) throw new Error("globally routable IPv4 required");
  return value;
}

export function exactRunnerAllowList(ip) {
  const source = `${parsePublicIPv4(ip)}/32`;
  return [{ source, description: WINDOW_DESCRIPTION }];
}

export function allowListIsExact(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) =>
    item && item.source === expected[index].source && item.description === expected[index].description
  );
}

export function externalTlsDatabaseUrl(raw) {
  const url = new URL(required("STAGING_DATABASE_URL", raw));
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("postgres URL required");
  if (url.hostname !== STAGING_EXTERNAL_HOST) throw new Error("external staging hostname required");
  if (!url.username || !url.password || !url.pathname || url.pathname === "/") throw new Error("complete database URL required");
  url.searchParams.delete("ssl");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  url.searchParams.delete("sslnegotiation");
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

function postgresShape(raw) {
  const value = raw?.postgres ?? raw;
  if (!value || value.id !== STAGING_POSTGRES_ID || value.name !== STAGING_POSTGRES_NAME) {
    throw new Error("staging identity mismatch");
  }
  if (!Array.isArray(value.ipAllowList)) throw new Error("allow-list missing");
  return value;
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
    const current = await readPostgres(postgresId, token);
    if (allowListIsExact(current.ipAllowList, expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("allow-list convergence failed");
}

async function verifyDatabaseTls(url) {
  const expectedDatabase = decodeURIComponent(url.pathname.slice(1));
  const expectedUser = decodeURIComponent(url.username);
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  let client;
  try {
    client = await pool.connect();
    const one = await client.query("SELECT 1 AS one");
    const database = await client.query("SELECT current_database() AS current_database");
    const user = await client.query("SELECT current_user AS current_user");
    const ssl = await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
    const stream = client.connection?.stream;
    const certificate = typeof stream?.getPeerCertificate === "function" ? stream.getPeerCertificate(true) : null;
    const hostnameError = certificate ? tls.checkServerIdentity(url.hostname, certificate) : new Error("certificate missing");
    return {
      select_one_verified: one.rowCount === 1 && one.rows[0]?.one === 1,
      current_database_verified: database.rowCount === 1 && database.rows[0]?.current_database === expectedDatabase,
      current_user_verified: user.rowCount === 1 && user.rows[0]?.current_user === expectedUser,
      pg_stat_ssl_verified: ssl.rowCount === 1 && ssl.rows[0]?.ssl === true,
      certificate_hostname_verified: stream?.encrypted === true && stream?.authorized === true &&
        stream?.authorizationError == null && !hostnameError,
    };
  } finally {
    client?.release();
    await pool.end();
  }
}

export async function openWindow(env = process.env) {
  const receipt = blankOpenReceipt();
  try {
    const postgresId = validateTarget(required("STAGING_RENDER_POSTGRES_ID", env.STAGING_RENDER_POSTGRES_ID));
    receipt.target_verified = true;
    const token = required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY);
    const initial = await readPostgres(postgresId, token);
    if (!allowListIsExact(initial.ipAllowList, [])) throw new Error("initial allow-list is not empty");
    receipt.initial_allow_list_empty = true;

    const ipResponse = await fetch(PUBLIC_IPV4_SOURCE, { headers: { accept: "text/plain" } });
    if (!ipResponse.ok) throw new Error("public IPv4 discovery failed");
    const ip = parsePublicIPv4(await ipResponse.text());
    mask(ip);
    receipt.public_ipv4_verified = true;
    const expectedAllowList = exactRunnerAllowList(ip);
    await replaceAllowList(postgresId, token, expectedAllowList);
    receipt.single_32_applied = true;
    await waitForAllowList(postgresId, token, expectedAllowList);
    receipt.allow_list_readback_verified = true;

    const tlsUrl = externalTlsDatabaseUrl(env.MANAGED_DATABASE_URL);
    receipt.external_hostname_verified = tlsUrl.hostname === STAGING_EXTERNAL_HOST;
    receipt.sslmode_verify_full = tlsUrl.searchParams.get("sslmode") === "verify-full";
    mask(tlsUrl.toString());
    const dbReceipt = await verifyDatabaseTls(tlsUrl);
    Object.assign(receipt, dbReceipt);
    if (Object.values(dbReceipt).some((value) => value !== true)) throw new Error("TLS preflight failed");

    const githubEnv = required("GITHUB_ENV", env.GITHUB_ENV);
    fs.appendFileSync(githubEnv, `DATABASE_URL=${tlsUrl.toString()}\n`, { encoding: "utf8", mode: 0o600 });
    receipt.github_env_written = true;
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } catch {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    throw new Error("managed staging DB TLS window open failed");
  }
}

export async function closeWindow(env = process.env, deps = { replaceAllowList, waitForAllowList }) {
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
  if (mode === "open") await openWindow();
  else if (mode === "close") await closeWindow();
  else throw new Error("expected open or close");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.exitCode = 1; });
}
