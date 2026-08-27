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
import { chromium, type ConsoleMessage } from "playwright";
import { Pool } from "pg";
import { config } from "../lib/config";
import { runtimeAuthSecret } from "../lib/auth-secret-policy";

const BASE = process.env.BASE ?? "https://racun-ai-staging-web.onrender.com";
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
assert.equal(process.env.RENDER_GIT_COMMIT, EXPECTED_SHA, "runner wajib memakai exact staging image");
assert.equal(process.env.RACUN_DEPLOY_ENV, "staging", "runner hanya boleh berjalan di staging");
assert.equal(process.env.RACUN_DB_RUNTIME, "postgres", "runner memerlukan PostgreSQL staging");
assert.match(config.databaseUrl, /^postgres(?:ql)?:\/\//i, "DATABASE_URL PostgreSQL wajib tersedia");

fs.mkdirSync(RECEIPT_DIR, { recursive: true });
const pool = new Pool({ connectionString: config.databaseUrl });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await context.newPage();
let userId: string | null = null;
let orgInserted = false;
let correctionInserted = false;
let otpRequestIntercepted = 0;
const forbiddenRequests: string[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const requestReceipts: Array<{ endpoint: string; method: string; status: number }> = [];
const screenshot = async (name: string) => {
  const target = path.join(RECEIPT_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return path.basename(target);
};
const horizontalOverflow = () => page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
const relevantConsoleError = (message: ConsoleMessage) => {
  if (message.type() !== "error") return;
  const text = message.text();
  if (/hydration|content security policy|csp|evalerror/i.test(text)) consoleErrors.push(text.slice(0, 300));
};

page.on("console", relevantConsoleError);
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (/^\/api\/(credits|jobs|promo\/jobs|dashboard\/(matrix|campaign\/confirm))/.test(url.pathname)) {
    forbiddenRequests.push(`${request.method()} ${url.pathname}`);
  }
});

const receipt: Record<string, unknown> = {
  schema: "managed-mobile-auth-hydration/v1",
  exact_sha: EXPECTED_SHA,
  base_origin: new URL(BASE).origin,
  viewport: { width: 375, height: 812, reduced_height: 520 },
  email_sha256: emailSha256,
  otp_provider_calls: 0,
  payment_generation_calls: 0,
  screenshots: [] as string[],
  cleanup: { otp: false, membership: false, organization: false, identity: false, net_zero: false },
  result: "FAIL",
};

try {
  const healthResponse = await fetch(`${BASE}/api/health`);
  const health = await healthResponse.json() as Record<string, unknown>;
  assert.equal(healthResponse.status, 200);
  assert.equal(health.build_sha, EXPECTED_SHA, "deployed build_sha tidak exact");
  receipt.runtime = {
    build_sha: health.build_sha,
    deploy_env: health.deploy_env ?? "staging",
    intake: health.intake,
    payments_live: health.payments_live,
  };

  await page.route("**/api/auth/request-otp", async (route) => {
    otpRequestIntercepted++;
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mode: "managed-intercept", expires_in_sec: 300, email_live: false }),
    });
  });

  // google_error opens the real email form without depending on intake state.
  await page.goto(`${BASE}/onboarding?google_error=cancelled`, { waitUntil: "networkidle" });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.focus();
  assert.equal(await emailInput.getAttribute("inputmode"), "email");
  await emailInput.fill(email);
  await page.getByRole("button", { name: "Kirim Kode OTP" }).click();
  await page.getByRole("button", { name: "Mengirim kode..." }).waitFor();
  assert.equal(otpRequestIntercepted, 1, "loading tidak melewati intercepted request-otp");
  await page.getByRole("heading", { name: "Masukkan kode OTP" }).waitFor();
  (receipt.screenshots as string[]).push(await screenshot("01-otp-entry-375x812"));

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

  // Reduced height approximates a mobile keyboard without changing width.
  await page.setViewportSize({ width: 375, height: 520 });
  await otpInput.focus();
  const reducedOverflow = await horizontalOverflow();
  assert.equal(reducedOverflow.overflow, false, `OTP overflow pada keyboard height: ${JSON.stringify(reducedOverflow)}`);
  (receipt.screenshots as string[]).push(await screenshot("02-wrong-code-keyboard-375x520"));
  await page.setViewportSize({ width: 375, height: 812 });

  await otpInput.fill(OTP);
  const correctResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/verify-otp"));
  await page.getByRole("button", { name: "Masuk & Mulai" }).click();
  const correct = await correctResponse;
  requestReceipts.push({ endpoint: "/api/auth/verify-otp", method: "POST", status: correct.status() });
  assert.equal(correct.status(), 200, "preseeded OTP recovery wajib 200");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });

  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email]);
  assert.equal(user.rowCount, 1, "verified staging identity tidak ditemukan");
  userId = user.rows[0].id;
  await pool.query("INSERT INTO organizations (id,name,slug,status,created_at) VALUES ($1,$2,$3,'active',$4)",
    [orgId, "Managed Mobile Trace", `managed-mobile-${suffix}`, now()]);
  await pool.query("INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$4)",
    [memberId, orgId, userId, now()]);
  orgInserted = true;

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const menu = page.getByRole("button", { name: "Buka menu" });
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  await menu.focus();
  await menu.click();
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  await page.locator("#laci-navigasi a[href]").first().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.closest("#laci-navigasi") !== null), true,
    "focus tidak masuk ke drawer");
  (receipt.screenshots as string[]).push(await screenshot("03-dashboard-drawer-open-375x812"));
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
  receipt.mobile = { otp_reduced_height_overflow: reducedOverflow, dashboard_overflow: dashboardOverflow };
  receipt.dashboard = { aria_expanded: "false->true->false", escape_closed: true, focus_restored: true };
  receipt.otp_provider_calls = 0;
  receipt.payment_generation_calls = 0;
  receipt.result = "PASS";
} finally {
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await pool.query("DELETE FROM otp_codes WHERE id=$1 OR email=$2", [otpId, email]).catch(() => undefined);
  (receipt.cleanup as Record<string, unknown>).otp = Number((await pool.query(
    "SELECT count(*)::int AS n FROM otp_codes WHERE id=$1 OR email=$2", [otpId, email]
  )).rows[0].n) === 0;

  if (userId) {
    const balanceBefore = Number((await pool.query(
      "SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE user_id=$1", [userId]
    )).rows[0].balance);
    if (balanceBefore !== 0) {
      await pool.query(
        "INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,NULL,$3,'koreksi',NULL,NULL,$4)",
        [correctionId, userId, -balanceBefore, now()],
      );
      correctionInserted = true;
    }
    const balanceAfter = Number((await pool.query(
      "SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE user_id=$1", [userId]
    )).rows[0].balance);
    (receipt.cleanup as Record<string, unknown>).net_zero = balanceAfter === 0;
    receipt.ledger_cleanup = { balance_before_idr: balanceBefore, correction_appended: correctionInserted, balance_after_idr: balanceAfter };
    await pool.query("DELETE FROM org_members WHERE id=$1 OR user_id=$2", [memberId, userId]);
    await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    await pool.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$1", [userId]);
    await pool.query("DELETE FROM credit_ledger WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  } else if (orgInserted) {
    await pool.query("DELETE FROM org_members WHERE id=$1", [memberId]).catch(() => undefined);
    await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]).catch(() => undefined);
  }
  const remaining = userId ? {
    membership: Number((await pool.query("SELECT count(*)::int AS n FROM org_members WHERE user_id=$1", [userId])).rows[0].n),
    organization: Number((await pool.query("SELECT count(*)::int AS n FROM organizations WHERE id=$1", [orgId])).rows[0].n),
    identity: Number((await pool.query("SELECT count(*)::int AS n FROM users WHERE id=$1", [userId])).rows[0].n),
    payments: Number((await pool.query("SELECT count(*)::int AS n FROM payments WHERE user_id=$1", [userId])).rows[0].n),
  } : { membership: 0, organization: 0, identity: 0, payments: 0 };
  Object.assign(receipt.cleanup as Record<string, unknown>, {
    membership: remaining.membership === 0,
    organization: remaining.organization === 0,
    identity: remaining.identity === 0,
    payments: remaining.payments === 0,
  });
  const cleanup = receipt.cleanup as Record<string, unknown>;
  if (receipt.result === "PASS" && !Object.values(cleanup).every(Boolean)) receipt.result = "FAIL_CLEANUP";
  receipt.finished_at = now();
  fs.writeFileSync(path.join(RECEIPT_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await pool.end();
  console.log(JSON.stringify(receipt));
}
