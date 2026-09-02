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
  jenisPesanan: "topup_video" | "langganan" | "campuran";
  paketId: string | null;
  items: ItemTopup[];
  harga: Record<string, number | undefined>;
}): Promise<void> {
  const payload = JSON.stringify({
    jenis_pesanan: input.jenisPesanan,
    paket_id: input.paketId,
    items: input.items,
    sidik: sidikPesanan(input.paketId, input.items),
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

/** Sidik isi pesanan — dipakai mengenali pesanan tertunda yang SAMA PERSIS. */
function sidikPesanan(paketId: string | null, items: ItemTopup[]): string {
  const bagian = [paketId ?? "-", ...items.map((i) => `${i.jenis}x${i.qty}`)];
  return bagian.join("|");
}

/**
 * Pesanan yang MASIH MENUNGGU dibayar, isinya sama persis, dan invoicenya
 * belum kedaluwarsa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA DICARI SEBELUM MEMBUAT YANG BARU
 * ────────────────────────────────────────────────────────────────────────────
 * Cara paling umum orang membayar dua kali bukan karena serakah, melainkan
 * karena ragu: menekan Bayar, tidak sempat menyelesaikannya, lalu kembali dan
 * menekan lagi. Tanpa penjagaan ini ia mendapat DUA nomor VA yang dua-duanya
 * hidup — dan kalau ia membayar keduanya, ia benar-benar membayar dua kali.
 *
 * Batasnya mengikuti masa berlaku invoice Duitku (60 menit). Lewat itu nomor
 * VA-nya memang sudah mati, jadi pesanan baru justru yang benar.
 */
async function pesananTertundaSama(
  userId: string, sidik: string,
): Promise<{ orderId: string; provider: Record<string, unknown> } | null> {
  const batas = new Date(Date.now() - 60 * 60_000).toISOString();
  type Baris = { gateway_ref: string; raw_payload: string | null };
  let baris: Baris[] = [];
  if (postgresRuntimeEnabled()) {
    const r = await getPool(config.databaseUrl).query<Baris>(
      `SELECT gateway_ref, raw_payload FROM payments
        WHERE user_id = $1 AND status = 'pending' AND created_at > $2
        ORDER BY created_at DESC LIMIT 10`,
      [userId, batas],
    );
    baris = r.rows;
  } else {
    baris = getDb()
      .prepare(
        `SELECT gateway_ref, raw_payload FROM payments
          WHERE user_id = ? AND status = 'pending' AND created_at > ?
          ORDER BY created_at DESC LIMIT 10`,
      )
      .all(userId, batas) as Baris[];
  }
  for (const b of baris) {
    try {
      const jejak = JSON.parse(b.raw_payload ?? "{}") as {
        sidik?: string;
        provider?: Record<string, unknown>;
      };
      // Hanya dipakai ulang kalau jejak providernya ADA — pesanan yang gagal
      // di tengah jalan tidak punya nomor VA untuk dilanjutkan, dan
      // mengembalikannya berarti menyerahkan pesanan yang tidak bisa dibayar.
      if (jejak.sidik === sidik && jejak.provider && jejak.provider.redirect_url) {
        return { orderId: b.gateway_ref, provider: jejak.provider };
      }
    } catch { /* jejak rusak — perlakukan sebagai tidak ada */ }
  }
  return null;
}

/** Simpan jawaban gateway supaya pesanan yang sama bisa dilanjutkan, bukan diulang. */
async function simpanJejakProvider(orderId: string, provider: Record<string, unknown>): Promise<void> {
  const gabung = (lama: string | null) => {
    let isi: Record<string, unknown> = {};
    try { isi = JSON.parse(lama ?? "{}") as Record<string, unknown>; } catch { /* mulai dari kosong */ }
    return JSON.stringify({ ...isi, provider });
  };
  if (postgresRuntimeEnabled()) {
    const pool = getPool(config.databaseUrl);
    const { rows } = await pool.query<{ raw_payload: string | null }>(
      "SELECT raw_payload FROM payments WHERE gateway_ref = $1", [orderId],
    );
    await pool.query("UPDATE payments SET raw_payload = $2 WHERE gateway_ref = $1 AND status = 'pending'",
      [orderId, gabung(rows[0]?.raw_payload ?? null)]).catch(() => undefined);
    return;
  }
  try {
    const db = getDb();
    const lama = db.prepare("SELECT raw_payload FROM payments WHERE gateway_ref = ?").get(orderId) as
      | { raw_payload: string | null }
      | undefined;
    db.prepare("UPDATE payments SET raw_payload = ? WHERE gateway_ref = ? AND status = 'pending'")
      .run(gabung(lama?.raw_payload ?? null), orderId);
  } catch { /* jejak gagal disimpan bukan alasan menggagalkan checkout */ }
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

    // ── APA YANG DIBELI ────────────────────────────────────────────────
    //
    // Paket bulanan dan kredit satuan boleh berada di SATU pesanan. Callback
    // tidak perlu menebak apa pun: paket tercatat di payments.paket_id,
    // satuan di pesanan_item, dan ia memberikan keduanya kalau keduanya ada.
    //
    // `mode` masih diterima demi klien lama, tapi yang menentukan sekarang
    // adalah ISI permintaan — bukan label yang menyertainya.
    const mintaPaket = typeof body.paket_id === "string" && body.paket_id.trim() !== "";
    const mintaSatuan = Array.isArray(body.items) && body.items.length > 0;
    if (!mintaPaket && !mintaSatuan) {
      throw ERR.BAD_REQUEST("Pilih dulu paket atau jumlah videonya.", "Empty order.");
    }
    if (mode !== "topup" && mode !== "langganan" && mode !== "campuran") {
      throw ERR.BAD_REQUEST("Jenis pesanan tidak dikenal.", `Unknown mode: ${mode}`);
    }

    let total = 0;
    let paketId: string | null = null;
    let items: ItemTopup[] = [];
    let harga: Record<string, number | undefined> = {};
    const bagianNama: string[] = [];
    const bagianItem: { name: string; price: number; quantity: number }[] = [];

    if (mintaPaket) {
      paketId = String(body.paket_id);
      const paket = await ambilPaket(paketId);
      if (!paket || !paket.aktif) throw ERR.BAD_REQUEST("Paketnya nggak ketemu atau sudah tidak dijual.", "Unknown package.");
      total += paket.hargaIdr;
      bagianNama.push(`Paket ${paket.nama}`);
      // `price` berisi TOTAL BARIS dan quantity selalu 1 — Duitku menjumlahkan
      // price saja dan menolak (409) kalau hasilnya tidak sama dengan
      // paymentAmount. Diverifikasi ke sandbox mereka 3 Sep 2026.
      bagianItem.push({ name: `Paket ${paket.nama} BikinFYP AI`, price: paket.hargaIdr, quantity: 1 });
    }

    if (mintaSatuan) {
      harga = await hargaKredit();
      items = rapikanItem(body.items);
      const totalSatuan = totalTagihan(items, harga);
      total += totalSatuan;
      bagianNama.push(items.map((i) => `${i.qty}× ${KUALITAS[i.jenis].label}`).join(", "));
      for (const i of items) {
        bagianItem.push({
          name: `${i.qty}× Video ${KUALITAS[i.jenis].label}`,
          price: (harga[i.jenis] as number) * i.qty,
          quantity: 1,
        });
      }
    }

    const jenisPesanan = mintaPaket && mintaSatuan ? "campuran" : mintaPaket ? "langganan" : "topup_video";
    const namaPesanan = bagianNama.join(" + ");
    const rincian: RincianTagihan = {
      amountIdr: total,
      label: mintaPaket && mintaSatuan ? "Paket + kredit video BikinFYP AI" : `${namaPesanan} BikinFYP AI`,
      items: bagianItem,
    };

    // PESANAN YANG SAMA DAN MASIH MENUNGGU DILANJUTKAN, BUKAN DIULANG.
    //
    // Kalau tidak, orang yang ragu — menekan Bayar, tidak menyelesaikannya,
    // lalu kembali dan menekan lagi — mendapat dua nomor VA yang dua-duanya
    // hidup. Kalau ia membayar keduanya, ia benar-benar membayar dua kali,
    // dan kita harus mengembalikannya secara manual.
    const sidik = sidikPesanan(paketId, items);
    const tertunda = await pesananTertundaSama(user.id, sidik);
    if (tertunda) {
      const p = tertunda.provider as { reference?: string; redirect_url?: string; va_number?: string; qr_string?: string };
      return Response.json(
        {
          order_id: tertunda.orderId,
          amount_idr: rincian.amountIdr,
          provider_ref: p.reference ?? "",
          redirect_url: p.redirect_url ?? "",
          ...(p.va_number ? { va_number: p.va_number } : {}),
          ...(p.qr_string ? { qr_string: p.qr_string } : {}),
          // Klien MEMBERI TAHU pembeli bahwa ini pesanan yang sama, bukan yang
          // baru — supaya ia tidak mengira pembayaran pertamanya hilang.
          dilanjutkan: true,
        },
        { status: 200 },
      );
    }

    const orderId = newOrderId(user.id);
    await simpanPesanan({
      userId: user.id, orderId, amountIdr: rincian.amountIdr,
      jenisPesanan, paketId, items, harga,
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

    // Jejak jawaban gateway disimpan supaya pesanan yang sama bisa
    // DILANJUTKAN kalau pembeli kembali sebelum invoicenya kedaluwarsa.
    await simpanJejakProvider(orderId, {
      reference: hasil.providerRef,
      redirect_url: hasil.redirectUrl,
      ...(hasil.vaNumber ? { va_number: hasil.vaNumber } : {}),
      ...(hasil.qrString ? { qr_string: hasil.qrString } : {}),
    });

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
