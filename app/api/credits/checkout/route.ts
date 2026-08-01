import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit } from "@/lib/db";
import { createSnapTransaction, newOrderId, MidtransCallbackNotConfigured, MidtransNotConfigured } from "@/lib/midtrans";
import { TOPUP_PACKAGES } from "@/lib/credits";
import { pgAudit, pgCreateCheckout, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/credits/checkout {package_id} — buat order Midtrans Snap (pending).
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const packageId = String(body.package_id ?? "");
    const pkg = TOPUP_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) throw ERR.BAD_REQUEST("Paketnya nggak ketemu. Coba pilih paket lain ya.", "Unknown package.");

    try {
      const orderId = newOrderId(user.id);
      const { snapToken, redirectUrl } = await createSnapTransaction({
        orderId,
        packageId,
        phone: user.phone ?? user.email ?? "",
      });
      if (postgresRuntimeEnabled()) await pgCreateCheckout({ userId: user.id, gateway: "midtrans", gatewayRef: orderId, packageId, rawPayload: { package_id: packageId } });
      else getDb()
        .prepare(
          "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
        )
        .run(uuid(), user.id, "midtrans", orderId, pkg.priceIdr, pkg.priceIdr, "pending", JSON.stringify({ package_id: packageId }), now());
      if (postgresRuntimeEnabled()) await pgAudit(user.id, "payment.checkout", "payments", orderId, { package_id: packageId, amount_idr: pkg.priceIdr });
      else audit(user.id, "payment.checkout", "payments", orderId, { package_id: packageId, amount_idr: pkg.priceIdr });
      return Response.json({ order_id: orderId, snap_token: snapToken, redirect_url: redirectUrl }, { status: 201 });
    } catch (err) {
      if (err instanceof MidtransNotConfigured || err instanceof MidtransCallbackNotConfigured) {
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
