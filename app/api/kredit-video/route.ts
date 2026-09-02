import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { hargaKredit, daftarPaket, sisaKredit, langgananAktif } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO, totalVideoPaket } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const [harga, paket, sisa, langganan] = await Promise.all([
      hargaKredit(),
      daftarPaket(true),
      sisaKredit(user.id),
      langgananAktif(user.id),
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
        paket_nama: l.paketNama,
        berakhir_pada: l.berakhirPada,
        sisa: l.sisa,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
