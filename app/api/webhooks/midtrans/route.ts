import { errorResponse } from "@/lib/errors";
import { getDb, now, audit } from "@/lib/db";
import { verifyMidtransSignature } from "@/lib/midtrans";
import { creditTopup } from "@/lib/credits";
import { pgAudit, pgCreditTopup, pgGetPayment, pgMarkPaymentFailed, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PaymentRow {
  id: string;
  user_id: string;
  gateway: string;
  gateway_ref: string;
  amount_idr: number;
  credits: number;
  status: string;
  raw_payload: string | null;
}

// POST /api/webhooks/midtrans — notifikasi status dari Midtrans.
// WAJIB lolos verifikasi signature sha512(order_id+status_code+gross_amount+SERVER_KEY).
// Signature salah/tidak ada -> 401, TANPA side effect (lubang lama tertutup di sini).
export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as Record<string, string>;
    if (!verifyMidtransSignature(payload)) {
      if (postgresRuntimeEnabled()) await pgAudit("midtrans", "webhook.signature_rejected", "payments", payload?.order_id ?? null, {
        order_id: payload?.order_id,
      }); else audit("midtrans", "webhook.signature_rejected", "payments", payload?.order_id ?? null, {
        order_id: payload?.order_id,
      });
      return Response.json(
        { code: "INVALID_SIGNATURE", message_id: "Signature tidak valid.", message_en: "Invalid signature.", retryable: false },
        { status: 401 }
      );
    }

    const orderId = String(payload.order_id);
    const txnStatus = String(payload.transaction_status ?? "");
    const fraudStatus = String(payload.fraud_status ?? "");
    const db = postgresRuntimeEnabled() ? null : getDb();
    const payment = postgresRuntimeEnabled() ? await pgGetPayment(orderId) : db!
      .prepare("SELECT * FROM payments WHERE gateway = 'midtrans' AND gateway_ref = ?")
      .get(orderId) as PaymentRow | undefined;
    if (!payment) {
      // Order tidak dikenal — jawab 200 agar Midtrans tidak retry tanpa henti, tapi tanpa side effect.
      return Response.json({ ok: true, ignored: true, reason: "order tidak dikenal" });
    }

    const packageId = (JSON.parse(payment.raw_payload ?? "{}") as { package_id?: string }).package_id ?? "";

    if (txnStatus === "settlement" || (txnStatus === "capture" && (fraudStatus === "accept" || fraudStatus === ""))) {
      // Sudah dibayar sebelumnya -> jawab idempoten TANPA menyentuh apa pun
      if (payment.status === "paid") {
        return Response.json({ ok: true, credited: false, duplicated: true });
      }
      // Idempoten via gateway_ref = order_id (creditTopup menolak duplikat)
      const result = postgresRuntimeEnabled() ? await pgCreditTopup({
        userId: payment.user_id,
        packageId,
        gateway: "midtrans",
        gatewayRef: orderId,
        rawPayload: payload,
      }) : creditTopup({ userId: payment.user_id, packageId, gateway: "midtrans", gatewayRef: orderId, rawPayload: payload });
      if (postgresRuntimeEnabled()) await pgAudit("midtrans", "webhook.settlement", "payments", orderId, { duplicated: result.duplicated });
      else audit("midtrans", "webhook.settlement", "payments", orderId, { duplicated: result.duplicated });
      return Response.json({ ok: true, credited: !result.duplicated, duplicated: result.duplicated });
    }

    if (["deny", "cancel", "expire"].includes(txnStatus)) {
      if (postgresRuntimeEnabled()) {
        await pgMarkPaymentFailed("midtrans", orderId, payload);
        await pgAudit("midtrans", `webhook.${txnStatus}`, "payments", orderId, {});
      } else {
        db!.prepare("UPDATE payments SET status = 'failed', raw_payload = ? WHERE id = ?").run(JSON.stringify(payload), payment.id);
        audit("midtrans", `webhook.${txnStatus}`, "payments", orderId, {});
      }
      return Response.json({ ok: true, failed: txnStatus });
    }

    // pending / challenge / refund dsb — catat saja
    return Response.json({ ok: true, ignored: true, transaction_status: txnStatus });
  } catch (err) {
    return errorResponse(err);
  }
}
