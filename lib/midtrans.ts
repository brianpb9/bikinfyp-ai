// Midtrans Snap + verifikasi signature webhook (PALING KRITIS untuk uang sungguhan).
// Docs: https://docs.midtrans.com/reference/transaction-api
//  - Snap: POST {base}/snap/v1/transactions, auth Basic base64(SERVER_KEY + ":")
//  - Webhook signature: sha512(order_id + status_code + gross_amount + SERVER_KEY)

import crypto from "node:crypto";
import { config } from "./config";
import { TOPUP_PACKAGES } from "./credits";

export class MidtransNotConfigured extends Error {
  constructor() {
    super("MIDTRANS_SERVER_KEY belum diisi di server — pembayaran online belum aktif.");
    this.name = "MidtransNotConfigured";
  }
}

/** Callback pembayaran wajib berasal dari konfigurasi deploy, bukan request host. */
export class MidtransCallbackNotConfigured extends Error {
  constructor() {
    super("APP_BASE_URL harus berupa origin HTTPS publik tanpa path untuk callback Midtrans.");
    this.name = "MidtransCallbackNotConfigured";
  }
}

export function midtransNotificationUrl(appBaseUrl = config.appBaseUrl): string {
  try {
    const base = new URL(appBaseUrl);
    // Tidak menerima userinfo, port, query, fragment, atau path deploy yang
    // ambigu. Host hanya dapat ditentukan oleh konfigurasi server.
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
    return new URL("/api/webhooks/midtrans", base.origin).toString();
  } catch {
    throw new MidtransCallbackNotConfigured();
  }
}

export function midtransBase(): string {
  return config.midtransIsProduction
    ? "https://app.midtrans.com"
    : "https://app.sandbox.midtrans.com";
}

export function newOrderId(userId: string): string {
  return `racun-${userId.slice(0, 8)}-${crypto.randomUUID().slice(0, 13)}`;
}

export async function createSnapTransaction(opts: {
  orderId: string;
  packageId: string;
  phone: string;
}): Promise<{ snapToken: string; redirectUrl: string }> {
  if (!config.midtransServerKey) throw new MidtransNotConfigured();
  const notificationUrl = midtransNotificationUrl();
  const pkg = TOPUP_PACKAGES.find((p) => p.id === opts.packageId);
  if (!pkg) throw new Error(`Paket tidak dikenal: ${opts.packageId}`);

  const res = await fetch(`${midtransBase()}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + Buffer.from(config.midtransServerKey + ":").toString("base64"),
      // Midtrans Snap memakai header override per transaksi, bukan host request
      // atau redirect pengguna, untuk endpoint notifikasi server-ke-server.
      "X-Override-Notification": notificationUrl,
    },
    body: JSON.stringify({
      transaction_details: { order_id: opts.orderId, gross_amount: pkg.priceIdr },
      item_details: [
        { id: pkg.id, price: pkg.priceIdr, quantity: 1, name: `${pkg.name} BikinFYP.AI` },
      ],
      customer_details: { phone: opts.phone },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    redirect_url?: string;
    error_messages?: string[];
  };
  if (!res.ok || !data.token) {
    throw new Error(`midtrans: HTTP ${res.status} ${(data.error_messages ?? []).join(", ")}`);
  }
  return { snapToken: data.token, redirectUrl: data.redirect_url ?? "" };
}

/** Verifikasi signature webhook Midtrans. WAJIB sebelum side effect apa pun. */
export function verifyMidtransSignature(payload: {
  order_id?: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
}): boolean {
  if (!config.midtransServerKey) return false;
  const { order_id, status_code, gross_amount, signature_key } = payload;
  if (!order_id || !status_code || !gross_amount || !signature_key) return false;
  const expected = crypto
    .createHash("sha512")
    .update(order_id + status_code + gross_amount + config.midtransServerKey)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature_key), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
