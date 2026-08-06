"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../../_components/api";
import { ProgressDots, SecondaryButton } from "../../_components/ui";
import { loadFlow, saveFlow } from "../../_components/flow";
import { track } from "../../_components/track";

interface JobStatus {
  id: string;
  state: string;
  message: string;
}

// Progress theater (adopsi 2026-08-06, riset teardown kompetitor): bahasa kru
// produksi, bukan state teknis — loading terasa seperti studio yang bekerja.
const STEPS = [
  { label: "Skrip dikunci", states: ["QUEUED", "GENERATING_VISUAL", "GENERATING_VOICE", "COMPOSITING", "QC_CHECK", "LABELING", "READY"] },
  { label: "Kreator AI syuting produkmu", states: ["GENERATING_VOICE", "COMPOSITING", "QC_CHECK", "LABELING", "READY"] },
  { label: "Editing: caption, harga & musik", states: ["QC_CHECK", "LABELING", "READY"] },
  { label: "Quality check tiap frame", states: ["READY"] },
];
const ACTIVE_LABEL: Record<string, string> = {
  QUEUED: "Skrip dikunci",
  GENERATING_VISUAL: "Kreator AI syuting produkmu",
  GENERATING_VOICE: "Kreator AI syuting produkmu",
  COMPOSITING: "Editing: caption, harga & musik",
  QC_CHECK: "Quality check tiap frame",
  LABELING: "Quality check tiap frame",
};
const THEATER_HEADLINE: Record<string, string> = {
  QUEUED: "Menyiapkan studio & casting kreatormu...",
  GENERATING_VISUAL: "🎬 Kreator AI lagi syuting produkmu...",
  GENERATING_VOICE: "🎙️ Ngisi suara & atur intonasi...",
  COMPOSITING: "✂️ Editor lagi pasang caption, harga & musik...",
  QC_CHECK: "🔍 Sutradara ngecek hasilnya frame per frame...",
  LABELING: "🔍 Sutradara ngecek hasilnya frame per frame...",
};

// S5 — SEDANG DIPROSES (Langkah 4/5)
function ProsesInner() {
  const router = useRouter();
  const params = useSearchParams();
  // Job dari URL; fallback ke sessionStorage (user tutup & buka lagi tanpa link).
  const jobId = params.get("job") ?? loadFlow().jobId ?? null;
  const [job, setJob] = useState<JobStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [estimateText, setEstimateText] = useState("Sekitar 1–2 menit lagi");

  useEffect(() => {
    apiFetch<{ estimate_text: string }>("/api/meta")
      .then((m) => setEstimateText(m.estimate_text))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId) return;
    saveFlow({ jobId });
    let disposed = false;
    let inFlight = false;
    let terminal = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (!disposed && document.visibilityState === "visible") timer = setTimeout(poll, 3000);
    };
    const poll = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        // Yang panjang adalah render provider, bukan endpoint status. Satu request
        // status maksimal 15 dtk agar koneksi lambat tak menumpuk tiap 3 dtk.
        const j = await apiFetch<JobStatus>(`/api/jobs/${jobId}`, { signal: controller.signal });
        setJob(j);
        setConnectionIssue(false);
        if (j.state === "READY") {
          terminal = true;
          track("proses_ready");
          router.replace(`/bikin/hasil?job=${jobId}`);
        } else if (j.state === "FAILED" || j.state === "REFUNDED") {
          terminal = true;
          setFailed(true);
        }
      } catch {
        // Jangan membuat user menebak apakah render atau koneksinya yang macet.
        setConnectionIssue(true);
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        controller = null;
        if (!terminal) schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (timer) clearTimeout(timer);
        timer = null;
        controller?.abort();
      } else if (!inFlight && !timer) {
        void poll();
      }
    };

    poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [jobId, router]);

  const activeLabel = job ? ACTIVE_LABEL[job.state] : undefined;

  if (failed) {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-10">
        <div className="px-4 pt-3"><ProgressDots step={4} /></div>
        <div className="space-y-4 rounded-3xl border-2 border-red-100 bg-red-50 p-6 text-center shadow-sm">
          <p className="text-4xl">😔</p>
          <h1 className="text-xl font-bold text-red-900">Hasilnya belum bagus</h1>
          <p className="text-red-800">
            Hasilnya belum bagus, jadi kredit kamu sudah kami balikin. Coba ganti fotonya ya.
          </p>
          <SecondaryButton href="/bikin/produk">Coba lagi</SecondaryButton>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-10">
      <div className="px-4 pt-3">
        <h1 className="flex min-h-[44px] items-center text-lg font-bold">Sedang dibikin...</h1>
        <ProgressDots step={4} />
      </div>
      <div className="space-y-6 px-4">
        <div className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-800">
              {(job && THEATER_HEADLINE[job.state]) ?? "Menyiapkan studio & casting kreatormu..."}
            </span>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Proses aman</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-amber-100">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-amber-500" />
          </div>
        </div>
        <ul className="space-y-1 rounded-3xl border border-zinc-100 bg-white p-3 shadow-sm">
          {STEPS.map((s) => {
            const done = job ? s.states.includes(job.state) && (s.label !== activeLabel || job.state === "READY") : false;
            const active = job && s.label === activeLabel && job.state !== "READY";
            return (
              <li key={s.label} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-base">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                  done ? "bg-green-100 text-green-700" : active ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-400"
                }`}>
                  {done ? "✓" : active ? "▸" : "○"}
                </span>
                <span className={done ? "font-semibold text-zinc-800" : active ? "font-semibold text-amber-700" : "text-zinc-400"}>
                  {s.label}{active ? "..." : ""}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-center text-sm font-medium text-zinc-600">{estimateText}</p>
        {connectionIssue && (
          <p role="status" className="rounded-2xl bg-amber-50 p-3 text-center text-sm text-amber-800">
            Koneksi lagi bermasalah. Kami tetap lanjut bikin videonya dan akan coba cek lagi otomatis.
          </p>
        )}
        <p className="rounded-2xl border border-zinc-100 bg-white p-4 text-center text-sm leading-6 text-zinc-600 shadow-sm">
          Kamu boleh tutup halaman ini — nanti kami kabarin.
        </p>
        <SecondaryButton href="/bikin/produk">Bikin Video Lain</SecondaryButton>
      </div>
    </main>
  );
}

export default function ProsesPage() {
  return (
    <Suspense>
      <ProsesInner />
    </Suspense>
  );
}
