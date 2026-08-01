"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../_components/api";
import { ProgressDots, SecondaryButton, WarnCard, ErrorText } from "../../_components/ui";
import { saveFlow } from "../../_components/flow";

interface OutputPackage {
  job_id: string;
  video_url: string;
  script_id?: string;
}

// S6 — HASIL (Langkah 5/5)
function HasilInner() {
  const params = useSearchParams();
  const jobId = params.get("job");
  const [pkg, setPkg] = useState<OutputPackage | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    apiFetch<OutputPackage>(`/api/jobs/${jobId}/output`)
      .then(setPkg)
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat hasil."));
    apiFetch<{ script_id: string }>(`/api/jobs/${jobId}`)
      .then((j) => setScriptId(j.script_id))
      .catch(() => {});
  }, [jobId]);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-10">
      <div className="px-4 pt-3">
        <h1 className="flex min-h-[44px] items-center text-lg font-bold">← Hasil</h1>
        <ProgressDots step={5} />
      </div>
      <div className="space-y-5 px-4">
        <ErrorText message={error} />
        {pkg && (
          <>
            <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] bg-zinc-900 shadow-xl shadow-amber-900/10 ring-1 ring-black/5">
              <video
                src={pkg.video_url}
                controls
                playsInline
                preload="metadata"
                className="aspect-[9/16] w-full"
              />
            </div>

            <WarnCard>
              <p className="font-bold">⚠ Sebelum posting:</p>
              <p>
                nyalakan tanda &ldquo;konten AI&rdquo; di TikTok ya, biar akun kamu aman.{" "}
                <a href={`/bikin/paket?job=${jobId}`} className="font-bold underline">
                  Lihat caranya →
                </a>
              </p>
            </WarnCard>

            <a
              href={pkg.video_url}
              download="racun-video.mp4"
              className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-500 text-lg font-bold text-white shadow-md shadow-amber-500/20 transition-transform active:scale-[0.98] active:bg-amber-600"
            >
              Unduh Videonya
            </a>
            <SecondaryButton href={`/bikin/paket?job=${jobId}`}>
              Lihat paket posting (caption, hashtag, jam)
            </SecondaryButton>
            {scriptId && (
              <SecondaryButton href={`/bikin/skrip?script=${scriptId}`}>
                Bikin Versi Lain
              </SecondaryButton>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function HasilPage() {
  return (
    <Suspense>
      <HasilInner />
    </Suspense>
  );
}
