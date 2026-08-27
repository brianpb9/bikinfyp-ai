#!/usr/bin/env node
/**
 * Managed staging mobile/auth/hydration trace.
 *
 * Run from Dockerfile.mobile-evidence, a bounded external evidence image built
 * from the same exact git SHA as the deployed staging image. The deployed SHA
 * is independently bound through /api/health. The request-OTP call is
 * intercepted in Chromium, so this runner never contacts Resend. It also
 * refuses every payment/generation request and cleans its temporary identity,
 * organization, OTP, and ledger rows.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "playwright";
import { Pool } from "pg";
import { config } from "../lib/config";
import { runtimeAuthSecret } from "../lib/auth-secret-policy";
import { mediaStorage } from "../lib/storage";

const BASE = process.env.BASE ?? "https://racun-ai-staging-web.onrender.com";
const STAGING_ORIGIN = "https://racun-ai-staging-web.onrender.com";
const EXPECTED_SHA = process.env.EXPECTED_APP_SHA?.trim() ?? "";
const EVIDENCE_SOURCE_SHA = process.env.EVIDENCE_SOURCE_SHA?.trim() ?? "";
const EVIDENCE_SOURCE_TREE = process.env.EVIDENCE_SOURCE_TREE?.trim() ?? "";
const EVIDENCE_IMAGE_DIGEST = process.env.EVIDENCE_IMAGE_DIGEST?.trim() ?? "";
const RECEIPT_DIR = path.resolve(process.env.RECEIPT_DIR ?? "artifacts/managed-mobile-auth-hydration");
const OTP = "842731";
const suffix = crypto.randomUUID();
const email = `managed-mobile-${suffix}@staging.invalid`;
const emailSha256 = crypto.createHash("sha256").update(email).digest("hex");
const orgId = `managed-mobile-org-${suffix}`;
const memberId = `managed-mobile-member-${suffix}`;
const otpId = `managed-mobile-otp-${suffix}`;
const correctionId = `managed-mobile-correction-${suffix}`;
const now = () => new Date().toISOString();

assert.match(EXPECTED_SHA, /^[0-9a-f]{40}$/, "EXPECTED_APP_SHA wajib full SHA");
assert.equal(new URL(BASE).origin, STAGING_ORIGIN, "BASE wajib exact canonical staging origin");
assert.equal(EVIDENCE_SOURCE_SHA, EXPECTED_SHA, "external evidence image wajib dibangun dari exact app SHA");
assert.match(EVIDENCE_SOURCE_TREE, /^[0-9a-f]{40}$/, "evidence source tree wajib Git tree SHA");
assert.match(EVIDENCE_IMAGE_DIGEST, /^sha256:[0-9a-f]{64}$/, "immutable evidence image digest wajib tersedia");
assert.equal(process.env.RACUN_DEPLOY_ENV, "staging", "runner hanya boleh berjalan di staging");
assert.equal(process.env.RACUN_DB_RUNTIME, "postgres", "runner memerlukan PostgreSQL staging");
assert.match(config.databaseUrl, /^postgres(?:ql)?:\/\//i, "DATABASE_URL PostgreSQL wajib tersedia");
assert.equal(config.storageMode, "r2", "runner memerlukan private R2 staging");
const sourceAttestation = JSON.parse(execFileSync(process.execPath,
  ["scripts/verify-mobile-evidence-source.mjs"], { encoding: "utf8" })) as {
    commit: string; tree: string; manifest_sha256: string; files: number;
  };

fs.mkdirSync(RECEIPT_DIR, { recursive: true });
const pool = new Pool({ connectionString: config.databaseUrl });
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let userId: string | null = null;
let correctionInserted = false;
let otpRequestIntercepted = 0;
const forbiddenRequests: string[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const requestReceipts: Array<{ endpoint: string; method: string; status: number }> = [];
const forbiddenMutationEntrypoints = [
  "/api/credits/checkout", "/api/credits/topup", "/api/jobs", "/api/scripts/generate",
  "/api/dashboard/matrix", "/api/dashboard/campaign/generate", "/api/dashboard/campaign/confirm",
  "/api/dashboard/campaign/job/[jobId]", "/api/promo/jobs",
] as const;
const artifactPrefix = `managed-evidence/mobile-auth/${EXPECTED_SHA}/${suffix}`;
const screenshotManifest: Array<{ name: string; sha256: string; bytes: number; private_key: string }> = [];
const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const putAndVerify = async (key: string, bytes: Buffer, contentType: string) => {
  const storage = mediaStorage();
  await storage.put(key, bytes, contentType);
  const stat = await storage.stat(key);
  assert.equal(stat?.size, bytes.length, `R2 stat size mismatch: ${key}`);
  const readback = await storage.get(key);
  assert.ok(readback, `R2 readback missing: ${key}`);
  assert.equal(readback.size, bytes.length, `R2 readback size mismatch: ${key}`);
  assert.equal(readback.body.length, bytes.length, `R2 body size mismatch: ${key}`);
  assert.equal(sha256(readback.body), sha256(bytes), `R2 readback SHA mismatch: ${key}`);
};
const screenshot = async (name: string) => {
  assert.ok(page);
  const target = path.join(RECEIPT_DIR, `${name}.png`);
  const bytes = await page.screenshot({ path: target, fullPage: false });
  const privateKey = `${artifactPrefix}/${name}.png`;
  await putAndVerify(privateKey, bytes, "image/png");
  const item = { name: path.basename(target), sha256: sha256(bytes), bytes: bytes.length, private_key: privateKey };
  screenshotManifest.push(item);
  return item;
};
const horizontalOverflow = () => page!.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
const focusedViewportEvidence = () => page!.evaluate(() => {
  const active = document.activeElement as HTMLElement | null;
  const rect = active?.getBoundingClientRect();
  const viewport = window.visualViewport;
  return {
    inner_width: window.innerWidth, inner_height: window.innerHeight,
    visual_width: viewport?.width ?? null, visual_height: viewport?.height ?? null,
    focused: active?.tagName ?? null,
    focused_visible: Boolean(rect && rect.bottom > 0 && rect.top < (viewport?.height ?? window.innerHeight)),
  };
});
const relevantConsoleError = (message: ConsoleMessage) => {
  if (message.type() !== "error") return;
  consoleErrors.push(message.text().slice(0, 500));
};

const receipt: Record<string, unknown> = {
  schema: "managed-mobile-auth-hydration/v1",
  exact_sha: EXPECTED_SHA,
  base_origin: new URL(BASE).origin,
  viewport: { width: 375, height: 812, reduced_height: 520 },
  email_sha256: emailSha256,
  otp_provider_calls: 0,
  payment_generation_calls: 0,
  forbidden_mutation_entrypoints: forbiddenMutationEntrypoints,
  review_status: "PENDING_INDEPENDENT_REVIEW",
  points_claimed: 0,
  evidence_runner: { source: sourceAttestation, image_digest: EVIDENCE_IMAGE_DIGEST },
  screenshots: screenshotManifest,
  cleanup: { otp: false, membership: false, organization: false, identity_retained_with_provenance: false,
    net_zero: false, correction_audit_linked: false },
  result: "FAIL",
};

try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  page = await context.newPage();
  page.on("console", relevantConsoleError);
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));

  const healthResponse = await fetch(`${BASE}/api/health`);
  const health = await healthResponse.json() as Record<string, unknown>;
  assert.equal(healthResponse.status, 200);
  assert.equal(health.build_sha, EXPECTED_SHA, "deployed build_sha tidak exact");
  assert.equal(health.payments_live, false, "managed trace requires payments_live=false");
  receipt.runtime = {
    build_sha: health.build_sha,
    deploy_env: health.deploy_env ?? "staging",
    intake: health.intake,
    payments_live: health.payments_live,
  };

  let otpRouteStarted!: () => void;
  let releaseOtpRoute!: () => void;
  const otpStarted = new Promise<void>((resolve) => { otpRouteStarted = resolve; });
  const otpRelease = new Promise<void>((resolve) => { releaseOtpRoute = resolve; });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, STAGING_ORIGIN, `API request escaped staging origin: ${url.origin}`);
    if (request.method() === "GET") return route.continue();
    if (url.pathname === "/api/auth/request-otp" && request.method() === "POST") {
      otpRequestIntercepted++;
      otpRouteStarted();
      await otpRelease;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, mode: "managed-intercept", expires_in_sec: 300, email_live: false }) });
    }
    if (url.pathname === "/api/auth/verify-otp" && request.method() === "POST") return route.continue();
    forbiddenRequests.push(`${request.method()} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });

  // google_error opens the real email form without depending on intake state.
  await page.goto(`${BASE}/onboarding?google_error=cancelled`, { waitUntil: "networkidle" });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.focus();
  assert.equal(await emailInput.getAttribute("inputmode"), "email");
  await emailInput.fill(email);
  await page.getByRole("button", { name: "Kirim Kode OTP" }).click();
  await otpStarted;
  await page.getByRole("button", { name: "Mengirim kode..." }).waitFor();
  await screenshot("00-request-otp-loading-375x812");
  assert.equal(otpRequestIntercepted, 1, "loading tidak melewati intercepted request-otp");
  releaseOtpRoute();
  await page.getByRole("heading", { name: "Masukkan kode OTP" }).waitFor();
  await screenshot("01-otp-entry-375x812");

  const otpHash = crypto.createHash("sha256")
    .update(`${runtimeAuthSecret()}:otp:${email.toLowerCase()}:${OTP}`)
    .digest("hex");
  await pool.query(
    "INSERT INTO otp_codes (id,email,code_hash,expires_at,attempts,created_at) VALUES ($1,$2,$3,$4,0,$5)",
    [otpId, email, otpHash, new Date(Date.now() + 5 * 60_000).toISOString(), now()],
  );

  const otpInput = page.locator('input[inputmode="numeric"]');
  assert.equal(await otpInput.getAttribute("inputmode"), "numeric");
  await otpInput.fill("111111");
  const wrongResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/verify-otp"));
  await page.getByRole("button", { name: "Masuk & Mulai" }).click();
  const wrong = await wrongResponse;
  requestReceipts.push({ endpoint: "/api/auth/verify-otp", method: "POST", status: wrong.status() });
  assert.equal(wrong.status(), 401, "wrong-code staging rejection wajib 401");
  await page.getByText(/Kodenya belum tepat/).waitFor();
  await screenshot("02-wrong-code-recovery-375x812");

  // Reduced height approximates a mobile keyboard without changing width.
  await page.setViewportSize({ width: 375, height: 520 });
  await otpInput.focus();
  const reducedOverflow = await horizontalOverflow();
  assert.equal(reducedOverflow.overflow, false, `OTP overflow pada keyboard height: ${JSON.stringify(reducedOverflow)}`);
  const reducedViewport = await focusedViewportEvidence();
  assert.deepEqual({ width: reducedViewport.inner_width, height: reducedViewport.inner_height }, { width: 375, height: 520 });
  assert.equal(reducedViewport.focused, "INPUT");
  assert.equal(reducedViewport.focused_visible, true);
  await screenshot("03-wrong-code-keyboard-375x520");
  await page.setViewportSize({ width: 375, height: 812 });

  await otpInput.fill(OTP);
  const correctResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/verify-otp"));
  await page.getByRole("button", { name: "Masuk & Mulai" }).click();
  const correct = await correctResponse;
  requestReceipts.push({ endpoint: "/api/auth/verify-otp", method: "POST", status: correct.status() });
  assert.equal(correct.status(), 200, "preseeded OTP recovery wajib 200");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  await screenshot("04-otp-recovery-success-375x812");

  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email]);
  assert.equal(user.rowCount, 1, "verified staging identity tidak ditemukan");
  userId = user.rows[0].id;
  await pool.query("INSERT INTO organizations (id,name,slug,status,created_at,onboarded_at) VALUES ($1,$2,$3,'active',$4,$4)",
    [orgId, "Managed Mobile Trace", `managed-mobile-${suffix}`, now()]);
  await pool.query("INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$4)",
    [memberId, orgId, userId, now()]);

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const menu = page.getByRole("button", { name: "Buka menu" });
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  await menu.focus();
  await menu.click();
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  await page.locator("#laci-navigasi a[href]").first().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.closest("#laci-navigasi") !== null), true,
    "focus tidak masuk ke drawer");
  await screenshot("05-dashboard-drawer-open-375x812");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[aria-label="Buka menu"]')?.getAttribute("aria-expanded") === "false");
  assert.equal(await menu.evaluate((element) => document.activeElement === element), true, "focus tidak kembali ke pembuka");
  const dashboardOverflow = await horizontalOverflow();
  assert.equal(dashboardOverflow.overflow, false, `dashboard overflow: ${JSON.stringify(dashboardOverflow)}`);

  assert.deepEqual(consoleErrors, [], `hydration/CSP console errors: ${JSON.stringify(consoleErrors)}`);
  assert.deepEqual(pageErrors, [], `page errors: ${JSON.stringify(pageErrors)}`);
  assert.deepEqual(forbiddenRequests, [], `payment/generation request terdeteksi: ${JSON.stringify(forbiddenRequests)}`);
  assert.equal(otpRequestIntercepted, 1);
  receipt.requests = requestReceipts;
  receipt.mobile = { otp_reduced_height_overflow: reducedOverflow, reduced_viewport: reducedViewport, dashboard_overflow: dashboardOverflow };
  receipt.dashboard = { aria_expanded: "false->true->false", escape_closed: true, focus_restored: true };
  receipt.otp_provider_calls = 0;
  receipt.payment_generation_calls = 0;
  receipt.result = "PASS";
} finally {
  const cleanupErrors: string[] = [];
  const cleanupStep = async (label: string, operation: () => Promise<void>) => {
    try { await operation(); } catch (error) { cleanupErrors.push(`${label}: ${String(error).slice(0, 240)}`); }
  };
  await cleanupStep("context", async () => { await context?.close(); });
  await cleanupStep("browser", async () => { await browser?.close(); });
  await cleanupStep("recover-user", async () => {
    if (!userId) userId = (await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id ?? null;
  });
  await cleanupStep("otp", async () => { await pool.query("DELETE FROM otp_codes WHERE id=$1 OR email=$2", [otpId, email]); });
  await cleanupStep("membership", async () => {
    await pool.query("DELETE FROM org_members WHERE id=$1", [memberId]);
    if (userId) await pool.query("DELETE FROM org_members WHERE user_id=$1", [userId]);
  });
  await cleanupStep("organization", async () => { await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]); });
  if (userId) {
    await cleanupStep("append-net-zero", async () => {
      const balanceBefore = Number((await pool.query("SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE user_id=$1", [userId])).rows[0].balance);
      if (balanceBefore !== 0) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,NULL,$3,'koreksi',NULL,NULL,$4)",
            [correctionId, userId, -balanceBefore, now()]);
          await client.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'credit.koreksi','credit_ledger',$3,$4,$5)",
            [crypto.randomUUID(), userId, correctionId, JSON.stringify({ delta_idr: -balanceBefore,
              reason: "managed_test_identity_net_zero", task: "SCORE-80-EXECUTION-20260828", exact_sha: EXPECTED_SHA }), now()]);
          await client.query("COMMIT");
          correctionInserted = true;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally { client.release(); }
      }
      const balanceAfter = Number((await pool.query("SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE user_id=$1", [userId])).rows[0].balance);
      const historyRows = Number((await pool.query("SELECT count(*)::int AS n FROM credit_ledger WHERE user_id=$1", [userId])).rows[0].n);
      let correctionAuditLinked = !correctionInserted;
      if (correctionInserted) {
        const linked = await pool.query<{ delta: number; meta: string }>(`SELECT l.delta,a.meta FROM credit_ledger l
          JOIN audit_log a ON a.entity='credit_ledger' AND a.entity_id=l.id AND a.action='credit.koreksi'
          WHERE l.id=$1 AND l.user_id=$2`, [correctionId, userId]);
        const meta = linked.rows[0] ? JSON.parse(linked.rows[0].meta) as { delta_idr?: unknown; reason?: unknown } : null;
        correctionAuditLinked = linked.rowCount === 1 && Number(linked.rows[0]?.delta) === -balanceBefore
          && Number(meta?.delta_idr) === -balanceBefore && meta?.reason === "managed_test_identity_net_zero";
      }
      (receipt.cleanup as Record<string, unknown>).net_zero = balanceAfter === 0 && historyRows >= (correctionInserted ? 2 : 1);
      (receipt.cleanup as Record<string, unknown>).correction_audit_linked = correctionAuditLinked;
      receipt.ledger_cleanup = { balance_before_idr: balanceBefore, correction_appended: correctionInserted,
        correction_id: correctionInserted ? correctionId : null, correction_audit_linked: correctionAuditLinked,
        balance_after_idr: balanceAfter, history_rows_preserved: historyRows };
    });
    await cleanupStep("retain-identity", async () => {
      await pool.query("UPDATE users SET name=$2 WHERE id=$1", [userId, `[RETAINED TEST IDENTITY] ${EXPECTED_SHA.slice(0, 12)}`]);
      await pool.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'test_identity.retained','users',$2,$3,$4)",
        [crypto.randomUUID(), userId, JSON.stringify({ task: "SCORE-80-EXECUTION-20260828", exact_sha: EXPECTED_SHA, email_sha256: emailSha256, reason: "append_only_ledger_fk" }), now()]);
    });
  }
  await cleanupStep("verify-cleanup", async () => {
    const otpRows = Number((await pool.query("SELECT count(*)::int AS n FROM otp_codes WHERE id=$1 OR email=$2", [otpId, email])).rows[0].n);
    const memberRows = userId ? Number((await pool.query("SELECT count(*)::int AS n FROM org_members WHERE user_id=$1", [userId])).rows[0].n) : 0;
    const orgRows = Number((await pool.query("SELECT count(*)::int AS n FROM organizations WHERE id=$1", [orgId])).rows[0].n);
    const retained = userId ? Number((await pool.query("SELECT count(*)::int AS n FROM users WHERE id=$1 AND name LIKE '[RETAINED TEST IDENTITY]%'", [userId])).rows[0].n) : 0;
    const payments = userId ? Number((await pool.query("SELECT count(*)::int AS n FROM payments WHERE user_id=$1", [userId])).rows[0].n) : 0;
    Object.assign(receipt.cleanup as Record<string, unknown>, { otp: otpRows === 0, membership: memberRows === 0,
      organization: orgRows === 0, identity_retained_with_provenance: retained === 1, payments: payments === 0 });
  });
  receipt.console_errors = consoleErrors;
  receipt.page_errors = pageErrors;
  receipt.cleanup_errors = cleanupErrors;
  await cleanupStep("pool", async () => { await pool.end(); });
  const cleanup = receipt.cleanup as Record<string, unknown>;
  if (receipt.result === "PASS" && (cleanupErrors.length || !Object.values(cleanup).every(Boolean))) receipt.result = "FAIL_CLEANUP";
  const executionResult = String(receipt.result);
  receipt.execution_result = executionResult;
  receipt.result = "PENDING_ARTIFACT_VERIFICATION";
  const receiptKey = `${artifactPrefix}/receipt.json`;
  const manifestKey = `${artifactPrefix}/manifest.json`;
  receipt.artifact_manifest = { channel: "private-r2", prefix: artifactPrefix,
    review_status: "PENDING_INDEPENDENT_REVIEW", points_claimed: 0, screenshots: screenshotManifest,
    receipt_key: receiptKey, manifest_key: manifestKey };
  receipt.finished_at = now();
  try {
    const serialized = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    fs.writeFileSync(path.join(RECEIPT_DIR, "receipt.json"), serialized, { mode: 0o600 });
    await putAndVerify(receiptKey, serialized, "application/json");
    const manifest = {
      schema: "managed-mobile-auth-hydration-manifest/v1",
      exact_sha: EXPECTED_SHA,
      artifacts: [
        ...screenshotManifest.map((item) => ({ key: item.private_key, sha256: item.sha256, bytes: item.bytes, content_type: "image/png" })),
        { key: receiptKey, sha256: sha256(serialized), bytes: serialized.length, content_type: "application/json" },
      ],
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(RECEIPT_DIR, "manifest.json"), manifestBytes, { mode: 0o600 });
    await putAndVerify(manifestKey, manifestBytes, "application/json");
    receipt.result = executionResult;
    receipt.artifact_verification = { verified: true, manifest_key: manifestKey,
      manifest_sha256: sha256(manifestBytes), receipt_key: receiptKey, receipt_sha256: sha256(serialized) };
  } catch (error) {
    receipt.result = "FAIL_ARTIFACT_VERIFICATION";
    receipt.artifact_verification = { verified: false, error: String(error).slice(0, 500) };
    process.exitCode = 1;
  }
  const finalBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(path.join(RECEIPT_DIR, "receipt.json"), finalBytes, { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}
