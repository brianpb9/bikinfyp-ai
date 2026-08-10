import Link from "next/link";
import { ArrowRight, Plus, Sparkles, UserCircle2, Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance, getOrgById } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgById, pgListRecentBulkRuns, type RecentBulkRun } from "@/lib/postgres/org";
import { rupiah } from "../_components/format";
import { BusinessAnalysisCard } from "../_components/BusinessAnalysisCard";

export const dynamic = "force-dynamic";

// Beranda org (M2-M4, F-ENT-01).
export default async function DashboardHomePage() {
  const { membership } = await requireOrgContext();
  const balance = postgresRuntimeEnabled()
    ? await pgGetOrgBalance(membership.org_id)
    : getOrgBalance(membership.org_id);
  const org = postgresRuntimeEnabled() ? await pgGetOrgById(membership.org_id) : getOrgById(membership.org_id);
  // Bulk-generate cuma jalan di runtime Postgres (lihat guard di
  // app/api/dashboard/bulk/route.ts) — dev SQLite selalu kosong di sini.
  const recentRuns: RecentBulkRun[] = postgresRuntimeEnabled() ? await pgListRecentBulkRuns(membership.org_id) : [];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Beranda</h1>
      </div>

      <BusinessAnalysisCard initial={{
        website_url: org?.website_url ?? null, business_type: org?.business_type ?? null,
        category: org?.category ?? null, audience: org?.audience ?? null, elevator_pitch: org?.elevator_pitch ?? null,
      }} />

      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Wallet size={13} /> Saldo Organisasi
          </p>
          <p className="mt-2 truncate font-display text-3xl font-bold text-zinc-900">{rupiah(balance)}</p>
          <p className="mt-1 text-xs text-zinc-500">Diisi oleh tim BikinFYP — hubungi kami untuk top-up.</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <UserCircle2 size={13} /> Peran Kamu
          </p>
          <p className="mt-2 font-display text-3xl font-bold capitalize text-zinc-900">{membership.role}</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">Kampanye terakhir</h2>
          <Link href="/dashboard/campaign" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700">
            <Plus size={13} /> Kampanye baru
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center">
            <Sparkles size={22} className="text-zinc-300" />
            <p className="text-sm text-zinc-500">Belum ada kampanye.</p>
            <Link href="/dashboard/campaign" className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700">
              Mulai yang pertama <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {recentRuns.map((run) => (
              <li key={run.bulk_run_id}>
                <Link
                  href={`/dashboard/campaign/${run.bulk_run_id}`}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm transition-colors hover:border-amber-400"
                >
                  <span className="text-zinc-700">{new Date(run.created_at).toLocaleString("id-ID")}</span>
                  <span className="font-semibold text-zinc-900">{run.ready_count}/{run.total} siap</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
