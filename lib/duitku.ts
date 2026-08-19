// Duitku POP: buat invoice + verifikasi signature callback (uang sungguhan).
// Docs: https://docs.duitku.com/pop/en/ — formula diverifikasi terhadap SDK
// resmi duitkupg/duitku-php (Pop.php, 2026-08-19):
//  - createInvoice: POST {base}/api/merchant/createInvoice
//    header x-duitku-signature = sha256(merchantCode + timestampMs + apiKey)
//  - callback: POST x-www-form-urlencoded,
//    signature = md5(merchantCode + amount + merchantOrderId + apiKey)
//  - transactionStatus: POST {base}/api/merchant/transactionStatus,
//    signature = md5(merchantCode + merchantOrderId + apiKey)

import crypto from "node:crypto";
import { config } from "./config";
import { TOPUP_PACKAGES } from "./credits";

export class DuitkuNotConfigured extends Error {
  constructor() {
    super("DUITKU_MERCHANT_CODE / DUITKU_API_KEY belum diisi di server — pembayaran online belum aktif.");
    this.name = "DuitkuNotConfigured";
  }
}

/** URL callback/return wajib berasal dari konfigurasi deploy, bukan request host. */
export class DuitkuCallbackNotConfigured extends Error {
  constructor() {
    super("APP_BASE_URL harus berupa origin HTTPS publik tanpa path untuk callback Duitku.");
    this.name = "DuitkuCallbackNotConfigured";
  }
}

/** Aturan validasi sama persis dengan midtransNotificationUrl: origin HTTPS bersih. */
function publicUrl(path: string, appBaseUrl = config.appBaseUrl): string {
  try {
    const base = new URL(appBaseUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.port ||
      base.search ||
      base.hash ||
      (base.pathname !== "" && base.pathname !== "/")
    ) {
      throw new Error("invalid APP_BASE_URL");
    }
    return new URL(path, base.origin).toString();
  } catch {
    throw new DuitkuCallbackNotConfigured();
  }
}

export function duitkuBase(): string {
  return config.duitkuIsProduction
    ? "https://api-prod.duitku.com"
    : "https://api-sandbox.duitku.com";
}

export async function createDuitkuInvoice(opts: {
  orderId: string;
  packageId: string;
  phone: string;
  email: string;
}): Promise<{ providerRef: string; redirectUrl: string }> {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) throw new DuitkuNotConfigured();
  const callbackUrl = publicUrl("/api/webhooks/duitku");
  // Duitku menempelkan merchantOrderId/resultCode/reference sebagai query di
  // returnUrl; /kredit membacanya untuk melanjutkan cek status order.
  const returnUrl = publicUrl("/kredit");
  const pkg = TOPUP_PACKAGES.find((p) => p.id === opts.packageId);
  if (!pkg) throw new Error(`Paket tidak dikenal: ${opts.packageId}`);

  const timestamp = Date.now();
  const signature = crypto
    .createHash("sha256")
    .update(config.duitkuMerchantCode + timestamp + config.duitkuApiKey)
    .digest("hex");

  const res = await fetch(`${duitkuBase()}/api/merchant/createInvoice`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-duitku-signature": signature,
      "x-duitku-timestamp": String(timestamp),
      "x-duitku-merchantcode": config.duitkuMerchantCode,
    },
    body: JSON.stringify({
      paymentAmount: pkg.priceIdr,
      merchantOrderId: opts.orderId,
      productDetails: `${pkg.name} BikinFYP AI`,
      // Duitku mewajibkan email; user login-Google/OTP selalu punya, sisanya
      // jatuh ke email dukungan merchant agar invoice tetap bisa dibuat.
      email: opts.email || "hdrvstudio@gmail.com",
      phoneNumber: opts.phone,
      itemDetails: [{ name: `${pkg.name} BikinFYP AI`, price: pkg.priceIdr, quantity: 1 }],
      callbackUrl,
      returnUrl,
      expiryPeriod: 60, // menit — selaras dengan janji "cek status" di /kredit
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    statusCode?: string;
    statusMessage?: string;
    reference?: string;
    paymentUrl?: string;
  };
  if (!res.ok || data.statusCode !== "00" || !data.paymentUrl) {
    throw new Error(`duitku: HTTP ${res.status} ${data.statusMessage ?? "createInvoice gagal"}`);
  }
  return { providerRef: data.reference ?? opts.orderId, redirectUrl: data.paymentUrl };
}

/**
 * Verifikasi signature callback Duitku. WAJIB sebelum side effect apa pun.
 * Formula: md5(merchantCode + amount + merchantOrderId + apiKey) — pakai string
 * mentah persis seperti yang dikirim Duitku, tanpa normalisasi angka.
 */
export function verifyDuitkuCallbackSignature(payload: {
  merchantCode?: string;
  amount?: string;
  merchantOrderId?: string;
  signature?: string;
}): boolean {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) return false;
  const { merchantCode, amount, merchantOrderId, signature } = payload;
  if (!merchantCode || !amount || !merchantOrderId || !signature) return false;
  // Callback untuk merchant lain tidak pernah sah di sini.
  if (merchantCode !== config.duitkuMerchantCode) return false;
  const expected = crypto
    .createHash("md5")
    .update(merchantCode + amount + merchantOrderId + config.duitkuApiKey)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature).toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Cek status transaksi ke Duitku (dipakai rekonsiliasi manual, bukan jalur utama). */
export async function duitkuTransactionStatus(orderId: string): Promise<{
  statusCode?: string;
  statusMessage?: string;
  reference?: string;
  amount?: string;
}> {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) throw new DuitkuNotConfigured();
  const signature = crypto
    .createHash("md5")
    .update(config.duitkuMerchantCode + orderId + config.duitkuApiKey)
    .digest("hex");
  const res = await fetch(`${duitkuBase()}/api/merchant/transactionStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchantCode: config.duitkuMerchantCode, merchantOrderId: orderId, signature }),
  });
  return (await res.json().catch(() => ({}))) as {
    statusCode?: string;
    statusMessage?: string;
    reference?: string;
    amount?: string;
  };
}
