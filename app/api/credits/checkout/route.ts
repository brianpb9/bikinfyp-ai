import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit } from "@/lib/db";
import { config, paymentsEnv } from "@/lib/config";
import { createSnapTransaction, newOrderId, MidtransCallbackNotConfigured, MidtransNotConfigured } from "@/lib/midtrans";
import { createDuitkuInvoice, createDuitkuTransaction, kanalSah, KANAL_DUITKU, DuitkuCallbackNotConfigured, DuitkuNotConfigured } from "@/lib/duitku";
import { pgCreateCheckout, pgMarkPaymentInitiationFailed, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { initiateCheckout, type CheckoutDeps } from "@/lib/payment-checkout";
import { emailOrderDibuat } from "@/lib/email-pembayaran";
import { TOPUP_PACKAGES } from "@/lib/credits";

import { pastikanSegar } from "@/lib/kredensial";
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
        await pgCreateCheckout({ userId, gateway, gatewayRef: orderId, packageId, rawPayload: { package_id: packageId, payments_env: paymentsEnv() } });
        return;
      }
      getDb().prepare(
        "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(uuid(), userId, gateway, orderId, amountIdr, amountIdr, "pending", JSON.stringify({ package_id: packageId, payments_env: paymentsEnv() }), now());
      audit(userId, "payment.checkout", "payments", orderId, { package_id: packageId, amount_idr: amountIdr, gateway });
    },
    async createPayment({ orderId, packageId, phone, email, method }) {
      if (gateway === "duitku") {
        // Kanal dipilih pembeli -> jalur v2 (QRIS/VA saja, sesuai daftar kita).
        // Tanpa kanal -> POP lama, dipertahankan sebagai jalur mundur.
        if (method) return createDuitkuTransaction({ orderId, packageId, phone, email, method });
        return createDuitkuInvoice({ orderId, packageId, phone, email });
      }
      // Kompatibilitas Duitku lama: field phone diisi email bila kosong.
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
// invoice di gateway aktif (Duitku POP; Midtrans Snap = jalur rollback).
export async function POST(req: Request) {
  try {
    // Kredensial bisa diganti dari dashboard tanpa restart; segarkan
    // sebelum dipakai. Ber-TTL, jadi paling sering satu query/30 detik.
    await pastikanSegar();
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const packageId = String(body.package_id ?? "");
    // Kanal DIVALIDASI di server, bukan dipercaya dari klien: daftar yang
    // dikirim klien bisa memuat kanal berbiaya yang sengaja tidak kita tawarkan.
    const method = body.payment_method ? String(body.payment_method) : undefined;
    if (method && !kanalSah(method)) {
      throw ERR.BAD_REQUEST(
        `Metode pembayarannya nggak tersedia. Pilih: ${KANAL_DUITKU.map((k) => k.nama).join(", ")}.`,
        `Unsupported payment method: ${method}`,
      );
    }
    try {
      const checkout = await initiateCheckout(user, packageId, productionCheckoutDeps(), method);

      // KABARI LEWAT EMAIL, karena nomor VA dibutuhkan NANTI.
      //
      // Pembeli membuka aplikasi banknya beberapa menit kemudian, di perangkat
      // lain, setelah tab ini ditutup. Nomor yang cuma ada di layar sudah
      // hilang tepat saat ia dibutuhkan.
      //
      // Sengaja TIDAK di-await bersama respons: order sudah terbentuk di
      // Duitku, dan menahan jawaban demi email membuat checkout yang sudah
      // berhasil terasa lambat — atau lebih buruk, gagal. Kegagalan email
      // ditelan dan dicatat di lib/email-pembayaran.ts.
      if (user.email) {
        const pkg = TOPUP_PACKAGES.find((p) => p.id === packageId);
        void emailOrderDibuat({
          ke: user.email,
          orderId: checkout.orderId,
          namaPaket: pkg?.name ?? packageId,
          jumlahIdr: pkg?.priceIdr ?? 0,
          namaKanal: KANAL_DUITKU.find((k) => k.kode === method)?.nama ?? "pembayaran",
          vaNumber: checkout.vaNumber,
          redirectUrl: checkout.redirectUrl,
          kedaluwarsaMenit: 60,
        });
      }

      return Response.json(
        {
          order_id: checkout.orderId,
          provider_ref: checkout.providerRef,
          redirect_url: checkout.redirectUrl,
          ...(checkout.vaNumber ? { va_number: checkout.vaNumber } : {}),
          ...(checkout.qrString ? { qr_string: checkout.qrString } : {}),
        },
        { status: 201 },
      );
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
