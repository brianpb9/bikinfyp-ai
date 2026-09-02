import { errorResponse } from "@/lib/errors";
import { paymentsEnv } from "@/lib/config";
import { apakahPengujiSandbox } from "@/lib/admin-auth";
import { getDb, audit } from "@/lib/db";
import { verifyDuitkuCallbackSignature } from "@/lib/duitku";
import { grossAmountMatchesStoredAmount } from "@/lib/payment-amount";
import { creditTopup, TOPUP_PACKAGES } from "@/lib/credits";
import { ambilPaket, kreditkanTopup, mulaiLangganan } from "@/lib/kredit-video-runtime";
import { pgAudit, pgCreditTopup, pgGetPayment, pgMarkPaymentFailed, postgresRuntimeEnabled, smokeGetUser } from "@/lib/postgres/smoke-runtime";

import { pastikanSegar } from "@/lib/kredensial";
import { emailPembayaranLunas } from "@/lib/email-pembayaran";
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
// webhook Duitku (lubang lama yang sudah ditutup tidak boleh dibuka ulang di
// gateway baru).
/** Email pemilik order — dipakai gerbang sandbox. null = tidak diketahui. */
async function emailPemilik(userId: string): Promise<string | null> {
  if (postgresRuntimeEnabled()) {
    const u = await smokeGetUser(userId).catch(() => null);
    return u?.email ?? null;
  }
  const row = getDb().prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string | null } | undefined;
  return row?.email ?? null;
}

/**
 * Tulis status pembayaran apa adanya, lewat jalur yang benar untuk runtime-nya.
 *
 * `AND status != 'paid'` menjaga agar callback susulan tidak menurunkan order
 * yang sudah lunas — Duitku mengulang callback saat tidak yakin diterima, dan
 * pengulangan tidak boleh membatalkan uang yang sudah masuk.
 */
async function tandaiStatus(paymentId: string, status: string, payload: unknown): Promise<void> {
  if (postgresRuntimeEnabled()) {
    const { getPool } = await import("@/lib/postgres/pool");
    const { config } = await import("@/lib/config");
    await getPool(config.databaseUrl).query(
      "UPDATE payments SET status = $1, raw_payload = $2 WHERE id = $3 AND status != 'paid'",
      [status, JSON.stringify(payload), paymentId],
    );
    return;
  }
  getDb()
    .prepare("UPDATE payments SET status = ?, raw_payload = ? WHERE id = ? AND status != 'paid'")
    .run(status, JSON.stringify(payload), paymentId);
}

