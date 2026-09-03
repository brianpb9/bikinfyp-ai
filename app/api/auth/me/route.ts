import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getBalance } from "@/lib/credits";
import { sisaKredit } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO } from "@/lib/kredit-video";
import { apakahAdmin } from "@/lib/admin-auth";
import { pgGetBalance, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const sisa = await sisaKredit(user.id);
    return Response.json({
      // email ikut supaya menu akun bisa menampilkan identitas yang dipakai
      // login — data milik pengguna itu sendiri, bukan orang lain.
      user: { id: user.id, phone: user.phone, email: user.email, name: user.name, tier: user.tier },
      // SISA JATAH VIDEO — ini yang berarti bagi pengguna sejak render dibayar
      // per jenis video. Dikirim per jenis DAN sebagai total, supaya layar
      // tidak perlu menjumlahkannya sendiri dan tidak mungkin salah hitung.
      sisa_video: sisa,
      total_video: JENIS_VIDEO.reduce((n, j) => n + sisa[j].total, 0),
      // Saldo RUPIAH warisan. Dipertahankan supaya jalur lama (promo, wallet
      // organisasi) tidak putus, TAPI ia tidak lagi membeli video — layar mana
      // pun yang memajangnya sebagai "kredit" akan menampilkan angka mati.
      credits: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
      // STATUS ADMIN, bukan daftar adminnya. Menu perlu tahu apakah ORANG INI
      // boleh membuka /admin; ia tidak perlu tahu siapa saja yang lain.
      //
      // Ini hanya menentukan apakah TAUTAN ditampilkan. Gerbang sebenarnya
      // tetap wajibAdmin() di server saat halamannya dibuka — menyembunyikan
      // tautan bukan pengamanan, dan tidak pernah diperlakukan begitu.
      is_admin: apakahAdmin(user.email),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
