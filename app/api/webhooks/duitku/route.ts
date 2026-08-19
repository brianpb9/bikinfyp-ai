import { errorResponse } from "@/lib/errors";
import { getDb, audit } from "@/lib/db";
import { verifyDuitkuCallbackSignature } from "@/lib/duitku";
import { grossAmountMatchesStoredAmount } from "@/lib/payment-amount";
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

// POST /api/webhooks/duitku — callback status dari Duitku (x-www-form-urlencoded).
// WAJIB lolos verifikasi signature md5(merchantCode+amount+merchantOrderId+API_KEY).
// Signature salah/tidak ada -> 401, TANPA side effect — pola yang sama dengan
// webhook Midtrans (lubang lama yang sudah ditutup tidak boleh dibuka ulang di
// gateway baru).
export async function POST(req: Request) {
  try {
    // Duitku mengirim form-urlencoded, bukan JSON.
    const form = await req.formData().catch(() => null);
    const payload: Record<string, string> = {};
    if (form) for (const [k, v] of form.entries()) payload[k] = String(v);

    if (!verifyDuitkuCallbackSignature(payload)) {
      if (postgresRuntimeEnabled()) await pgAudit("duitku", "webhook.signature_rejected", "payments", payload?.merchantOrderId ?? null, {
        merchant_order_id: payload?.merchantOrderId,
      }); else audit("duitku", "webhook.signature_rejected", "payments", payload?.merchantOrderId ?? null, {
        merchant_order_id: payload?.merchantOrderId,
      });
      return Response.json(
        { code: "INVALID_SIGNATURE", message_id: "Signature tidak valid.", message_en: "Invalid signature.", retryable: false },
        { status: 401 }
      );
    }

    const orderId = String(payload.merchantOrderId);
    const resultCode = String(payload.resultCode ?? "");
    const db = postgresRuntimeEnabled() ? null : getDb();
    const payment = postgresRuntimeEnabled() ? await pgGetPayment(orderId) : db!
      .prepare("SELECT * FROM payments WHERE gateway = 'duitku' AND gateway_ref = ?")
      .get(orderId) as PaymentRow | undefined;
    if (!payment) {
      // Order tidak dikenal — jawab 200 agar Duitku tidak retry tanpa henti, tapi tanpa side effect.
      return Response.json({ ok: true, ignored: true, reason: "order tidak dikenal" });
    }

    // Signature sah membuktikan pengirimnya Duitku, bukan bahwa payload ini
    // milik order ini. Ikat ke amount tersimpan sebelum transisi status apa pun.
    if (!grossAmountMatchesStoredAmount(payload.amount, payment.amount_idr)) {
      const metadata = { merchant_order_id: orderId, amount: payload.amount ?? null, expected_amount_idr: payment.amount_idr };
      if (postgresRuntimeEnabled()) await pgAudit("duitku", "webhook.gross_amount_rejected", "payments", orderId, metadata);
      else audit("duitku", "webhook.gross_amount_rejected", "payments", orderId, metadata);
      return Response.json(
        { code: "GROSS_AMOUNT_MISMATCH", message_id: "Jumlah pembayaran tidak cocok dengan order.", message_en: "Payment amount does not match order.", retryable: false },
        { status: 422 }
      );
    }

    const packageId = (JSON.parse(payment.raw_payload ?? "{}") as { package_id?: string }).package_id ?? "";

    if (resultCode === "00") {
      // Sudah dibayar sebelumnya -> jawab idempoten TANPA menyentuh apa pun
      if (payment.status === "paid") {
        return Response.json({ ok: true, credited: false, duplicated: true });
      }
      // Idempoten via gateway_ref = merchantOrderId (creditTopup menolak duplikat)
      const result = postgresRuntimeEnabled() ? await pgCreditTopup({
        userId: payment.user_id,
        packageId,
        gateway: "duitku",
        gatewayRef: orderId,
        rawPayload: payload,
      }) : creditTopup({ userId: payment.user_id, packageId, gateway: "duitku", gatewayRef: orderId, rawPayload: payload });
      if (postgresRuntimeEnabled()) await pgAudit("duitku", "webhook.settlement", "payments", orderId, { duplicated: result.duplicated });
      else audit("duitku", "webhook.settlement", "payments", orderId, { duplicated: result.duplicated });
      return Response.json({ ok: true, credited: !result.duplicated, duplicated: result.duplicated });
    }

    if (resultCode === "01") {
      // Dokumentasi Duitku POP: 00 = sukses, 01 = gagal. Invoice kedaluwarsa
      // tidak mengirim callback — order pending menua ditangani rekonsiliasi.
      if (postgresRuntimeEnabled()) {
        await pgMarkPaymentFailed("duitku", orderId, payload);
        await pgAudit("duitku", "webhook.failed", "payments", orderId, {});
      } else {
        db!.prepare("UPDATE payments SET status = 'failed', raw_payload = ? WHERE id = ? AND status != 'paid'").run(JSON.stringify(payload), payment.id);
        audit("duitku", "webhook.failed", "payments", orderId, {});
      }
      return Response.json({ ok: true, failed: resultCode });
    }

    // resultCode lain — catat saja, tanpa transisi status.
    return Response.json({ ok: true, ignored: true, result_code: resultCode });
  } catch (err) {
    return errorResponse(err);
  }
}
