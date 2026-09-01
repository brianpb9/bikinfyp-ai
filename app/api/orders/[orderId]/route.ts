import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { getBalance } from "@/lib/credits";
import { pgGetBalance, pgGetPayment, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { JANJI_WAKTU } from "@/lib/janji-waktu";
import { config, paymentsProvider } from "@/lib/config";
import { duitkuStatusTransaksi } from "@/lib/duitku";
import { pastikanSegar } from "@/lib/kredensial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BarisPembayaran = { gateway_ref: string; amount_idr: number; status: string; created_at: string };

/** Kalimat yang jujur untuk tiap status — bukan satu kalimat untuk semuanya. */
function pesanUntuk(status: string): string {
  switch (status) {
    case "paid":
      return "Pembayaran berhasil — kredit sudah masuk.";
    case "sandbox_paid":
      // Keadaan ini NYATA dan pernah membingungkan: pembayaran benar-benar
      // terkonfirmasi Duitku, tapi kredit sengaja ditahan karena lingkungan
      // masih sandbox. Mengatakannya "belum masuk" adalah bohong; mengatakannya
      // "berhasil" membuat orang menunggu kredit yang tidak akan datang.
      return "Pembayaran sandbox terkonfirmasi. Kredit tidak ditambahkan karena ini mode uji.";
    case "failed":
      return "Pembayaran gagal atau kedaluwarsa. Coba checkout lagi ya.";
    case "cancelled":
      return "Pesanan ini sudah dibatalkan.";
    default:
      return `Pembayaran belum masuk — kalau sudah bayar, tunggu ${JANJI_WAKTU.tungguPembayaran} lalu cek lagi.`;
  }
}

async function tandaiGagal(orderId: string, userId: string): Promise<void> {
  if (postgresRuntimeEnabled()) {
    const { getPool } = await import("@/lib/postgres/pool");
    await getPool(config.databaseUrl).query(
      "UPDATE payments SET status = 'failed' WHERE gateway_ref = $1 AND user_id = $2 AND status = 'pending'",
      [orderId, userId],
    );
    return;
  }
  getDb()
    .prepare("UPDATE payments SET status = 'failed' WHERE gateway_ref = ? AND user_id = ? AND status = 'pending'")
    .run(orderId, userId);
}

/**
 * GET /api/orders/[orderId] — status order untuk tombol "Sudah bayar? Cek status".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MENANYAKAN ULANG KE DUITKU, BUKAN CUMA MEMBACA CATATAN SENDIRI
 * ────────────────────────────────────────────────────────────────────────────
 * Versi sebelumnya hanya membaca tabel payments. Artinya kalau callback Duitku
 * tidak pernah tiba — jaringan, deploy yang kebetulan berlangsung, atau Duitku
 * menyerah setelah beberapa percobaan — order itu "pending" SELAMANYA, dan
 * satu-satunya yang tahu adalah pembeli yang komplain.
 *
 * Sekarang tombol "Cek status" benar-benar MENGECEK. Kegagalan bertanya tidak
 * pernah menjatuhkan permintaan ini: jawaban dari database tetap diberikan,
 * hanya tanpa pembaruan.
 */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    await pastikanSegar();
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { orderId } = await ctx.params;

    const baca = async (): Promise<BarisPembayaran | undefined> =>
      postgresRuntimeEnabled()
        ? ((await pgGetPayment(orderId, user.id)) as BarisPembayaran | undefined)
        : (getDb()
            .prepare("SELECT gateway_ref, amount_idr, status, created_at FROM payments WHERE gateway_ref = ? AND user_id = ?")
            .get(orderId, user.id) as BarisPembayaran | undefined);

    let payment = await baca();
    if (!payment) throw ERR.NOT_FOUND("Ordernya");

    let ditanyakan = false;
    if (payment.status === "pending" && paymentsProvider() === "duitku") {
      try {
        const s = await duitkuStatusTransaksi(orderId);
        ditanyakan = true;
        // KREDIT TIDAK PERNAH DITAMBAHKAN DARI SINI, walau Duitku bilang sukses.
        //
        // Rute ini dipanggil dari browser pengguna. Menjadikan panggilan
        // browser sebagai pemicu penambahan saldo membuka jalur penambahan uang
        // yang tanda tangannya tidak pernah diverifikasi siapa pun. Pengkreditan
        // tetap hanya di webhook. Yang dilakukan di sini: mencatat kegagalan,
        // supaya order mati berhenti menyamar sebagai order yang sedang
        // menunggu.
        if (s.statusCode === "02") {
          await tandaiGagal(orderId, user.id);
          payment = (await baca()) ?? payment;
        }
      } catch (err) {
        console.error(`[orders] gagal menanyakan status ${orderId} ke Duitku:`, err);
      }
    }

    return Response.json({
      order_id: payment.gateway_ref,
      amount_idr: payment.amount_idr,
      status: payment.status,
      balance: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
      // Jujur soal apakah kita benar-benar bertanya atau cuma membaca catatan
      // sendiri. Kalau nanti ada keluhan "sudah cek status tapi tetap pending",
      // inilah yang membedakan callback hilang dari pembeli yang belum bayar.
      dicek_ke_gateway: ditanyakan,
      message: pesanUntuk(payment.status),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/orders/[orderId] — batalkan pesanan yang belum dibayar.
 *
 * BATASNYA HARUS DIKATAKAN: Duitku POP tidak menyediakan pembatalan invoice
 * dari sisi merchant — invoice hanya kedaluwarsa sendiri (60 menit). Jadi yang
 * dibatalkan di sini adalah PESANAN KITA, bukan invoice mereka. Nomor VA yang
 * sudah terbit tetap hidup sampai kedaluwarsa.
 *
 * Karena itu penjagaannya penting: order yang SUDAH dibayar tidak boleh
 * dibatalkan. Kalau uang sudah masuk sementara kita menandainya batal, callback
 * yang tiba berikutnya akan menghadapi pesanan yang tidak lagi menunggu.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { orderId } = await ctx.params;

    if (postgresRuntimeEnabled()) {
      const { getPool } = await import("@/lib/postgres/pool");
      const { rowCount } = await getPool(config.databaseUrl).query(
        "UPDATE payments SET status = 'cancelled' WHERE gateway_ref = $1 AND user_id = $2 AND status = 'pending'",
        [orderId, user.id],
      );
      if (!rowCount) throw ERR.BAD_REQUEST("Pesanan ini tidak bisa dibatalkan.", "Order is not cancellable.");
    } else {
      const info = getDb()
        .prepare("UPDATE payments SET status = 'cancelled' WHERE gateway_ref = ? AND user_id = ? AND status = 'pending'")
        .run(orderId, user.id);
      if (!info.changes) throw ERR.BAD_REQUEST("Pesanan ini tidak bisa dibatalkan.", "Order is not cancellable.");
    }

    return Response.json({
      ok: true,
      order_id: orderId,
      status: "cancelled",
      catatan: "Nomor pembayaran yang sudah terbit tetap berlaku sampai kedaluwarsa — jangan ditransfer.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
