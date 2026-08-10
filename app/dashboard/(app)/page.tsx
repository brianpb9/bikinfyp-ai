import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance } from "@/lib/postgres/org";
import { rupiah } from "../_components/format";

export const dynamic = "force-dynamic";

// Beranda org (M2, F-ENT-01). "Bulk run terakhir" sengaja kosong — fan-out
// generate baru dibangun di M3; ini cuma nunjukin shell + saldo dulu supaya
// M2 bisa didemokan berdiri sendiri, bukan nunggu M3 kelar.
export default async function DashboardHomePage() {
  const { membership } = await requireOrgContext();
  const balance = postgresRuntimeEnabled()
    ? await pgGetOrgBalance(membership.org_id)
    : getOrgBalance(membership.org_id);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Beranda</h1>
      </div>

      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Saldo Organisasi</p>
          <p className="mt-2 font-display text-3xl font-bold text-zinc-900">{rupiah(balance)}</p>
          <p className="mt-1 text-xs text-zinc-500">Diisi oleh tim BikinFYP — hubungi kami untuk top-up.</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Peran Kamu</p>
          <p className="mt-2 font-display text-3xl font-bold capitalize text-zinc-900">{membership.role}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-zinc-900">Bulk run terakhir</h2>
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">Belum ada bulk run. Fitur Bulk Generate segera hadir.</p>
        </div>
      </section>
    </div>
  );
}
