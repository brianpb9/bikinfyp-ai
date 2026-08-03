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
  virality_checklist: { score: number; checks: { id: string; label: string; passed: boolean }[] } | null;
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

  if (error) return <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white px-4 py-6"><ErrorText message={error} /></main>;
  if (!pkg) return <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white px-4 py-6 text-zinc-500">Memuat paket...</main>;

  return (
    <main className="min-h-dvh space-y-5 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 py-6 pb-10">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Langkah terakhir</p>
        <h1 className="font-display text-xl font-bold text-zinc-900">← Paket Posting</h1>
      </div>

      <section className="flex items-center justify-between rounded-2xl border-2 border-zinc-100 bg-white p-4 shadow-sm">
        <span className="font-bold">📹 Video</span>
        <a
          href={pkg.video_url}
          download="racun-video.mp4"
          className="flex min-h-[44px] items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 px-5 font-bold text-white shadow-sm shadow-amber-500/20"
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
            className="flex min-h-[44px] items-center rounded-xl border-2 border-zinc-200 bg-white px-5 font-semibold"
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
            className="flex min-h-[44px] items-center rounded-xl border-2 border-zinc-200 bg-white px-5 font-semibold"
          >
            {copied === "hashtag" ? "Tersalin!" : "Salin"}
          </button>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 text-sm">{pkg.hashtags.join(" ")}</div>
      </section>

      <section className="rounded-2xl border-2 border-zinc-100 bg-white p-4 shadow-sm">
        <p className="font-bold">⏰ Jam terbaik posting</p>
        <p className="text-lg">{pkg.suggested_post_time}</p>
      </section>

      {pkg.virality_checklist && (
        <section className="space-y-2 rounded-2xl border-2 border-zinc-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Cek Kelayakan Posting (v1, kasar)</p>
          <ul className="space-y-1.5">
            {pkg.virality_checklist.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <span className={c.passed ? "text-emerald-600" : "text-red-500"}>{c.passed ? "✓" : "✕"}</span>
                <span className={c.passed ? "text-zinc-700" : "text-red-700"}>{c.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
