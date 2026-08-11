import Link from "next/link";
import { ArrowRight, Eye, Film, Plus, Sparkles, Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgVideoStats, pgListRecentBulkRuns, type OrgVideoStats, type RecentBulkRun } from "@/lib/postgres/org";
import { createSignedUrl } from "@/lib/signed-url";
import { tokens } from "../_components/format";

export const dynamic = "force-dynamic";

const EMPTY_STATS: OrgVideoStats = { total: 0, ready: 0, awaiting_review: 0, spent_idr: 0 };

// Beranda org (M2-M4, dirombak 2026-08-11 atas masukan Brian: "bagian home
// visualnya juga harus di perbaiki, kampaye terakhir mungkin tidak seperti
// itu visualnya").
//
// Versi lama menampilkan kampanye sebagai baris teks polos berisi tanggal dan
// "2/3 siap" — tidak ada gambar sama sekali, padahal isi kampanye ADALAH
// gambar. Sekarang tiap kampanye tampil sebagai kartu dengan thumbnail scene
// pertama, nama produk, dan ajakan bertindak kalau ada yang menunggu ditinjau.
//
// Kartu analisis bisnis dipindah ke tab Profil: itu data yang diisi sekali
// lalu jarang disentuh, dan kehadirannya di layar kerja harian membuat hal
// yang penting (bikin video, lihat hasil) terdorong ke bawah lipatan.
export default async function DashboardHomePage() {
  const { membership } = await requireOrgContext();
  const pg = postgresRuntimeEnabled();
  const balance = pg ? await pgGetOrgBalance(membership.org_id) : getOrgBalance(membership.org_id);
  const stats = pg ? await pgGetOrgVideoStats(membership.org_id) : EMPTY_STATS;
  // Bulk-generate hanya jalan di runtime Postgres (lihat guard di route API-nya)
  // — dev SQLite selalu kosong di sini.
  const recentRuns: RecentBulkRun[] = pg ? await pgListRecentBulkRuns(membership.org_id) : [];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Beranda</h1>
      </div>

      {/* Ajakan utama — satu aksi jelas, tidak bersaing dengan apa pun. */}
      <section className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-sm">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-white">Bikin video baru</h2>
          <p className="mt-1 max-w-md text-sm text-zinc-400">
            Satu produk, 2–6 variasi video sekaligus. Pilih AI UGC Affiliate, UGC Ads, atau TVC.
          </p>
        </div>
        <Link
          href="/dashboard/campaign"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400"
        >
          <Plus size={16} /> Mulai kampanye
        </Link>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Link href="/dashboard/credits" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-amber-400">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Wallet size={12} /> Token organisasi
          </p>
          <p className="mt-2 truncate font-display text-3xl font-bold text-zinc-900">{tokens(balance)}</p>
          <p className="mt-1 text-xs font-semibold text-amber-600">Tambah token</p>
        </Link>
        <Link href="/dashboard/library" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-amber-400">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Film size={12} /> Video siap
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-zinc-900">{stats.ready}</p>
          <p className="mt-1 text-xs font-semibold text-amber-600">Buka library</p>
        </Link>
        <Link
          href="/dashboard/library?filter=review"
          className={`rounded-2xl border p-5 shadow-sm transition-colors ${
            stats.awaiting_review > 0 ? "border-amber-400 bg-amber-50" : "border-zinc-200 bg-white hover:border-amber-400"
          }`}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Eye size={12} /> Perlu ditinjau
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-zinc-900">{stats.awaiting_review}</p>
          {stats.awaiting_review > 0 && <p className="mt-1 text-xs font-semibold text-amber-700">Tinjau sekarang</p>}
        </Link>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">Kampanye terakhir</h2>
          <Link href="/dashboard/library" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700">
            Lihat semua <ArrowRight size={13} />
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <Sparkles size={22} className="text-zinc-300" />
            <p className="text-sm text-zinc-500">Belum ada kampanye.</p>
            <Link href="/dashboard/campaign" className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700">
              Mulai yang pertama <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentRuns.map((run) => {
              const pct = run.total > 0 ? Math.round((run.ready_count / run.total) * 100) : 0;
              return (
                <li key={run.bulk_run_id}>
                  <Link
                    href={`/dashboard/campaign/${run.bulk_run_id}`}
                    className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {/* overflow-hidden + absolute inset-0 WAJIB di sini. Dengan
                        <img className="h-full">, tinggi 100% diukur terhadap
                        induk yang tingginya belum tentu — browser menyerah ke
                        auto, gambar dirender seukuran aslinya (potret 9:16),
                        dan kotaknya ikut molor jadi hampir 3x tinggi yang
                        diminta. aspect-ratio kalah oleh konten yang meluap. */}
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900">
                      {run.thumb_key ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={createSignedUrl(run.thumb_key)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-zinc-700">
                          <Film size={26} />
                        </div>
                      )}
                      {run.review_count > 0 && (
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-zinc-950">
                          <Eye size={10} /> {run.review_count} perlu ditinjau
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <p className="truncate text-sm font-bold text-zinc-900">{run.product_name ?? "Kampanye"}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {new Date(run.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                      <div className="mt-auto pt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1.5 text-xs font-semibold text-zinc-600">{run.ready_count}/{run.total} siap</p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
