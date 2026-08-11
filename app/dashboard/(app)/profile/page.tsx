import Link from "next/link";
import {
  Building2, ChevronRight, CreditCard, Film, Headphones, Shield, Users, Wallet,
} from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance, getOrgById } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgById, pgGetOrgVideoStats, type OrgVideoStats } from "@/lib/postgres/org";
import { rupiah } from "../../_components/format";
import { BusinessAnalysisCard } from "../../_components/BusinessAnalysisCard";
import { LogoutButton } from "../../_components/ProfileActions";

export const dynamic = "force-dynamic";

const EMPTY_STATS: OrgVideoStats = { total: 0, ready: 0, awaiting_review: 0, spent_idr: 0 };

/** Nomor HP disamarkan seperti di aplikasi keuangan: cukup untuk mengenali
 * akun sendiri, tidak cukup untuk dibaca orang yang mengintip layar. */
function maskContact(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    const head = name.slice(0, 2);
    return `${head}${"*".repeat(Math.max(3, name.length - 2))}@${domain}`;
  }
  return value.length <= 5 ? value : `${value.slice(0, 4)}${"*".repeat(value.length - 7)}${value.slice(-3)}`;
}

// Tab Profil (permintaan Brian 2026-08-11, referensi tab "Me" Atome):
// identitas di atas, angka penting sebagai ubin, lalu baris pengaturan
// berkelompok. Setelan TIDAK dibuat sebagai tab terpisah — Brian minta
// setting berada DI DALAM profil.
//
// Profil brand (analisis bisnis) dipindah ke sini dari Beranda: itu data yang
// diisi sekali lalu jarang disentuh, jadi tempatnya bukan di layar kerja
// harian. Beranda sekarang murni untuk bertindak dan melihat hasil.
export default async function ProfilePage() {
  const { user, membership } = await requireOrgContext();
  const pg = postgresRuntimeEnabled();
  const balance = pg ? await pgGetOrgBalance(membership.org_id) : getOrgBalance(membership.org_id);
  const org = pg ? await pgGetOrgById(membership.org_id) : getOrgById(membership.org_id);
  const stats = pg ? await pgGetOrgVideoStats(membership.org_id) : EMPTY_STATS;

  const rows: { icon: typeof Wallet; label: string; hint: string; href?: string; badge?: string }[] = [
    { icon: CreditCard, label: "Kredit & tagihan", hint: "Beli kredit, lihat riwayat pemakaian", href: "/dashboard/credits" },
    { icon: Film, label: "Library video", hint: `${stats.total} video dari semua kampanye`, href: "/dashboard/library" },
    { icon: Users, label: "Anggota tim", hint: "Undang rekan ke organisasi ini", badge: "Segera" },
  ];

  return (
    <div className="space-y-8">
      {/* Identitas */}
      <section className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 font-display text-2xl font-bold text-white">
          {membership.org_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-zinc-900">{membership.org_name}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {maskContact(user.phone ?? user.email)}
            <span className="mx-2 text-zinc-300">·</span>
            <span className="capitalize">{membership.role}</span>
          </p>
        </div>
      </section>

      {/* Ubin angka */}
      <section className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Wallet size={12} /> Saldo
          </p>
          <p className="mt-2 truncate font-display text-2xl font-bold text-zinc-900">{rupiah(balance)}</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Film size={12} /> Video siap
          </p>
          <p className="mt-2 font-display text-2xl font-bold text-zinc-900">{stats.ready}</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Building2 size={12} /> Terpakai
          </p>
          <p className="mt-2 truncate font-display text-2xl font-bold text-zinc-900">{rupiah(stats.spent_idr)}</p>
        </div>
      </section>

      {/* Kelola */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-zinc-900">Kelola</h2>
        <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {rows.map((row, i) => {
            const Icon = row.icon;
            const inner = (
              <>
                <Icon size={18} className="shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-zinc-900">{row.label}</span>
                  <span className="block text-xs text-zinc-500">{row.hint}</span>
                </span>
                {row.badge ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">{row.badge}</span>
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-zinc-300" />
                )}
              </>
            );
            const cls = `flex w-full items-center gap-3 px-4 py-4 text-left ${i > 0 ? "border-t border-zinc-100" : ""}`;
            return (
              <li key={row.label}>
                {row.href ? (
                  <Link href={row.href} className={`${cls} transition-colors hover:bg-zinc-50`}>{inner}</Link>
                ) : (
                  <div className={`${cls} cursor-not-allowed opacity-60`}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Setelan — di DALAM profil, bukan tab sendiri */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-zinc-900">Setelan brand</h2>
        <p className="-mt-1 text-xs text-zinc-500">
          Dipakai AI sebagai konteks saat menulis skrip. Makin lengkap, makin nyambung hasilnya.
        </p>
        <BusinessAnalysisCard initial={{
          website_url: org?.website_url ?? null, business_type: org?.business_type ?? null,
          category: org?.category ?? null, audience: org?.audience ?? null, elevator_pitch: org?.elevator_pitch ?? null,
        }} />
      </section>

      {/* Bantuan & akun */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-zinc-900">Bantuan & akun</h2>
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="flex items-start gap-2 text-sm text-zinc-600">
            <Headphones size={16} className="mt-0.5 shrink-0 text-zinc-400" />
            Ada kendala atau mau top-up? Hubungi tim BikinFYP lewat kontak yang kamu pakai saat pendaftaran.
          </p>
          <p className="flex items-start gap-2 text-sm text-zinc-600">
            <Shield size={16} className="mt-0.5 shrink-0 text-zinc-400" />
            Semua video ditandai sebagai konten AI sesuai ketentuan platform.
          </p>
          <div className="pt-1">
            <LogoutButton />
          </div>
        </div>
      </section>
    </div>
  );
}
