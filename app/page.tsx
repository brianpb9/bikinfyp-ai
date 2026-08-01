"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "./_components/api";
import { PrimaryButton } from "./_components/ui";
import { relTime } from "./_components/flow";

interface JobItem {
  id: string;
  state: string;
  product_name: string;
  created_at: string;
  thumb_url: string | null;
}

// S1 — BERANDA
export default function HomePage() {
  const [credits, setCredits] = useState<number | null>(null);
  const [jobs, setJobs] = useState<JobItem[] | null>(null);

  useEffect(() => {
    apiFetch<{ credits: number }>("/api/auth/me")
      .then((d) => setCredits(d.credits))
      .catch(() => setCredits(null));
    apiFetch<{ jobs: JobItem[] }>("/api/jobs")
      .then((d) => setJobs(d.jobs.filter((j) => j.state === "READY").slice(0, 6)))
      .catch(() => setJobs([]));
  }, []);

  const isNewUser = jobs !== null && jobs.length === 0;

  return (
    <main className="space-y-6 px-4 py-6">
      <Link
        href="/bikin/produk"
        className={`flex w-full items-center justify-center rounded-3xl bg-amber-500 font-bold text-white shadow-md active:bg-amber-600 ${
          isNewUser ? "min-h-[96px] text-2xl" : "min-h-[56px] text-lg"
        }`}
      >
        ＋ BIKIN VIDEO
      </Link>

      {jobs === null ? null : jobs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-zinc-800">Video terakhir</h2>
          <div className="grid grid-cols-3 gap-3">
            {jobs.slice(0, 3).map((j) => (
              <Link key={j.id} href={`/bikin/hasil?job=${j.id}`} className="space-y-1">
                <div className="aspect-[9/16] overflow-hidden rounded-xl bg-zinc-200">
                  {j.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={j.thumb_url} alt={j.product_name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl">📦</div>
                  )}
                </div>
                <p className="truncate text-xs text-zinc-600">
                  {j.product_name} · {relTime(j.created_at)}
                </p>
              </Link>
            ))}
          </div>
          <Link href="/video" className="flex min-h-[44px] items-center text-sm font-semibold text-amber-600">
            Lihat semua →
          </Link>
        </section>
      ) : (
        <p className="rounded-2xl bg-zinc-50 p-4 text-center text-sm text-zinc-500">
          Belum ada video. Yuk bikin yang pertama — gratis pakai kredit bonus kamu!
        </p>
      )}

      {credits !== null && credits < 15000 && (
        <Link
          href="/kredit"
          className="flex min-h-[56px] items-center justify-between rounded-2xl border-2 border-amber-200 bg-amber-50 px-4"
        >
          <span className="font-semibold text-amber-900">Kredit tinggal Rp{credits.toLocaleString("id-ID")}</span>
          <span className="font-bold text-amber-600">Top-up →</span>
        </Link>
      )}
    </main>
  );
}
