import Link from "next/link";
import { AlertTriangle, CheckCircle2, Eye, Film, Loader2, Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { pgListRecentBulkRuns, type RecentBulkRun } from "@/lib/postgres/org";
import { CampaignThumb } from "../../_components/CampaignThumb";
import { campaignKindLabel, campaignFormatLabel } from "../../_components/campaign-kind";
import { BTN_PRIMARY_SM } from "@/app/dashboard/_components/buttons";

export const dynamic = "force-dynamic";

// Proyek (referensi "Brands Center" Brandfy yang Brian kirim: tab Active /
// Completed projects). Satu proyek = satu kampanye = satu produk dengan 2-6
// variasi video.
//
// Aktif ditentukan oleh pending_count/review_count, BUKAN oleh
// ready_count < total. Proyek dengan 2 video siap dan 1 gagal sudah selesai
// dikerjakan — menahannya selamanya di tab "Aktif" membuat daftar itu jadi
// tempat sampah yang tidak pernah kosong.
function isActive(run: RecentBulkRun): boolean {
  return run.pending_count > 0 || run.review_count > 0;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { membership } = await requireOrgContext();
  const { tab } = await searchParams;
  const showCompleted = tab === "selesai";

  const runs: RecentBulkRun[] = postgresRuntimeEnabled()
    ? await pgListRecentBulkRuns(membership.org_id, 100)
    : [];
  const active = runs.filter(isActive);
  const completed = runs.filter((r) => !isActive(r));
  const visible = showCompleted ? completed : active;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Proyek</h1>
          <p className="mt-1 text-sm text-zinc-500">Satu proyek = satu produk dengan beberapa variasi video.</p>
        </div>
        <Link
          href="/dashboard/templates"
          className={BTN_PRIMARY_SM}
        >
          <Plus size={15} /> Proyek baru
        </Link>
      </div>

      {/* Tab berupa tautan, bukan state klien: bisa di-bookmark, bisa dibuka di
          tab baru, dan tidak perlu JavaScript untuk berpindah. */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-white p-1">
        {[
          { id: "aktif", label: "Sedang berjalan", n: active.length },
          { id: "selesai", label: "Selesai", n: completed.length },
        ].map((t) => {
          const on = (t.id === "selesai") === showCompleted;
          return (
            <Link
              key={t.id}
              href={`/dashboard/projects?tab=${t.id}`}
              className={`rounded-lg py-2.5 text-center text-sm font-semibold transition-colors ${
                on ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {t.label} {t.n}
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <Film size={24} className="text-zinc-300" />
          <p className="text-sm text-zinc-500">
            {showCompleted ? "Belum ada proyek yang selesai." : "Tidak ada proyek yang sedang berjalan."}
          </p>
          <Link href="/dashboard/templates" className="text-sm font-semibold text-amber-600 hover:text-amber-700">
            Mulai dari template
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((run) => {
            const pct = run.total > 0 ? Math.round((run.ready_count / run.total) * 100) : 0;
            return (
              <li key={run.bulk_run_id}>
                <Link
                  href={`/dashboard/campaign/${run.bulk_run_id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900">
                    <CampaignThumb thumbKey={run.thumb_key} videoKey={run.video_key} />
                    <span className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
                      {campaignKindLabel(run.format)}
                    </span>
                    {run.review_count > 0 ? (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-zinc-950">
                        <Eye size={10} /> {run.review_count} perlu ditinjau
                      </span>
                    ) : run.pending_count > 0 ? (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold text-zinc-700">
                        <Loader2 size={10} className="animate-spin" /> {run.pending_count} dirender
                      </span>
                    ) : run.failed_count > 0 ? (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold text-red-600">
                        <AlertTriangle size={10} /> {run.failed_count} gagal
                      </span>
                    ) : (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white">
                        <CheckCircle2 size={10} /> Selesai
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="truncate text-sm font-bold text-zinc-900">{run.product_name ?? "Kampanye"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {new Date(run.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      {campaignFormatLabel(run.format) && (
                        <>
                          <span className="mx-1.5 text-zinc-300">·</span>
                          {campaignFormatLabel(run.format)}
                        </>
                      )}
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
    </div>
  );
}
