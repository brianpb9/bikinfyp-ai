"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../_components/api";
import { PrimaryButton } from "../_components/ui";
import { relTime } from "../_components/flow";

interface JobItem {
  id: string;
  state: string;
  product_name: string;
  created_at: string;
  thumb_url: string | null;
  script_id: string;
}

const STATE_LABEL: Record<string, string> = {
  READY: "Siap posting",
  FAILED: "Gagal",
  REFUNDED: "Gagal · kredit balik",
  QUEUED: "Antre",
};

// S8 — RIWAYAT VIDEO
export default function VideoPage() {
  const [jobs, setJobs] = useState<JobItem[] | null>(null);

  useEffect(() => {
    apiFetch<{ jobs: JobItem[] }>("/api/jobs")
      .then((d) => setJobs(d.jobs))
      .catch(() => setJobs([]));
  }, []);

  async function download(jobId: string) {
    try {
      const out = await apiFetch<{ video_url: string }>(`/api/jobs/${jobId}/output`);
      window.open(out.video_url, "_blank");
    } catch {
      /* video belum siap */
    }
  }

  return (
    <main className="min-h-dvh space-y-5 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Koleksi kreator</p><h1 className="font-display text-2xl font-bold">Video Saya</h1></div>

      {jobs === null ? (
        <div className="rounded-3xl border border-zinc-100 bg-white p-6 text-center text-zinc-500 shadow-sm">Memuat video kamu...</div>
      ) : jobs.length === 0 ? (
        <div className="space-y-5 overflow-hidden rounded-3xl border border-amber-200 bg-white text-center shadow-sm">
          <div className="bg-gradient-to-br from-amber-100 via-orange-50 to-white px-8 pb-5 pt-8">
            <p className="text-5xl" aria-hidden="true">🎬</p>
            <p className="mt-3 font-display text-xl font-bold">Video pertamamu mulai dari sini</p>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Pilih produk, pilih gaya, lalu biarkan kami siapkan videonya.</p>
          </div>
          <div className="px-6 pb-6"><PrimaryButton href="/bikin/produk">Bikin video pertama</PrimaryButton></div>
        </div>
      ) : (
        <>
          {jobs.length === 1 && (
            <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm font-bold text-amber-900">Koleksimu baru dimulai ✨</p>
              <p className="mt-1 text-sm leading-5 text-amber-800">Coba satu gaya lain agar punya video untuk dibandingkan dan diposting.</p>
              <Link href="/bikin/produk" className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm active:bg-amber-600">Bikin video lagi</Link>
            </aside>
          )}
          {jobs.map((j) => (
          <div key={j.id} className="flex gap-3 rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm transition-transform active:scale-[0.99]">
            <div className="h-24 w-16 shrink-0 overflow-hidden rounded-2xl bg-zinc-200 ring-1 ring-black/5">
              {j.thumb_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={j.thumb_url} alt={j.product_name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <div className="flex h-full items-center justify-center text-xl">📦</div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-bold">{j.product_name}</p>
              <p className="text-xs text-zinc-500">
                {relTime(j.created_at)} · {STATE_LABEL[j.state] ?? "Sedang dibikin"}
              </p>
              <div className="flex gap-2 pt-1">
                {j.state === "READY" && (
                  <button
                    type="button"
                    onClick={() => download(j.id)}
                    className="flex min-h-[44px] items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm active:bg-amber-600"
                  >
                    Unduh
                  </button>
                )}
                {j.script_id && (
                  <Link
                    href={`/bikin/skrip?script=${j.script_id}`}
                    className="flex min-h-[44px] items-center rounded-xl border-2 border-zinc-200 bg-white px-4 text-sm font-semibold active:bg-zinc-50"
                  >
                    Duplikat & edit
                  </Link>
                )}
              </div>
            </div>
          </div>
          ))}
        </>
      )}
    </main>
  );
}
