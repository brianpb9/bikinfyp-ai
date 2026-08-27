#!/usr/bin/env node
/**
 * Managed staging mobile/auth/hydration trace.
 *
 * Run inside the exact staging image with DATABASE_URL and AUTH_SECRET. The
 * request-OTP call is intercepted in Chromium, so this runner never contacts
 * Resend. It also refuses every payment/generation request and cleans its
 * temporary identity, organization, OTP, and ledger rows.
 */
import assert from "node:assert/strict";
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
assert.equal(process.env.RENDER_GIT_COMMIT, EXPECTED_SHA, "runner wajib memakai exact staging image");
assert.equal(process.env.RACUN_DEPLOY_ENV, "staging", "runner hanya boleh berjalan di staging");
assert.equal(process.env.RACUN_DB_RUNTIME, "postgres", "runner memerlukan PostgreSQL staging");
assert.match(config.databaseUrl, /^postgres(?:ql)?:\/\//i, "DATABASE_URL PostgreSQL wajib tersedia");

fs.mkdirSync(RECEIPT_DIR, { recursive: true });
const pool = new Pool({ connectionString: config.databaseUrl });
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let userId: string | null = null;
let orgInserted = false;
let membershipInserted = false;
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
const screenshot = async (name: string) => {
  assert.ok(page);
  const target = path.join(RECEIPT_DIR, `${name}.png`);
  const bytes = await page.screenshot({ path: target, fullPage: false });
  const privateKey = `${artifactPrefix}/${name}.png`;
  await mediaStorage().put(privateKey, bytes, "image/png");
  const item = { name: path.basename(target), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, private_key: privateKey };
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
  const text = message.text();
  if (/hydration|content security policy|csp|evalerror/i.test(text)) consoleErrors.push(text.slice(0, 300));
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
  screenshots: screenshotManifest,
  cleanup: { otp: false, membership: false, organization: false, identity_retained_with_provenance: false, net_zero: false },
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
  orgInserted = true;
  await pool.query("INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$4)",
    [memberId, orgId, userId, now()]);
  membershipInserted = true;

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
    if (membershipInserted || userId) await pool.query("DELETE FROM org_members WHERE id=$1 OR user_id=$2", [memberId, userId]);
  });
  await cleanupStep("organization", async () => { if (orgInserted) await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]); });
  if (userId) {
    await cleanupStep("append-net-zero", async () => {
      const balanceBefore = Number((await pool.query("SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE user_id=$1", [userId])).rows[0].balance);
      if (balanceBefore !== 0) {
        await pool.query("INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,NULL,$3,'koreksi',NULL,NULL,$4)",
          [correctionId, userId, -balanceBefore, now()]);
        correctionInserted = true;
      }
      const balanceAfter = Number((await pool.query("SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE user_id=$1", [userId])).rows[0].balance);
      const historyRows = Number((await pool.query("SELECT count(*)::int AS n FROM credit_ledger WHERE user_id=$1", [userId])).rows[0].n);
      (receipt.cleanup as Record<string, unknown>).net_zero = balanceAfter === 0 && historyRows >= (correctionInserted ? 2 : 1);
      receipt.ledger_cleanup = { balance_before_idr: balanceBefore, correction_appended: correctionInserted, balance_after_idr: balanceAfter, history_rows_preserved: historyRows };
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
  receipt.cleanup_errors = cleanupErrors;
  const cleanup = receipt.cleanup as Record<string, unknown>;
  if (receipt.result === "PASS" && (cleanupErrors.length || !Object.values(cleanup).every(Boolean))) receipt.result = "FAIL_CLEANUP";
  receipt.artifact_manifest = { channel: "private-r2", prefix: artifactPrefix,
    review_status: "PENDING_INDEPENDENT_REVIEW", points_claimed: 0, screenshots: screenshotManifest,
    receipt_key: `${artifactPrefix}/receipt.json` };
  receipt.finished_at = now();
  await cleanupStep("pool", async () => { await pool.end(); });
  let serialized = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(path.join(RECEIPT_DIR, "receipt.json"), serialized, { mode: 0o600 });
  try {
    await mediaStorage().put(`${artifactPrefix}/receipt.json`, serialized, "application/json");
  } catch (error) {
    cleanupErrors.push(`receipt-upload: ${String(error).slice(0, 240)}`);
    receipt.result = "FAIL_ARTIFACT_UPLOAD";
    serialized = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    fs.writeFileSync(path.join(RECEIPT_DIR, "receipt.json"), serialized, { mode: 0o600 });
  }
  console.log(JSON.stringify(receipt));
}
