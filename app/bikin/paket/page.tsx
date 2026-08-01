"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../_components/api";
import { ErrorText } from "../../_components/ui";

interface OutputPackage {
  job_id: string;
  video_url: string;
  caption: string;
  hashtags: string[];
  suggested_post_time: string;
  compliance_checklist: string[];
  notice: string;
}

// S7 — PAKET KELUARAN
function PaketInner() {
  const params = useSearchParams();
  const jobId = params.get("job");
  const [pkg, setPkg] = useState<OutputPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);

  useEffect(() => {
    if (!jobId) return;
    apiFetch<OutputPackage>(`/api/jobs/${jobId}/output`)
      .then((d) => {
        setPkg(d);
        setChecked(d.compliance_checklist.slice(0, 3).map(() => false));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat paket."));
  }, [jobId]);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard ditolak browser */
    }
  }

  if (error) return <main className="px-4 py-6"><ErrorText message={error} /></main>;
  if (!pkg) return <main className="px-4 py-6 text-zinc-500">Memuat paket...</main>;

  return (
    <main className="space-y-5 px-4 py-6 pb-10">
      <h1 className="text-xl font-bold">← Paket Posting</h1>

      <section className="flex items-center justify-between rounded-2xl border-2 border-zinc-100 p-4">
        <span className="font-bold">📹 Video</span>
        <a
          href={pkg.video_url}
          download="racun-video.mp4"
          className="flex min-h-[44px] items-center rounded-xl bg-amber-500 px-5 font-bold text-white"
        >
          Unduh
        </a>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold">📝 Caption</span>
          <button
            type="button"
            onClick={() => copy("caption", pkg.caption)}
            className="flex min-h-[44px] items-center rounded-xl border-2 border-zinc-200 px-5 font-semibold"
          >
            {copied === "caption" ? "Tersalin!" : "Salin"}
          </button>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 text-sm whitespace-pre-wrap">{pkg.caption}</div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold">#️⃣ Hashtag</span>
          <button
            type="button"
            onClick={() => copy("hashtag", pkg.hashtags.join(" "))}
            className="flex min-h-[44px] items-center rounded-xl border-2 border-zinc-200 px-5 font-semibold"
          >
            {copied === "hashtag" ? "Tersalin!" : "Salin"}
          </button>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 text-sm">{pkg.hashtags.join(" ")}</div>
      </section>

      <section className="rounded-2xl border-2 border-zinc-100 p-4">
        <p className="font-bold">⏰ Jam terbaik posting</p>
        <p className="text-lg">{pkg.suggested_post_time}</p>
      </section>

      <section className="space-y-2 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
        <p className="font-bold">✅ Checklist aman sebelum posting</p>
        {pkg.compliance_checklist.slice(0, 3).map((item, i) => (
          <label key={i} className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={checked[i] ?? false}
              onChange={() => setChecked(checked.map((c, j) => (j === i ? !c : c)))}
              className="mt-1 h-5 w-5 accent-amber-500"
            />
            <span className={checked[i] ? "text-zinc-400 line-through" : ""}>{item}</span>
          </label>
        ))}
        <p className="text-xs text-amber-800">{pkg.notice}</p>
      </section>
    </main>
  );
}

export default function PaketPage() {
  return (
    <Suspense>
      <PaketInner />
    </Suspense>
  );
}
