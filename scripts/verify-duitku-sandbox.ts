/**
 * Verifikasi Duitku SANDBOX yang sengaja harus diaktifkan eksplisit.
 *
 * Bawaan hanya preflight/plan dan tidak menyentuh API. Satu invoice sandbox
 * baru hanya dibuat dengan `--execute-real-sandbox`; script tidak pernah
 * membuka payment URL atau mengirim callback buatan ke managed staging.
 * Secret tidak pernah masuk ke output.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const APPROVED_STAGING_ORIGIN = "https://racun-ai-staging-web.onrender.com";
const APPROVED_SANDBOX_REDIRECT_ORIGIN = "https://app-sandbox.duitku.com";
const executeReal = process.argv.includes("--execute-real-sandbox");
const refreshStatus = process.argv.includes("--refresh-status");
const journalPath = path.resolve(
  process.env.DUITKU_SANDBOX_JOURNAL
    ?? "docs/evidence/P1-DUITKU-SANDBOX-VERIFICATION-20260824/real-sandbox-api.json",
);

function loadLocalEnv(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith("#") || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function requireSandboxPreflight(): void {
  const callbackOrigin = process.env.DUITKU_SANDBOX_CALLBACK_BASE || APPROVED_STAGING_ORIGIN;
  const provider = process.env.PAYMENT_GATEWAY ?? "";
  const isProduction = process.env.DUITKU_IS_PRODUCTION === "true";
  const goLive = process.env.PAYMENTS_GO_LIVE === "true";
  const merchantPresent = Boolean(process.env.DUITKU_MERCHANT_CODE?.trim());
  const apiKeyPresent = Boolean(process.env.DUITKU_API_KEY?.trim());
  let normalizedOrigin = "";
  try {
    const parsed = new URL(callbackOrigin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
      throw new Error("not a clean HTTPS origin");
    }
    normalizedOrigin = parsed.origin;
  } catch {
    throw new Error("DUITKU_SANDBOX_CALLBACK_BASE harus clean HTTPS origin.");
  }

  const failures = [
    provider !== "duitku" ? "PAYMENT_GATEWAY=duitku" : "",
    isProduction ? "DUITKU_IS_PRODUCTION=false" : "",
    goLive ? "PAYMENTS_GO_LIVE harus false/absent" : "",
    !merchantPresent ? "DUITKU_MERCHANT_CODE" : "",
    !apiKeyPresent ? "DUITKU_API_KEY" : "",
    normalizedOrigin !== APPROVED_STAGING_ORIGIN
      ? `DUITKU_SANDBOX_CALLBACK_BASE=${APPROVED_STAGING_ORIGIN}`
      : "",
  ].filter(Boolean);
  if (failures.length > 0) throw new Error(`SANDBOX_PREFLIGHT_FAILED: ${failures.join(", ")}`);
  const blueprint = fs.readFileSync(path.join(process.cwd(), "render.yaml"), "utf8");
  if (!blueprint.includes(`value: ${APPROVED_STAGING_ORIGIN}`)) {
    throw new Error("Approved staging callback origin tidak lagi ada di render.yaml.");
  }

  // Paksa consumer produksi membaca origin staging yang sudah di-approve dan
  // tidak mungkin menganggap sandbox sebagai live.
  process.env.APP_BASE_URL = normalizedOrigin;
  process.env.RACUN_NO_DOTENV = "1";
}

loadLocalEnv();
requireSandboxPreflight();

const [{ TOPUP_PACKAGES }, duitku, configModule] = await Promise.all([
  import("../lib/credits"),
  import("../lib/duitku"),
  import("../lib/config"),
]);
const packageId = process.env.DUITKU_SANDBOX_PACKAGE_ID ?? "hq5";
const selectedPackage = TOPUP_PACKAGES.find((entry) => entry.id === packageId);
if (!selectedPackage) throw new Error(`DUITKU_SANDBOX_PACKAGE_ID bukan TOPUP_PACKAGES aktif: ${packageId}`);
if (duitku.duitkuBase() !== "https://api-sandbox.duitku.com") throw new Error("Duitku base bukan sandbox.");
if (configModule.paymentsProvider() !== "duitku" || configModule.paymentsEnv() !== "sandbox" || configModule.paymentsLive()) {
  throw new Error("Kontrak runtime bukan provider=duitku/env=sandbox/live=false.");
}

const observedAt = new Date().toISOString();
const common = {
  schema: "duitku-sandbox-verification/v1",
  observed_at: observedAt,
  execution: executeReal ? "REAL_SANDBOX_API" : "PLAN_ONLY",
  preflight: {
    credentials_present: true,
    provider: configModule.paymentsProvider(),
    payments_env: configModule.paymentsEnv(),
    payments_live: configModule.paymentsLive(),
    payments_go_live: false,
    api_origin: duitku.duitkuBase(),
    callback_origin: APPROVED_STAGING_ORIGIN,
    callback_url: `${APPROVED_STAGING_ORIGIN}/api/webhooks/duitku`,
  },
  authentication_contract: {
    create_invoice: "HMAC-SHA256(merchantCode + timestamp, apiKey)",
    transaction_status: "HMAC-SHA256(merchantCode + merchantOrderId, apiKey)",
    callback: "HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey)",
  },
  package: {
    id: selectedPackage.id,
    name: selectedPackage.name,
    price_idr: selectedPackage.priceIdr,
  },
  prohibitions: {
    payment_page_opened: false,
    invoice_paid: false,
    real_charge: false,
    refund: false,
    settlement: false,
    production_mutation: false,
  },
  first_attempt: {
    evidence_class: "REAL_SANDBOX_API",
    create_invoice: "ACCEPTED",
    order_id: null,
    reason_order_id_missing: "pre-fix runner rejected redirect origin before durable order journal",
    payment_page_opened: false,
    invoice_paid: false,
    transaction_status: "UNRECOVERABLE_WITHOUT_ORDER_ID",
    provider_expiry: "EXPECTED_NOT_OBSERVED",
  },
};

if (!executeReal && !refreshStatus) {
  console.log(JSON.stringify({
    ...common,
    real_sandbox_api: { executed: false, reason: "requires --execute-real-sandbox" },
  }, null, 2));
  process.exit(0);
}

if (executeReal && refreshStatus) throw new Error("Pilih salah satu: --execute-real-sandbox atau --refresh-status.");

if (refreshStatus) {
  if (!fs.existsSync(journalPath)) throw new Error("SANDBOX_JOURNAL_MISSING");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Record<string, any>;
  const orderId = journal?.real_sandbox_api?.order_id;
  if (
    journal.schema !== "duitku-sandbox-verification/v1"
    || journal.execution !== "REAL_SANDBOX_API"
    || journal.replacement_attempted !== true
    || typeof orderId !== "string"
    || !/^bikinfyp-sandbox-verify-\d{14}-[0-9a-f]{8}$/.test(orderId)
  ) {
    throw new Error("SANDBOX_JOURNAL_INVALID_FOR_STATUS_REFRESH");
  }
  const detail = await duitku.duitkuTransactionStatusDetailed(orderId);
  const transactionStatus = duitku.buildDuitkuStatusEvidence(detail, {
    orderId,
    amountIdr: selectedPackage.priceIdr,
    providerReferenceSha256: journal.real_sandbox_api.create_invoice.provider_reference_sha256,
  });
  const refreshed = {
    ...journal,
    verification_result: transactionStatus.verification.outcome,
    first_attempt: common.first_attempt,
    real_sandbox_api: {
      ...journal.real_sandbox_api,
      transaction_status: transactionStatus,
    },
  };
  fs.writeFileSync(journalPath, `${JSON.stringify(refreshed, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(refreshed, null, 2));
  process.exit(transactionStatus.verification.outcome === "PASS" ? 0 : 2);
}

if (fs.existsSync(journalPath)) {
  throw new Error(`SANDBOX_REPLACEMENT_ALREADY_JOURNALED: ${path.relative(process.cwd(), journalPath)}`);
}

const managedHealth = await fetch(`${APPROVED_STAGING_ORIGIN}/api/health`)
  .then(async (response) => ({ http_status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> }))
  .catch(() => ({ http_status: null, body: {} as Record<string, unknown> }));
const managedCallback = {
  execution: "NOT_RUN",
  evidence_class: "READ_ONLY_MANAGED_HEALTH",
  reason: managedHealth.body.payments_provider === "duitku"
    ? "Duitku callback credentials/tester allowlist not independently proven on managed staging"
    : `managed staging payments_provider=${String(managedHealth.body.payments_provider ?? "unknown")}, expected duitku`,
  health: {
    http_status: managedHealth.http_status,
    build_sha: managedHealth.body.build_sha ?? null,
    payments_provider: managedHealth.body.payments_provider ?? null,
    payments_env: managedHealth.body.payments_env ?? null,
    payments_live: managedHealth.body.payments_live ?? null,
  },
};

const compactTime = observedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
const orderId = `bikinfyp-sandbox-verify-${compactTime}-${crypto.randomBytes(4).toString("hex")}`;
fs.mkdirSync(path.dirname(journalPath), { recursive: true });
fs.writeFileSync(journalPath, `${JSON.stringify({
  ...common,
  replacement_attempted: true,
  real_sandbox_api: {
    executed: true,
    provider_originated_facts: false,
    state: "CREATE_REQUEST_STARTED",
    order_id: orderId,
  },
  managed_callback: managedCallback,
}, null, 2)}\n`, { flag: "wx", mode: 0o600 });

let invoice: Awaited<ReturnType<typeof duitku.createDuitkuInvoice>>;
try {
  invoice = await duitku.createDuitkuInvoice({
    orderId,
    packageId: selectedPackage.id,
    phone: "",
    email: "hdrvstudio@gmail.com",
  });
} catch (error) {
  fs.writeFileSync(journalPath, `${JSON.stringify({
    ...common,
    replacement_attempted: true,
    real_sandbox_api: {
      executed: true,
      provider_originated_facts: false,
      state: "CREATE_REQUEST_FAILED",
      order_id: orderId,
      error_class: error instanceof Error ? error.name : "UnknownError",
    },
    managed_callback: managedCallback,
  }, null, 2)}\n`, { mode: 0o600 });
  throw error;
}
const redirect = new URL(invoice.redirectUrl);
const providerReferenceSha256 = crypto.createHash("sha256").update(invoice.providerRef).digest("hex");
fs.writeFileSync(journalPath, `${JSON.stringify({
  ...common,
  replacement_attempted: true,
  real_sandbox_api: {
    executed: true,
    provider_originated_facts: true,
    state: "CREATE_ACCEPTED",
    order_id: orderId,
    create_invoice: {
      accepted: true,
      redirect_origin: redirect.origin,
      provider_reference_sha256: providerReferenceSha256,
    },
    transaction_status: { queried: false },
  },
  managed_callback: managedCallback,
}, null, 2)}\n`, { mode: 0o600 });
if (redirect.origin !== APPROVED_SANDBOX_REDIRECT_ORIGIN) {
  throw new Error(`Invoice tidak mengarah ke sandbox Duitku (${redirect.origin}).`);
}
const status = await duitku.duitkuTransactionStatusDetailed(orderId);
const transactionStatus = duitku.buildDuitkuStatusEvidence(status, {
  orderId,
  amountIdr: selectedPackage.priceIdr,
  providerReferenceSha256,
});

const finalEvidence = {
  ...common,
  verification_result: transactionStatus.verification.outcome,
  replacement_attempted: true,
  real_sandbox_api: {
    executed: true,
    provider_originated_facts: true,
    order_id: orderId,
    create_invoice: {
      accepted: true,
      redirect_origin: redirect.origin,
      provider_reference_sha256: providerReferenceSha256,
    },
    transaction_status: transactionStatus,
  },
  managed_callback: managedCallback,
};
fs.writeFileSync(journalPath, `${JSON.stringify(finalEvidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(finalEvidence, null, 2));
if (transactionStatus.verification.outcome !== "PASS") {
  throw new Error(`DUITKU_STATUS_VERIFICATION_HOLD: ${transactionStatus.verification.blockers.join(",")}`);
}
