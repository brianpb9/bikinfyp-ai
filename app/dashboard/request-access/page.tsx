import { cookies } from "next/headers";
import { Building2 } from "lucide-react";
import { verifyToken, cookieName } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { postgresRuntimeEnabled, smokeGetUser } from "@/lib/postgres/smoke-runtime";
import { config } from "@/lib/config";
import { FormAkses } from "./FormAkses";

export const dynamic = "force-dynamic";

// Sengaja di LUAR app/dashboard/(app)/ — kalau ini ikut lewat gerbang org
// (app)/layout.tsx, redirect-nya bakal muter tak berujung (belum ada org ->
// diarahkan ke sini -> ini juga dijaga gerbang yang sama -> diarahkan ke
// sini lagi). Halaman ini TIDAK org-gated, cuma nyoba tunjukin email user
// (kalau lagi login) biar copy-nya kerasa personal — tapi tetap tampil
// walau belum login sama sekali.
async function currentEmail(): Promise<string | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(cookieName())?.value;
    if (!raw) return null;
    const parsed = await verifyToken(raw);
    if (!parsed) return null;
    const user = postgresRuntimeEnabled()
      ? await smokeGetUser(parsed.userId)
      : (getDb().prepare("SELECT * FROM users WHERE id = ?").get(parsed.userId) as { email: string | null } | undefined);
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export default async function RequestAccessPage() {
  const email = await currentEmail();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-6 text-center text-zinc-100">
      <div className="w-full max-w-sm space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-amber-400">
          <Building2 size={22} />
        </div>
        <p className="text-lg font-bold tracking-tight">
          AIUGC.ID <span className="text-amber-400">Brands</span>
        </p>
        <h1 className="font-display text-xl font-bold">Akun kamu belum terhubung ke organisasi</h1>
        <p className="text-sm text-zinc-400">
          Dashboard ini khusus brand/agency. Sejak 6 Sep 2026 brand bisa mendaftar sendiri —
          tidak perlu lagi menunggu kami mendaftarkan.
          {email ? (
            <> Akunmu (<span className="text-zinc-200">{email}</span>) belum jadi anggota organisasi manapun.</>
          ) : (
            " Login dulu supaya permintaanmu bisa kami hubungkan ke akunmu."
          )}
        </p>
        {/* Form, bukan kalimat buntu — lihat FormAkses. */}
        {/* PENDAFTARAN MANDIRI DIDAHULUKAN atas form "minta akses".
            Form itu mengirim email ke kami dan menunggu kami membuat
            organisasinya dengan tangan — jalur yang lebih lambat untuk kedua
            pihak, dan satu-satunya jalur yang ada sebelum 6 Sep 2026. Ia
            dipertahankan di bawah untuk yang memang ingin bicara dulu. */}
        {email && (
          <a href="/dashboard/daftar"
            className="mx-auto flex min-h-[44px] w-full items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-sm font-extrabold text-zinc-950">
            Daftarkan brand kamu
          </a>
        )}
        {email ? (
          <FormAkses email={email} whatsapp={config.supportWhatsapp || null} />
        ) : (
          <a href="/onboarding"
            className="mx-auto flex w-full items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-sm font-extrabold text-zinc-950">
            Login dulu
          </a>
        )}
      </div>
    </main>
  );
}
