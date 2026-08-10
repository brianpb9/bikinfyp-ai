"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiFail } from "../../../../_components/api";

type BulkJob = { job_id: string; state: string; product_name: string; cost_idr: number; video_url: string | null; caption: string | null };
type BulkRunResponse = { bulk_run_id: string; jobs: BulkJob[]; ready_count: number; failed_count: number; total: number };

const TERMINAL = new Set(["READY", "FAILED", "REFUNDED"]);
const POLL_MS = 5000;

const STATE_LABEL: Record<string, string> = {
  QUEUED: "Antre", GENERATING_VISUAL: "Bikin visual", GENERATING_VOICE: "Bikin suara",
  COMPOSITING: "Menyusun video", QC_CHECK: "Cek kualitas", LABELING: "Finalisasi",
  READY: "Siap", FAILED: "Gagal", REFUNDED: "Gagal (kredit dikembalikan)",
};

// Galeri hasil bulk run (M4, F-ENT-01) — polling sederhana tiap 5 dtk sampai
// semua job mencapai state terminal. Sesuai desain: satu bulk_run_id bisa
// dilihat semua anggota org (lihat komentar org-scoped di route API-nya).
export default function BulkRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [data, setData] = useState<BulkRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await apiFetch<BulkRunResponse>(`/api/dashboard/bulk/${runId}`);
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
        <Link href="/dashboard/bulk" className="text-xs font-semibold text-amber-600">&larr; Bulk Generate baru</Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Hasil Bulk Run</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">
          {data ? `${data.ready_count} siap / ${data.total} total` : "Memuat..."}
        </h1>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {data && (
        <ul className="grid grid-cols-2 gap-4">
          {data.jobs.map((job) => (
            <li key={job.job_id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="truncate text-sm font-semibold text-zinc-900">{job.product_name}</p>
              <p className="mt-1 text-xs font-medium text-zinc-500">{STATE_LABEL[job.state] ?? job.state}</p>
              {job.state === "READY" && job.video_url ? (
                <video src={job.video_url} controls className="mt-3 aspect-[9/16] w-full rounded-lg bg-zinc-900 object-cover" />
              ) : (
                <div className="mt-3 flex aspect-[9/16] w-full items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-400">
                  {TERMINAL.has(job.state) ? "Tidak ada video" : "Sedang diproses..."}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
