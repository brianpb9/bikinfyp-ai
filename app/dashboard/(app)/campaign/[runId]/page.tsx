"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, VideoOff } from "lucide-react";
import { apiFetch, ApiFail } from "../../../../_components/api";
import { SkeletonCard } from "../../../_components/Skeleton";

type BulkJob = { job_id: string; state: string; product_name: string; cost_idr: number; video_url: string | null; caption: string | null };
type BulkRunResponse = { campaign_run_id: string; jobs: BulkJob[]; ready_count: number; failed_count: number; total: number };

const TERMINAL = new Set(["READY", "FAILED", "REFUNDED"]);
const POLL_MS = 5000;

const STATE_LABEL: Record<string, string> = {
  QUEUED: "Antre", GENERATING_VISUAL: "Bikin visual", GENERATING_VOICE: "Bikin suara",
  COMPOSITING: "Menyusun video", QC_CHECK: "Cek kualitas", LABELING: "Finalisasi",
  READY: "Siap", FAILED: "Gagal", REFUNDED: "Gagal (kredit dikembalikan)",
};

// Galeri hasil kampanye (M4, F-ENT-01, polish M5, campaign M8) — polling sederhana tiap
// 5 dtk sampai semua job mencapai state terminal. Sesuai desain: satu
// bulk_run_id bisa dilihat semua anggota org (lihat komentar org-scoped
// di route API-nya).
export default function BulkRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [data, setData] = useState<BulkRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await apiFetch<BulkRunResponse>(`/api/dashboard/campaign/${runId}`);
        if (stopped) return;
        setData(res);
        setError(null);
        const allDone = res.jobs.every((j) => TERMINAL.has(j.state));
        if (!allDone) timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (stopped) return;
        setError(err instanceof ApiFail ? err.message : "Gagal memuat status.");
        timer = setTimeout(poll, POLL_MS);
      }
    }
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [runId]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/campaign" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700">
          <ArrowLeft size={14} /> Kampanye baru
        </Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Hasil Kampanye</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">
          {data ? `${data.ready_count} siap / ${data.total} total` : <span className="inline-block h-7 w-48 animate-pulse rounded-lg bg-zinc-200 align-middle" />}
        </h1>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!data ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4">
          {data.jobs.map((job) => (
            <li key={job.job_id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
              <p className="truncate text-sm font-semibold text-zinc-900">{job.product_name}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                {job.state === "READY" && <CheckCircle2 size={13} className="text-emerald-500" />}
                {!TERMINAL.has(job.state) && <Loader2 size={13} className="animate-spin text-amber-500" />}
                {STATE_LABEL[job.state] ?? job.state}
              </p>
              {job.state === "READY" && job.video_url ? (
                <video src={job.video_url} controls className="mt-3 aspect-[9/16] w-full rounded-lg bg-zinc-900 object-cover" />
              ) : (
                <div className="mt-3 flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-lg bg-zinc-100 text-xs text-zinc-400">
                  {TERMINAL.has(job.state) ? (
                    <>
                      <VideoOff size={20} />
                      Tidak ada video
                    </>
                  ) : (
                    <>
                      <Loader2 size={20} className="animate-spin text-zinc-300" />
                      Sedang diproses...
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
