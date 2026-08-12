import type { ReactNode } from "react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgById } from "@/lib/postgres/org";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { DashboardChrome } from "../_components/DashboardChrome";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Gerbang dashboard enterprise/brand (F-ENT-01). Node runtime Server
// Component — bukan Edge middleware, karena butuh query org_members lewat
// driver `pg` (lihat lib/dashboard-auth.ts). requireOrgContext() redirect
// sendiri kalau belum login / belum jadi anggota org manapun.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await requireOrgContext();

  // Gerbang onboarding. Halaman onboarding sengaja diletakkan DI LUAR grup
  // (app) — kalau ia ikut memakai layout ini, redirect di bawah akan memantul
  // tanpa henti. Karena itu di sini tidak perlu (dan tidak bisa) memeriksa
  // pathname: apa pun yang sampai ke layout ini memang bukan onboarding.
  //
  // GERBANG INI HARUS GAGAL KE ARAH "LEWATKAN", BUKAN "TAHAN".
  //
  // Versi pertama memakai `!org.onboarded_at`, dan itu menjebak Brian di
  // produksi (2026-08-11): migrasi 0018 belum diterapkan, kolomnya belum ada,
  // `SELECT *` mengembalikan undefined, gerbang menyimpulkan "belum
  // onboarding", lalu melempar ke halaman yang penyimpanannya PASTI gagal —
  // dan tidak ada jalan keluar karena setiap tujuan lain ikut dialihkan.
  //
  // Sekarang dibedakan dengan tepat: `null` berarti kolomnya ADA dan memang
  // belum diisi (redirect benar), `undefined` berarti kolomnya belum ada
  // (migrasi tertinggal — biarkan lewat). Kesalahan apa pun juga dibiarkan
  // lewat: dashboard yang bisa dipakai lebih baik daripada perkenalan yang
  // sempurna, dan gerbang tidak pernah boleh jadi satu-satunya titik yang
  // mematikan seluruh aplikasi.
  if (postgresRuntimeEnabled()) {
    try {
      const org = await pgGetOrgById(membership.org_id);
      if (org && org.onboarded_at === null) redirect("/dashboard/onboarding");
    } catch (err) {
      // redirect() melempar sinyal khusus Next — WAJIB diteruskan, kalau
      // ditelan di sini redirect-nya tidak akan pernah terjadi.
      if (isRedirectError(err)) throw err;
      console.error("[dashboard] gerbang onboarding dilewati:", err);
    }
  }

  const balance = postgresRuntimeEnabled()
    ? await pgGetOrgBalance(membership.org_id)
    : getOrgBalance(membership.org_id);

  // Harga satu video bersuara diambil dari config, BUKAN ditulis ulang di
  // komponen klien: kalau tarifnya berubah dan angkanya disalin, sidebar akan
  // menjanjikan jumlah video yang salah — dan yang menemukannya pengguna,
  // bukan kita.
  const hargaVideoIdr = config.tiers.high_quality.priceIdr;

  return (
    <DashboardChrome orgName={membership.org_name} balanceIdr={balance} userEmail={user.email} hargaVideoIdr={hargaVideoIdr}>
      {children}
    </DashboardChrome>
  );
}
