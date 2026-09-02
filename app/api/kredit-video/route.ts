import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { hargaKredit, daftarPaket, sisaKredit, langgananAktif } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO, totalVideoPaket } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";
import { config } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pesanan yang masih menunggu dibayar dan invoicenya belum kedaluwarsa.
 *
 * Batasnya mengikuti masa berlaku invoice Duitku (60 menit): lewat itu nomor
 * VA-nya memang sudah mati, dan menampilkannya hanya akan menyuruh orang
 * membayar ke nomor yang tidak lagi menerima.
 */
async function pesananTertunda(userId: string) {
  const batas = new Date(Date.now() - 60 * 60_000).toISOString();
  type Baris = { gateway_ref: string; amount_idr: number; created_at: string; raw_payload: string | null };
  const baris: Baris[] = postgresRuntimeEnabled()
    ? (
        await getPool(config.databaseUrl).query<Baris>(
          `SELECT gateway_ref, amount_idr, created_at, raw_payload FROM payments
            WHERE user_id = $1 AND status = 'pending' AND created_at > $2
            ORDER BY created_at DESC LIMIT 5`,
          [userId, batas],
        )
      ).rows
    : (getDb()
        .prepare(
          `SELECT gateway_ref, amount_idr, created_at, raw_payload FROM payments
            WHERE user_id = ? AND status = 'pending' AND created_at > ?
            ORDER BY created_at DESC LIMIT 5`,
        )
        .all(userId, batas) as Baris[]);

  return baris.map((b) => {
    let jejak: { paket_id?: string | null; items?: { jenis: string; qty: number }[]; provider?: { va_number?: string; redirect_url?: string } } = {};
    try { jejak = JSON.parse(b.raw_payload ?? "{}"); } catch { /* jejak rusak — kirim yang bisa dibaca saja */ }
    return {
      order_id: b.gateway_ref,
      amount_idr: b.amount_idr,
      dibuat_pada: b.created_at,
      paket_id: jejak.paket_id ?? null,
      items: jejak.items ?? [],
      va_number: jejak.provider?.va_number ?? null,
      redirect_url: jejak.provider?.redirect_url ?? null,
    };
  });
}

/**
 * GET /api/kredit-video — semua yang dibutuhkan layar saldo dan layar beli.
 *
 * Satu panggilan, bukan tiga: saldo, harga, dan paket selalu dipakai bersama,
 * dan tiga panggilan terpisah membuat layar sempat menampilkan harga baru di
 * sebelah saldo lama.
 *
 * Harga TIDAK PERNAH datang dari klien. Yang di sini cuma untuk ditampilkan;
 * checkout menghitung ulang dari sumber yang sama di server.
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    const [harga, paket, sisa, langganan, tertunda] = await Promise.all([
      hargaKredit(),
      daftarPaket(true),
      sisaKredit(user.id),
      langgananAktif(user.id),
      pesananTertunda(user.id),
    ]);

    return Response.json({
      sisa,
      jenis: JENIS_VIDEO.map((j) => ({
        id: j,
        label: KUALITAS[j].label,
        jelas: KUALITAS[j].jelas,
        resolusi: KUALITAS[j].resolusi,
        harga_idr: harga[j] ?? null,
        // Jenis yang harganya belum diatur admin TIDAK bisa dibeli satuan.
        // Dinyatakan apa adanya, bukan disembunyikan: menyembunyikannya membuat
        // pemilik akun bertanya-tanya kenapa jatah yang ia punya tidak ada di
        // daftar beli.
        bisa_ditopup: Boolean(harga[j]) && (j !== "standard" || Boolean(config.kieApiKey)),
      })),
      paket: paket.map((p) => ({
        id: p.id,
        nama: p.nama,
        keterangan: p.keterangan,
        harga_idr: p.hargaIdr,
        masa_hari: p.masaHari,
        kuota: { standard: p.kuotaStandard, premium: p.kuotaPremium, ultra: p.kuotaUltra },
        total_video: totalVideoPaket(p),
      })),
      langganan: langganan.map((l) => ({
        id: l.id,
        // paket_id dikirim supaya layar bisa menandai paket mana yang SEDANG
        // dipakai — tanpa itu, halaman menawarkan paket yang sudah dimiliki
        // seolah pembeli belum punya apa-apa.
        paket_id: l.paketId,
        paket_nama: l.paketNama,
        berakhir_pada: l.berakhirPada,
        sisa: l.sisa,
      })),
      // Pesanan yang BELUM dibayar dan invoicenya masih hidup. Dikirim supaya
      // layar bisa mengatakannya lebih dulu — orang yang tidak tahu masih
      // punya pesanan tertunda akan membuat pesanan kedua, dan kalau ia
      // membayar keduanya, ia benar-benar membayar dua kali.
      pesanan_tertunda: tertunda,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
