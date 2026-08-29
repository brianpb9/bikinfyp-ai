#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
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
  waitForAllowList,
} from "./managed-staging-db-tls-window.mjs";
import { validateStagingDatabaseSecretContract } from "./validate-staging-database-secret-contract.mjs";

export const TASK = "NORMAL-REPRESENTATIVE-METADATA-ACQUISITION-20260829";
const EXPECTED_STAGING_BUCKET_SHA256 = "ac1b68a6d928588ad7ad9ea149e47c1cda07c3257e849a9b5e083b58740ea4ca";
const EXPECTED_STAGING_ENDPOINT_SHA256 = "977ce90e2cc94eb82bb175a6f1d1ffeee36569402eb6dd07eb5d4d8e2ba1e477";
const CLEANUP_TOTAL_BUDGET_MS = 25_000;
const CLEANUP_REQUEST_POLICY = { attempts: 3, baseDelayMs: 250, maxDelayMs: 1_000, attemptTimeoutMs: 2_000 };
const CLEANUP_WAIT_OPTIONS = {
  attempts: 4,
  intervalMs: 500,
  requestPolicy: { attempts: 2, baseDelayMs: 250, maxDelayMs: 1_000, attemptTimeoutMs: 2_000 },
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function required(name, value) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new Error(`missing ${name}`);
  return value;
}

function mask(value) { process.stdout.write(`::add-mask::${value}\n`); }

export function parseManifest(raw, jobId) {
  const manifest = JSON.parse(raw);
  if (manifest?.version !== 2 || !Array.isArray(manifest.references) || manifest.references.length < 1 ||
      manifest.references.length > 7) {
    throw new Error("REFERENCE_MANIFEST_INVALID");
  }
  for (const [index, reference] of manifest.references.entries()) {
    if (typeof reference?.rel !== "string" || !reference.rel ||
        typeof reference?.snapshotRel !== "string" ||
        !/^[0-9a-f]{64}$/.test(reference?.sha256 ?? "") ||
        !Number.isInteger(reference?.versiBukti) || reference.versiBukti < 1 ||
        reference?.labelOcrStatus !== "READABLE" || reference?.labelOcrVersion !== 1) {
      throw new Error("REFERENCE_MANIFEST_INVALID");
    }
    const extension = path.posix.extname(reference.rel);
    const expectedSnapshotRel = path.posix.join("jobs", jobId, "approved-references", `${index}-${reference.sha256}${extension}`);
    if (reference.snapshotRel !== expectedSnapshotRel || reference.snapshotRel.startsWith("/") ||
        reference.snapshotRel.split("/").includes("..")) throw new Error("REFERENCE_STORAGE_OBJECT_INVALID");
  }
  return { manifest, primary: manifest.references[0] };
}

export function parseProductSnapshot(raw) {
  const snapshot = JSON.parse(raw);
  const nullableString = (value) => value === null || typeof value === "string";
  const versionValid = [1, 2, 3, 4].includes(snapshot?.version);
  const priceValid = snapshot?.version !== 1 && Number.isSafeInteger(snapshot?.priceIdr) && snapshot.priceIdr >= 0;
  const promoValid = ![3, 4].includes(snapshot?.version) || (
    (snapshot.promoPriceBeforeIdr === null || (Number.isSafeInteger(snapshot.promoPriceBeforeIdr) && snapshot.promoPriceBeforeIdr >= 0)) &&
    nullableString(snapshot.promoEndsAt) &&
    (snapshot.promoStockLeft === null || (Number.isSafeInteger(snapshot.promoStockLeft) && snapshot.promoStockLeft >= 0))
  );
  const categoryReviewValid = snapshot?.version !== 4 ||
    (Number.isInteger(snapshot.categoryReviewVersion) && snapshot.categoryReviewVersion >= 1);
  if (!versionValid || !priceValid || !promoValid || !categoryReviewValid ||
      typeof snapshot?.productName !== "string" ||
      typeof snapshot?.category !== "string" || !snapshot.productName.trim() || !snapshot.category.trim() ||
      snapshot?.trustedBrand?.source !== "products.raw_meta.brand" ||
      typeof snapshot.trustedBrand.value !== "string" || !snapshot.trustedBrand.value.trim() ||
      !nullableString(snapshot.productVisualDesc) || !nullableString(snapshot.brandBrief) ||
      !Array.isArray(snapshot?.claims) || !snapshot.claims.every((claim) => typeof claim === "string")) {
    throw new Error("PRODUCT_SNAPSHOT_INVALID");
  }
  return snapshot;
}