export async function POST(req: Request) {
  try {
    // Kredensial bisa diganti dari dashboard tanpa restart; segarkan
    // sebelum dipakai. Ber-TTL, jadi paling sering satu query/30 detik.
    await pastikanSegar();
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

    const jejakOrder = (() => {
      try { return JSON.parse(payment.raw_payload ?? "{}") as { package_id?: string; payments_env?: string }; }
      catch { return {} as { package_id?: string; payments_env?: string }; }
    })();
    const packageId = jejakOrder.package_id ?? "";

    // PENANDA UJI — callback SANDBOX tidak boleh mengisi dompet nyata.
    //
    // Ini bukan kehati-hatian teoretis: pada uji 19 Agu satu callback sandbox
    // benar-benar mengkredit Rp60.000 ke dompet pengguna produksi. Uang mainan
    // yang menjadi saldo sungguhan adalah lubang akuntansi, dan ia akan
    // membengkak diam-diam selama merchant masih menunggu approval.
    //
    // Aturannya: selama lingkungan pembayaran masih sandbox, kredit hanya
    // diberikan kepada PENGUJI TERDAFTAR (ADMIN_EMAILS). Order milik orang
    // lain dijawab 200 (supaya Duitku berhenti mengulang) tapi TIDAK
    // mengkredit apa pun, dan penolakannya diaudit.
    if (resultCode === "00" && paymentsEnv() === "sandbox") {
      const email = await emailPemilik(payment.user_id);
      if (!apakahPengujiSandbox(email)) {
        // STATUS TETAP DICATAT, WALAU KREDIT DITAHAN.
        //
        // Versi sebelumnya keluar di sini tanpa menyentuh baris payments, jadi
        // ia tinggal "pending" SELAMANYA. Akibatnya persis yang dilaporkan
        // Brian 2 Sep: transaksi sukses di Duitku, tapi layar terus berkata
        // "Pembayaran belum masuk" — dan tidak ada cara membedakan order yang
        // benar-benar belum dibayar dari yang sudah dibayar tapi sengaja tidak
        // dikreditkan.
        //
        // "sandbox_paid" mengatakan kedua hal itu sekaligus: uangnya
        // terkonfirmasi, kreditnya tidak diberikan. Ia BUKAN "paid" — memakai
        // status yang sama akan membuat laporan keuangan menghitung uang
        // mainan sebagai pendapatan.
        await tandaiStatus(payment.id, "sandbox_paid", payload);
        const meta = { merchant_order_id: orderId, payments_env: "sandbox", order_env: jejakOrder.payments_env ?? null };
        if (postgresRuntimeEnabled()) await pgAudit("duitku", "webhook.sandbox_ditolak", "payments", orderId, meta);
        else audit("duitku", "webhook.sandbox_ditolak", "payments", orderId, meta);
        return Response.json({
          ok: true,
          credited: false,
          status: "sandbox_paid",
          reason: "sandbox: hanya penguji terdaftar yang dikredit",
        });
      }
    }

    if (resultCode === "00") {
      // Sudah dibayar sebelumnya -> jawab idempoten TANPA menyentuh apa pun
      if (payment.status === "paid") {
        return Response.json({ ok: true, credited: false, duplicated: true });
      }

      // ── Pesanan kredit video & langganan ─────────────────────────────────
      //
      // Jenis pesanan dibaca dari BARIS PESANAN, bukan ditebak dari isinya.
      // Menebak berarti suatu hari orang membayar paket lalu menerima kredit
      // satuan, atau sebaliknya.
      //
      // URUTANNYA DISENGAJA: kredit diberikan LEBIH DULU, status 'paid'
      // ditulis sesudahnya. Kebalikannya punya lubang yang tidak bisa pulih —
      // kalau proses mati setelah status jadi 'paid' tapi sebelum kredit
      // masuk, callback berikutnya berhenti di jawaban idempoten di atas dan
      // kreditnya TIDAK PERNAH diberikan. Dengan urutan ini, callback ulangan
      // menjalankan pemberian kredit lagi (yang idempoten lewat indeks unik)
      // lalu menuntaskan statusnya.
      const jenisPesanan = String((payment as { jenis_pesanan?: string }).jenis_pesanan ?? "saldo");
      if (jenisPesanan === "topup_video" || jenisPesanan === "langganan") {
        let diberi = 0;
        let namaPesanan = "Kredit video";
        if (jenisPesanan === "topup_video") {
          diberi = await kreditkanTopup(payment.user_id, orderId);
        } else {
          const paketId = String((payment as { paket_id?: string }).paket_id ?? "");
          const paket = await ambilPaket(paketId);
          if (!paket) {
            // Paket hilang setelah pesanan dibuat TIDAK boleh menelan uang
            // diam-diam. Dijawab 500 supaya Duitku mengulang dan kejadiannya
            // terlihat, bukan 200 yang membuatnya lenyap dari pantauan.
            console.error(`[duitku] paket ${paketId} tidak ditemukan untuk order ${orderId} yang sudah dibayar`);
            return Response.json({ code: "PACKAGE_MISSING", message_id: "Paket pesanan tidak ditemukan." }, { status: 500 });
          }
          namaPesanan = `Paket ${paket.nama}`;
          diberi = (await mulaiLangganan(payment.user_id, paket, orderId)) ? 1 : 0;
        }
        await tandaiStatus(payment.id, "paid", payload);
        const meta = { merchant_order_id: orderId, jenis_pesanan: jenisPesanan, diberi };
        if (postgresRuntimeEnabled()) await pgAudit("duitku", "webhook.settlement", "payments", orderId, meta);
        else audit("duitku", "webhook.settlement", "payments", orderId, meta);

        // Kabari HANYA kalau memang ada yang baru diberikan — callback ulangan
        // menghasilkan diberi = 0, dan tiga kabar untuk satu pembayaran membuat
        // orang berhenti mempercayai kabar berikutnya.
        if (diberi > 0) {
          const email = await emailPemilik(payment.user_id);
          if (email) await emailPembayaranLunas({ ke: email, orderId, namaPaket: namaPesanan, jumlahIdr: payment.amount_idr });
        }
        return Response.json({ ok: true, credited: diberi > 0, jenis_pesanan: jenisPesanan });
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

      // Kabari pembelinya — dan HANYA sekali. `duplicated` menandai callback
      // ulangan dari Duitku; mengirim email di setiap ulangan berarti orang
      // menerima tiga kabar untuk satu pembayaran, dan berhenti mempercayai
      // kabar berikutnya. Kegagalan email tidak pernah membatalkan kredit yang
      // sudah masuk (lihat lib/email-pembayaran.ts).
      if (!result.duplicated) {
        const email = await emailPemilik(payment.user_id);
        const pkg = TOPUP_PACKAGES.find((p) => p.id === packageId);
        if (email) {
          await emailPembayaranLunas({
            ke: email,
            orderId,
            namaPaket: pkg?.name ?? packageId,
            jumlahIdr: payment.amount_idr,
          });
        }
      }
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
