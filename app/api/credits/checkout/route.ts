import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit } from "@/lib/db";
import { config } from "@/lib/config";
import { createSnapTransaction, newOrderId, MidtransCallbackNotConfigured, MidtransNotConfigured } from "@/lib/midtrans";
import { createDuitkuInvoice, DuitkuCallbackNotConfigured, DuitkuNotConfigured } from "@/lib/duitku";
import { pgCreateCheckout, pgMarkPaymentInitiationFailed, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { initiateCheckout, type CheckoutDeps } from "@/lib/payment-checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gateway aktif dipilih lewat env PAYMENT_GATEWAY (keputusan pindah ke Duitku,
// 2026-08-19). String gateway ini juga tersimpan di kolom payments.gateway dan
// dipakai webhook masing-masing untuk menemukan order — keduanya wajib sama.
const activeGateway = (): "midtrans" | "duitku" => (config.paymentGateway === "duitku" ? "duitku" : "midtrans");

const productionCheckoutDeps = (): CheckoutDeps => {
  const gateway = activeGateway();
  return {
    newOrderId,
    async persistPending({ userId, orderId, packageId, amountIdr }) {
      if (postgresRuntimeEnabled()) {
        await pgCreateCheckout({ userId, gateway, gatewayRef: orderId, packageId, rawPayload: { package_id: packageId } });
        return;
      }
      getDb().prepare(
        "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(uuid(), userId, gateway, orderId, amountIdr, amountIdr, "pending", JSON.stringify({ package_id: packageId }), now());
      audit(userId, "payment.checkout", "payments", orderId, { package_id: packageId, amount_idr: amountIdr, gateway });
    },
    async createPayment({ orderId, packageId, phone, email }) {
      if (gateway === "duitku") {
        return createDuitkuInvoice({ orderId, packageId, phone, email });
      }
      // Kompatibilitas Midtrans lama: field phone diisi email bila kosong.
      const snap = await createSnapTransaction({ orderId, packageId, phone: phone || email });
      return { providerRef: snap.snapToken, redirectUrl: snap.redirectUrl };
    },
    async markInitiationFailed(orderId, failure) {
      if (postgresRuntimeEnabled()) {
        await pgMarkPaymentInitiationFailed(gateway, orderId, failure);
        return;
      }
      const db = getDb();
      const payment = db.prepare("SELECT id, user_id, raw_payload FROM payments WHERE gateway = ? AND gateway_ref = ?").get(gateway, orderId) as { id: string; user_id: string; raw_payload: string | null } | undefined;
      if (!payment) return;
      let oldPayload: Record<string, unknown> = {};
      try { oldPayload = JSON.parse(payment.raw_payload ?? "{}") as Record<string, unknown>; } catch { /* preserve failed state even if old audit payload is malformed */ }
      db.prepare("UPDATE payments SET status = 'failed', raw_payload = ? WHERE id = ? AND status != 'paid'").run(JSON.stringify({ ...oldPayload, provider_initiation: failure }), payment.id);
      audit(payment.user_id, "payment.initiation_failed", "payments", orderId, {});
    },
  };
};

// POST /api/credits/checkout {package_id} — persist pending order lalu buat
// invoice di gateway aktif (Duitku POP / Midtrans Snap).
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const packageId = String(body.package_id ?? "");
    try {
      const checkout = await initiateCheckout(user, packageId, productionCheckoutDeps());
      return Response.json({ order_id: checkout.orderId, provider_ref: checkout.providerRef, redirect_url: checkout.redirectUrl }, { status: 201 });
    } catch (err) {
      if (
        err instanceof MidtransNotConfigured ||
        err instanceof MidtransCallbackNotConfigured ||
        err instanceof DuitkuNotConfigured ||
        err instanceof DuitkuCallbackNotConfigured
      ) {
        return Response.json(
          {
            code: "PAYMENT_NOT_CONFIGURED",
            message_id: "Pembayaran online belum aktif — server kami belum dipasangi kunci pembayaran. Hubungi tim kami ya.",
            message_en: err.message,
            retryable: false,
          },
          { status: 503 }
        );
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
