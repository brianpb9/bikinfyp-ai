import { Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgLedger } from "@/lib/postgres/org";
import { tokens } from "../../_components/format";
import { CreditPlans } from "../../_components/CreditPlans";

export const dynamic = "force-dynamic";

type LedgerRow = { id: string; type: string; delta: number; created_at: string; job_id?: string | null };

// Label baris buku besar dalam bahasa manusia. `type` adalah istilah internal
// (hold/capture/release/bonus/topup) dan tidak layak ditampilkan mentah ke brand.
const TYPE_LABEL: Record<string, string> = {
  hold: "Token ditahan untuk render",
  capture: "Token terpakai untuk video",
  release: "Dikembalikan (render gagal)",
  bonus: "Token dari tim BikinFYP",
  topup: "Top-up",
};

export default async function CreditsPage() {
  const { membership } = await requireOrgContext();
  const pg = postgresRuntimeEnabled();
  const balance = pg ? await pgGetOrgBalance(membership.org_id) : getOrgBalance(membership.org_id);
  const ledger: LedgerRow[] = pg ? ((await pgGetOrgLedger(membership.org_id, 30)) as LedgerRow[]) : [];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Token &amp; tagihan</h1>
      </div>

      <section className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-sm">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          <Wallet size={13} /> Token organisasi
        </p>
        <p className="mt-2 font-display text-4xl font-bold text-white">{tokens(balance)}</p>
        <p className="mt-2 text-xs text-zinc-400">
          Token dipakai bersama seluruh anggota organisasi. Token ditahan saat render dimulai
          dan dikembalikan otomatis kalau rendernya gagal. 1 token = Rp1.
        </p>
      </section>

      <CreditPlans />

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-zinc-900">Riwayat pemakaian</h2>
        {ledger.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            Belum ada transaksi kredit.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            {ledger.map((row, i) => (
              <li
                key={row.id}
                className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${i > 0 ? "border-t border-zinc-100" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-800">{TYPE_LABEL[row.type] ?? row.type}</span>
                  <span className="block text-xs text-zinc-400">
                    {new Date(row.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className={`shrink-0 font-display font-bold ${row.delta >= 0 ? "text-emerald-600" : "text-zinc-900"}`}>
                  {row.delta >= 0 ? "+" : "−"}{tokens(Math.abs(row.delta))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
