import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
// `now` dan `uuid` murni penghasil nilai — aman di kedua runtime.
// `audit` TIDAK: ia menulis ke SQLite, yang dimatikan di production.
import { getDb, now, uuid } from "@/lib/db";
import { catatAudit } from "@/lib/audit-runtime";
import { config, paymentsEnv } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import {
  createDuitkuInvoice, createDuitkuTransaction, kanalSah, KANAL_DUITKU,
  DuitkuCallbackNotConfigured, DuitkuNotConfigured,
  type RincianTagihan,
} from "@/lib/duitku";
// newOrderId tinggal di lib/midtrans.ts sejak gateway lama; bentuk order id-nya
// dipakai KEDUA gateway dan webhook mencocokkannya, jadi ia sengaja tidak
// disalin ke sini.
import { newOrderId } from "@/lib/midtrans";
import { ambilPaket, catatPesananTopup, hargaKredit } from "@/lib/kredit-video-runtime";
import { PesananTidakSah, rapikanItem, totalTagihan, type ItemTopup } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";
import { emailOrderDibuat } from "@/lib/email-pembayaran";
import { pastikanSegar } from "@/lib/kredensial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Simpan pesanan yang MASIH MENUNGGU sebelum menyentuh gateway.
 *
 * Urutannya disengaja dan bukan selera: baris pesanan harus sudah ada sebelum
 * ada permintaan keluar. Kalau gateway dipanggil lebih dulu lalu proses mati,
 * ada invoice hidup di sisi mereka yang tidak dikenal sistem ini — dan
 * callback-nya nanti tidak menemukan apa pun untuk dikreditkan.
 */
async function simpanPesanan(input: {
  userId: string;
  orderId: string;
  amountIdr: number;
  jenisPesanan: "topup_video" | "langganan";
  paketId: string | null;
  items: ItemTopup[];
  harga: Record<string, number | undefined>;
}): Promise<void> {
  const payload = JSON.stringify({
    jenis_pesanan: input.jenisPesanan,
    paket_id: input.paketId,
    items: input.items,
    payments_env: paymentsEnv(),
  });
  if (postgresRuntimeEnabled()) {
    await getPool(config.databaseUrl).query(
      `INSERT INTO payments (id,user_id,gateway,gateway_ref,amount_idr,credits,status,raw_payload,created_at,jenis_pesanan,paket_id)
       VALUES ($1,$2,'duitku',$3,$4,0,'pending',$5,$6,$7,$8) ON CONFLICT (gateway_ref) DO NOTHING`,
      [uuid(), input.userId, input.orderId, input.amountIdr, payload, now(), input.jenisPesanan, input.paketId],
    );
  } else {
    getDb().prepare(
      `INSERT OR IGNORE INTO payments (id,user_id,gateway,gateway_ref,amount_idr,credits,status,raw_payload,created_at,jenis_pesanan,paket_id)
       VALUES (?,?,'duitku',?,?,0,'pending',?,?,?,?)`,
    ).run(uuid(), input.userId, input.orderId, input.amountIdr, payload, now(), input.jenisPesanan, input.paketId);
  }
  // Isi pesanan disimpan dengan harga SAAT INI. Kalau admin menaikkan harga
  // sementara invoice ini belum dibayar, yang berlaku tetap harga saat pembeli
  // menekan tombol.
  if (input.items.length) await catatPesananTopup(input.orderId, input.items, input.harga);
  await catatAudit(input.userId, "payment.checkout", "payments", input.orderId, {
    jenis_pesanan: input.jenisPesanan, amount_idr: input.amountIdr, paket_id: input.paketId,
  });
}

async function tandaiGagalMulai(orderId: string, kegagalan: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify({ provider_initiation: kegagalan });
  if (postgresRuntimeEnabled()) {
    await getPool(config.databaseUrl).query(
      "UPDATE payments SET status='failed', raw_payload=$2 WHERE gateway_ref=$1 AND status!='paid'", [orderId, payload],
    ).catch(() => undefined);
    return;
  }
  try {
    getDb().prepare("UPDATE payments SET status='failed', raw_payload=? WHERE gateway_ref=? AND status!='paid'").run(payload, orderId);
  } catch { /* pesanan gagal ditandai bukan alasan menelan galat aslinya */ }
}

/**
 * POST /api/kredit-video/checkout
 *
 *   { mode: "topup",     items: [{ jenis, qty }], payment_method }
 *   { mode: "langganan", paket_id,                payment_method }
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NILAI TAGIHAN DIHITUNG DI SERVER, SELALU
 * ────────────────────────────────────────────────────────────────────────────
 * Klien hanya mengirim JUMLAH dan JENIS. Harga satuannya dibaca dari database,
 * totalnya dijumlahkan di sini, dan angka itu pula yang ditandatangani ke
 * Duitku. Menerima total dari klien berarti menerima harga dari pembeli.
 */