async function readBody(body) {
  if (typeof body?.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body ?? []) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function acquireFromDatabaseAndR2(tlsUrl, metadata, expectedUser, env, options = {}) {
  const poolFactory = options.poolFactory ?? ((config) => new Pool(config));
  const r2Get = options.r2Get ?? (async (bucket, key) => {
    const endpointOrigin = new URL(required("R2_ENDPOINT", env.R2_ENDPOINT)).origin;
    if (digest(required("R2_BUCKET", env.R2_BUCKET)) !== EXPECTED_STAGING_BUCKET_SHA256 ||
        digest(endpointOrigin) !== EXPECTED_STAGING_ENDPOINT_SHA256 || env.R2_REGION !== "auto") {
      throw new Error("STAGING_R2_IDENTITY_MISMATCH");
    }
    const client = new S3Client({
      region: env.R2_REGION,
      endpoint: endpointOrigin,
      forcePathStyle: true,
      maxAttempts: 2,
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY),
      },
    });
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return readBody(response.Body);
    } finally { client.destroy(); }
  });
  const pool = poolFactory({ connectionString: tlsUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  let client;
  let began = false;
  let rolledBack = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    const database = await client.query("SELECT current_database() AS value");
    const user = await client.query("SELECT current_user AS value");
    const readOnly = await client.query("SHOW transaction_read_only");
    const role = await client.query("SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    const ssl = await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()");
    const stream = client.connection?.stream;
    const certificate = typeof stream?.getPeerCertificate === "function" ? stream.getPeerCertificate(true) : null;
    const hostnameError = certificate ? tls.checkServerIdentity(tlsUrl.hostname, certificate) : new Error("certificate missing");
    const tlsVerified = database.rows[0]?.value === metadata.databaseName && user.rows[0]?.value === expectedUser &&
      readOnly.rows[0]?.transaction_read_only === "on" && role.rowCount === 1 &&
      Object.values(role.rows[0]).every((value) => value === false) && ssl.rows[0]?.ssl === true &&
      stream?.encrypted === true && stream?.authorized === true && stream?.authorizationError == null && !hostnameError;
    if (!tlsVerified) throw new Error("DATABASE_TLS_OR_PRINCIPAL_MISMATCH");

    const registry = await client.query("SELECT to_regclass('public.normal_representative_evidence_runs')::text AS value");
    const evidenceRegistryPresent = typeof registry.rows[0]?.value === "string";
    const noPriorEvidencePredicate = evidenceRegistryPresent
      ? "AND NOT EXISTS (SELECT 1 FROM normal_representative_evidence_runs ne WHERE ne.job_id=j.id)"
      : "";
    const candidates = await client.query(`SELECT j.id AS job_id,j.user_id,j.product_id,j.persona_id AS subject_id,
          j.approved_reference_manifest,j.job_product_snapshot
      FROM jobs j
      WHERE j.state='QUEUED' AND j.requires_approval=FALSE
        AND j.format='talking_head' AND j.duration_s=15 AND j.quality_tier='high_quality'
        AND j.persona_id IS NOT NULL AND j.approved_reference_manifest IS NOT NULL
        AND j.job_product_snapshot IS NOT NULL AND j.output_url IS NULL
        AND NOT EXISTS (SELECT 1 FROM outputs o WHERE o.job_id=j.id)
        AND NOT EXISTS (SELECT 1 FROM provider_tasks pt WHERE pt.job_id=j.id)
        ${noPriorEvidencePredicate}
        AND (SELECT COUNT(*) FROM credit_ledger cl WHERE cl.job_id=j.id AND cl.type='hold')=1
        AND NOT EXISTS (SELECT 1 FROM credit_ledger cl WHERE cl.job_id=j.id AND cl.type IN ('capture','release'))
      LIMIT 2`);
    if (candidates.rowCount !== 1) {
      const error = new Error("CANONICAL_CANDIDATE_COUNT_NOT_ONE");
      error.candidateCount = candidates.rowCount;
      throw error;
    }
    const row = candidates.rows[0];
    const { manifest, primary } = parseManifest(row.approved_reference_manifest, row.job_id);
    parseProductSnapshot(row.job_product_snapshot);
    const bytes = await r2Get(required("R2_BUCKET", env.R2_BUCKET), primary.snapshotRel);
    const actualDigest = digest(bytes);
    if (actualDigest !== primary.sha256) throw new Error("REFERENCE_DIGEST_MISMATCH");
    return {
      controls: {
        transaction_read_only_verified: true,
        external_hostname_verified: true,
        sslmode_verify_full: tlsUrl.searchParams.get("sslmode") === "verify-full",
        current_database_verified: true,
        current_user_verified: true,
        dedicated_principal_verified: true,
        pg_stat_ssl_verified: true,
        certificate_hostname_verified: true,
        canonical_candidate_count: 1,
        staging_r2_identity_verified: true,
        r2_get_only: true,
        reference_digest_match: true,
        zero_mutable_inputs_verified: true,
        prior_evidence_registry_checked: true
      },
      manifest: {
        product_id: row.product_id,
        product_snapshot_id_or_sha: `sha256:${digest(row.job_product_snapshot)}`,
        subject_id: row.subject_id,
        reference_asset_id: primary.rel,
        reference_authorization_receipt: {
          type: "approved_reference_manifest:v2",
          manifest_sha256: digest(row.approved_reference_manifest),
          manifest_version: manifest.version,
          primary_index: 0,
          proof_version: primary.versiBukti,
          label_ocr_status: primary.labelOcrStatus,
          label_ocr_version: primary.labelOcrVersion
        },
        reference_storage_object_id: primary.snapshotRel,
        reference_digest_sha256: actualDigest
      },
      selection: {
        job_id: row.job_id,
        user_id: row.user_id,
        reversible_hold_count: 1,
        terminal_ledger_count: 0,
        prior_effect_count: 0,
        evidence_registry_present: evidenceRegistryPresent
      }
    };
  } finally {
    try {
      if (client && began) { await client.query("ROLLBACK"); rolledBack = true; }
    } finally {
      client?.release();
      await pool.end();
    }
    if (began && !rolledBack) throw new Error("READ_ONLY_ROLLBACK_FAILED");
  }
}

