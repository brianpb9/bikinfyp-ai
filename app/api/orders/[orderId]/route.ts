import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { getBalance } from "@/lib/credits";
import { pgGetBalance, pgGetPayment, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { JANJI_WAKTU } from "@/lib/janji-waktu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/[orderId] — status order untuk tombol "Sudah bayar? Cek status".
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { orderId } = await ctx.params;
    const payment = postgresRuntimeEnabled() ? await pgGetPayment(orderId, user.id) : getDb()
      .prepare("SELECT gateway_ref, amount_idr, status, created_at FROM payments WHERE gateway_ref = ? AND user_id = ?")
      .get(orderId, user.id) as { gateway_ref: string; amount_idr: number; status: string; created_at: string } | undefined;
    if (!payment) throw ERR.NOT_FOUND("Ordernya");
    return Response.json({
      order_id: payment.gateway_ref,
      amount_idr: payment.amount_idr,
      status: payment.status,
      balance: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
      message:
        payment.status === "paid"
          ? "Pembayaran berhasil — kredit sudah masuk."
          : payment.status === "failed"
            ? "Pembayaran gagal/kedaluwarsa. Coba checkout lagi ya."
            : `Pembayaran belum masuk — kalau sudah bayar, tunggu ${JANJI_WAKTU.tungguPembayaran} lalu cek lagi.`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