export async function POST(req: Request) {
  try {
    await pastikanSegar();
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode ?? "topup");
    const method = body.payment_method ? String(body.payment_method) : undefined;
    // Kanal DIVALIDASI di server: daftar dari klien bisa memuat kanal berbiaya
    // yang sengaja tidak kita tawarkan.
    if (method && !kanalSah(method)) {
      throw ERR.BAD_REQUEST(
        `Metode pembayarannya nggak tersedia. Pilih: ${KANAL_DUITKU.map((k) => k.nama).join(", ")}.`,
        `Unsupported payment method: ${method}`,
      );
    }

    let rincian: RincianTagihan;
    let items: ItemTopup[] = [];
    let paketId: string | null = null;
    let harga: Record<string, number | undefined> = {};
    let namaPesanan: string;

    if (mode === "langganan") {
      paketId = String(body.paket_id ?? "");
      const paket = await ambilPaket(paketId);
      if (!paket || !paket.aktif) throw ERR.BAD_REQUEST("Paketnya nggak ketemu atau sudah tidak dijual.", "Unknown package.");
      namaPesanan = `Paket ${paket.nama}`;
      rincian = {
        amountIdr: paket.hargaIdr,
        label: `${paket.nama} BikinFYP AI`,
        items: [{ name: `${paket.nama} BikinFYP AI`, price: paket.hargaIdr, quantity: 1 }],
      };
    } else if (mode === "topup") {
      harga = await hargaKredit();
      items = rapikanItem(body.items);
      const total = totalTagihan(items, harga);
      namaPesanan = items.map((i) => `${i.qty}× ${KUALITAS[i.jenis].label}`).join(", ");
      rincian = {
        amountIdr: total,
        label: `Kredit video BikinFYP AI`,
        items: items.map((i) => ({
          name: `Video ${KUALITAS[i.jenis].label}`,
          price: harga[i.jenis] as number,
          quantity: i.qty,
        })),
      };
    } else {
      throw ERR.BAD_REQUEST("Jenis pesanan tidak dikenal.", `Unknown mode: ${mode}`);
    }

    const orderId = newOrderId(user.id);
    await simpanPesanan({
      userId: user.id, orderId, amountIdr: rincian.amountIdr,
      jenisPesanan: mode === "langganan" ? "langganan" : "topup_video",
      paketId, items, harga,
    });

    let hasil: { providerRef: string; redirectUrl: string; vaNumber?: string; qrString?: string };
    try {
      hasil = method
        ? await createDuitkuTransaction({ orderId, packageId: "", method, phone: user.phone ?? "", email: user.email ?? "", customerName: user.name ?? undefined, rincian })
        : await createDuitkuInvoice({ orderId, packageId: "", phone: user.phone ?? "", email: user.email ?? "", rincian });
    } catch (err) {
      await tandaiGagalMulai(orderId, {
        failed_at: new Date().toISOString(),
        // Galat provider disimpan untuk rekonsiliasi, TIDAK PERNAH kredensial.
        error: err instanceof Error ? err.message.slice(0, 500) : "unknown provider initiation error",
      });
      if (err instanceof DuitkuNotConfigured || err instanceof DuitkuCallbackNotConfigured) {
        return Response.json(
          { code: "PAYMENT_NOT_CONFIGURED", message_id: "Pembayaran online belum aktif. Hubungi tim kami ya.", message_en: err.message },
          { status: 503 },
        );
      }
      throw err;
    }

    // Nomor VA dibutuhkan NANTI, di perangkat lain, setelah tab ini ditutup —
    // jadi ia dikirim lewat email, bukan cuma ditampilkan. Sengaja tidak
    // di-await: pesanannya sudah terbentuk, dan menahan jawaban demi email
    // membuat checkout yang berhasil terasa gagal.
    if (user.email) {
      void emailOrderDibuat({
        ke: user.email,
        orderId,
        namaPaket: namaPesanan,
        jumlahIdr: rincian.amountIdr,
        namaKanal: KANAL_DUITKU.find((k) => k.kode === method)?.nama ?? "pembayaran",
        vaNumber: hasil.vaNumber,
        redirectUrl: hasil.redirectUrl,
        kedaluwarsaMenit: 60,
      });
    }

    return Response.json(
      {
        order_id: orderId,
        amount_idr: rincian.amountIdr,
        provider_ref: hasil.providerRef,
        redirect_url: hasil.redirectUrl,
        ...(hasil.vaNumber ? { va_number: hasil.vaNumber } : {}),
        ...(hasil.qrString ? { qr_string: hasil.qrString } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof PesananTidakSah) {
      return errorResponse(ERR.BAD_REQUEST(err.message, err.message));
    }
    return errorResponse(err);
  }
}