const defaultDeps = {
  async readPostgres(postgresId, token) { return postgresShape(await renderRequest(postgresId, token)); },
  replaceAllowList,
  waitForAllowList,
  async discoverPublicIPv4() {
    const response = await fetch(PUBLIC_IPV4_SOURCE, { headers: { accept: "text/plain" } });
    if (!response.ok) throw new Error("PUBLIC_IPV4_DISCOVERY_FAILED");
    return parsePublicIPv4(await response.text());
  },
  acquireFromDatabaseAndR2,
};

export async function runMetadataAcquisition(env = process.env, deps = defaultDeps) {
  const receipt = {
    schema: "normal-representative-metadata-acquisition/v1",
    task: TASK,
    started_at: new Date().toISOString(),
    finished_at: null,
    decision: "FAIL_CLOSED",
    failure_code: null,
    candidate_count: null,
    controls: {
      target_staging_only: false, initial_allow_list_empty: false, runner_ipv4_32_only: false,
      allow_list_readback_exact: false, external_hostname_verified: false, sslmode_verify_full: false,
      dedicated_principal_verified: false, transaction_read_only_verified: false,
      r2_get_only: false, reference_digest_match: false, zero_mutable_inputs_verified: false,
      prior_evidence_registry_checked: false,
      cleanup_patch_empty: false, cleanup_readback_empty: false,
      secret_values_exposed: false, production_access_attempted: false
    },
    selection: null,
    manifest: null,
    lane_effects: { database_writes: 0, r2_writes: 0, provider_posts: 0, provider_spend_usd: 0, publication: false, production_mutations: 0 }
  };
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
      const token = required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY);
      await deps.replaceAllowList(STAGING_POSTGRES_ID, token, [], { ...CLEANUP_REQUEST_POLICY, deadlineAt });
      receipt.controls.cleanup_patch_empty = true;
      await deps.waitForAllowList(STAGING_POSTGRES_ID, token, [], {
        ...CLEANUP_WAIT_OPTIONS, deadlineAt,
        requestPolicy: { ...CLEANUP_WAIT_OPTIONS.requestPolicy, deadlineAt }
      });
      receipt.controls.cleanup_readback_empty = true;
    })();
    return cleanupPromise;
  };
  try {
    validateStagingDatabaseSecretContract(env.MANAGED_DATABASE_URL, env.STAGING_DATABASE_EXPECTED_USER);
    const expectedUser = validateExpectedUser(env.STAGING_DATABASE_EXPECTED_USER);
    const postgresId = validateTarget(required("STAGING_RENDER_POSTGRES_ID", env.STAGING_RENDER_POSTGRES_ID));
    const token = required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY);
    const metadata = postgresShape(await deps.readPostgres(postgresId, token));
    receipt.controls.target_staging_only = true;
    if (!allowListIsExact(metadata.ipAllowList, [])) throw new Error("INITIAL_ALLOW_LIST_NOT_EMPTY");
    receipt.controls.initial_allow_list_empty = true;
    const ip = parsePublicIPv4(await deps.discoverPublicIPv4());
    mask(ip);
    const exactList = exactRunnerAllowList(ip);
    cleanupRequired = true;
    signalGuard = createSignalGuard(cleanupOnce, abortController);
    signalGuard.install();
    const applying = Promise.resolve().then(() => deps.replaceAllowList(postgresId, token, exactList));
    mutationSettled = applying.then(() => undefined, () => undefined);
    await applying;
    receipt.controls.runner_ipv4_32_only = true;
    await deps.waitForAllowList(postgresId, token, exactList);
    receipt.controls.allow_list_readback_exact = true;
    const tlsUrl = externalTlsDatabaseUrl(env.MANAGED_DATABASE_URL, metadata, expectedUser);
    mask(tlsUrl.toString());
    const acquired = await deps.acquireFromDatabaseAndR2(tlsUrl, metadata, expectedUser, env);
    Object.assign(receipt.controls, acquired.controls);
    receipt.candidate_count = acquired.controls.canonical_candidate_count;
    receipt.selection = acquired.selection;
    receipt.manifest = acquired.manifest;
    receipt.decision = "PASS";
  } catch (error) {
    operationError = error;
    const code = String(error?.message ?? "");
    const safeCodes = new Set([
      "INITIAL_ALLOW_LIST_NOT_EMPTY", "CANONICAL_CANDIDATE_COUNT_NOT_ONE", "REFERENCE_MANIFEST_INVALID",
      "REFERENCE_STORAGE_OBJECT_INVALID", "PRODUCT_SNAPSHOT_INVALID", "REFERENCE_DIGEST_MISMATCH",
      "STAGING_R2_IDENTITY_MISMATCH", "DATABASE_TLS_OR_PRINCIPAL_MISMATCH", "READ_ONLY_ROLLBACK_FAILED"
    ]);
    receipt.failure_code = safeCodes.has(code) ? code : "ACQUISITION_FAILED";
    if (Number.isInteger(error?.candidateCount)) receipt.candidate_count = error.candidateCount;
  } finally {
    try { await cleanupOnce(); }
    catch (error) { operationError = operationError ?? error; receipt.failure_code = "CLEANUP_FAILED"; }
    signalGuard?.disarm();
    receipt.finished_at = new Date().toISOString();
    const output = required("METADATA_RECEIPT_PATH", env.METADATA_RECEIPT_PATH);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ decision: receipt.decision, failure_code: receipt.failure_code,
      candidate_count: receipt.candidate_count, cleanup_readback_empty: receipt.controls.cleanup_readback_empty })}\n`);
  }
  if (operationError || receipt.decision !== "PASS" || !receipt.controls.cleanup_readback_empty) {
    throw new Error("NORMAL_REPRESENTATIVE_METADATA_ACQUISITION_FAILED");
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMetadataAcquisition().catch(() => { process.exitCode = 1; });
}
