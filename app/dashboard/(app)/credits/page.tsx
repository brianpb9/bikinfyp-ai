import { Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgLedger } from "@/lib/postgres/org";
import { tokens } from "../../_components/format";
import { BeliJatahOrg } from "../../_components/BeliJatahOrg";
import { pgSisaOrg } from "@/lib/kredit-video-runtime";
import { hargaKredit } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";

export const dynamic = "force-dynamic";

type LedgerRow = { id: string; type: string; delta: number; created_at: string; job_id?: string | null };

// Label baris buku besar dalam bahasa manusia. `type` adalah istilah internal
// (hold/capture/release/bonus/topup) dan tidak layak ditampilkan mentah ke brand.
const TYPE_LABEL: Record<string, string> = {
  hold: "Token ditahan untuk render",
  capture: "Token terpakai untuk video",
  release: "Dikembalikan (render gagal)",
  bonus: "Token dari tim AIUGC.ID",
  topup: "Top-up",
};

export default async function CreditsPage() {
  const { membership } = await requireOrgContext();
  const pg = postgresRuntimeEnabled();
  const balance = pg ? await pgGetOrgBalance(membership.org_id) : getOrgBalance(membership.org_id);
  const ledger: LedgerRow[] = pg ? ((await pgGetOrgLedger(membership.org_id, 30)) as LedgerRow[]) : [];

  // JATAH PER JENIS — satuan yang sama dengan dompetnya (migrasi 0041).
  const sisa = pg ? await pgSisaOrg(membership.org_id) : null;
  const harga = await hargaKredit();
  const jenisJual = JENIS_VIDEO.map((j) => ({
    id: j,
    nama: KUALITAS[j].label,
    harga_idr: harga[j] ?? 0,
    bisa_ditopup: Boolean(harga[j]),
  }));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Token &amp; tagihan</h1>
      </div>

      {/* SATUANNYA VIDEO, BUKAN RUPIAH.
          Dompetnya memang berisi jatah per jenis sejak migrasi 0041; menampilkan
          "token" di atasnya berarti brand memegang satu barang dan membaca dua
          satuan untuknya. */}
      <section className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-sm">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          <Wallet size={13} /> Sisa jatah organisasi
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          {JENIS_VIDEO.map((j) => (
            <div key={j}>
              <p className="font-display text-3xl font-bold tabular-nums text-white">
                {sisa?.[j]?.total ?? 0}
              </p>
              <p className="text-[11px] capitalize text-zinc-400">{KUALITAS[j].label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          Jatah dipakai bersama seluruh anggota. Satu video memotong satu jatah, dan
          dikembalikan otomatis kalau rendernya gagal.
        </p>
      </section>

      <BeliJatahOrg jenis={jenisJual} />

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
