import { hargaKredit } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/harga-publik — harga yang berlaku, TANPA login.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA PERLU RUTE PUBLIK TERSENDIRI
 * ────────────────────────────────────────────────────────────────────────────
 * Halaman promosi (/onboarding, /coba, /mulai) dibuka orang yang BELUM punya
 * akun — /api/meta menolak mereka. Jadi sampai sekarang halaman-halaman itu
 * menuliskan angkanya sendiri, dan angka yang diketik di layar promosi adalah
 * angka yang paling lama tidak ada yang memperbaiki: "Rp12.000 per video"
 * masih terpampang setelah harganya berubah, dan "bonus Rp12.000" masih
 * terpampang setelah bonusnya berhenti berupa rupiah.
 *
 * Yang dikirim di sini sengaja SEDIKIT: hanya yang memang dipajang ke publik.
 * Tidak ada saldo, tidak ada data akun, tidak ada apa pun yang bergantung
 * siapa yang bertanya.
 */
export async function GET() {
  const harga: Partial<Record<string, number>> = await hargaKredit().catch(() => ({}));
  const daftar = JENIS_VIDEO.filter((j) => harga[j]).map((j) => ({
    id: j,
    label: KUALITAS[j].label,
      // Penjelasan IKUT dikirim supaya layar promosi tidak perlu menuliskannya
      // sendiri. Sampai 6 Sep 2026 halaman /onboarding memajang dua paket yang
      // sudah pensiun ("AI Bersuara Rp12.000", "Bersuara Pro Rp80.000") lengkap
      // dengan deskripsinya — angka DAN kalimatnya sama-sama basi, karena
      // dua-duanya diketik di sana.
      jelas: KUALITAS[j].jelas,
    harga_idr: harga[j] as number,
  }));

  return Response.json(
    {
      jenis: daftar,
      // Termurah dipisah karena itu yang dipakai kalimat promosi "mulai dari".
      // null bila harga belum diatur sama sekali — halaman promosi lebih baik
      // menyembunyikan kalimatnya daripada menampilkan angka karangan.
      mulai_idr: daftar.length ? Math.min(...daftar.map((d) => d.harga_idr)) : null,
      // Paket gratis pendaftar: JUMLAH VIDEO, bukan rupiah.
      gratis: config.signupBonusQty > 0
        ? { qty: config.signupBonusQty, jenis: config.signupBonusJenis }
        : null,
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
