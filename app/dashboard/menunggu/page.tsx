import Link from "next/link";
import { getAuthUserFromCookies } from "@/lib/dashboard-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * "Pendaftaranmu sedang ditinjau."
 *
 * HALAMAN TERPISAH DARI /dashboard/suspended, dan itu bukan duplikasi:
 * suspended berarti pernah aktif lalu dihentikan, dan kalimatnya menyuruh
 * menghubungi kami untuk mengaktifkan LAGI. Mengatakan itu kepada brand yang
 * baru mendaftar membuat kesan mereka sudah melakukan kesalahan.
 */
export default async function MenungguPage() {
  const user = await getAuthUserFromCookies();
  if (!user) redirect("/brands");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-10 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">AIUGC.ID Brands</p>
      <h1 className="font-display text-2xl font-bold text-zinc-900">Pendaftaranmu sedang kami tinjau</h1>
      <p className="text-sm leading-6 text-zinc-600">
        Kami kabari lewat <b>{user.email}</b> begitu selesai. Tidak perlu mendaftar ulang — pendaftarannya
        sudah masuk.
      </p>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Setelah disetujui, akun brand mulai dengan saldo token nol dan bisa langsung diisi dari dashboard.
      </p>
      <Link href="/brands" className="mx-auto inline-flex min-h-[44px] items-center text-sm font-semibold text-indigo-700">
        Kembali ke halaman depan
      </Link>
    </main>
  );
}
