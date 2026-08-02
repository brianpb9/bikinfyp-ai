"use client";

import { useRef, useState } from "react";
import { apiFetch, ApiFail } from "../_components/api";

// Video Promosi (non-ecommerce) — PROTOTYPE, sengaja mentah/tidak dipoles.
// Buktikan alur upload -> generate hook AI -> stitch jalan teknis dulu
// (brief: BRIEF_VIDEO_NON_ECOMMERCE.md), sebelum VO + UI polish.
export default function PromoPrototypePage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  function stopPoll() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setVideoUrl(null);
    setStatus("Upload klip...");
    try {
      const fd = new FormData();
      fd.set("clip", file);
      const up = await apiFetch<{ uploaded_clip_url: string; duration_sec: number }>("/api/promo/upload", { formData: fd });
      setStatus(`Klip terupload (${up.duration_sec.toFixed(1)}s). Bikin job...`);
      const job = await apiFetch<{ id: string; state: string }>("/api/promo/jobs", { json: { uploaded_clip_url: up.uploaded_clip_url } });
      setJobId(job.id);
      setState(job.state);
      setStatus("Job dibuat — generating hook AI + stitch (bisa ~1-2 menit)...");
      stopPoll();
      pollRef.current = window.setInterval(() => poll(job.id), 3000);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal upload/bikin job.");
      setStatus("");
    }
  }

  async function poll(id: string) {
    try {
      const job = await apiFetch<{ state: string; error_message: string | null; output_url: string | null }>(`/api/promo/jobs/${id}`);
      setState(job.state);
      if (job.state === "READY") {
        setVideoUrl(job.output_url);
        setStatus("Selesai!");
        stopPoll();
      } else if (job.state === "FAILED") {
        setError(job.error_message ?? "Job gagal.");
        setStatus("");
        stopPoll();
      }
    } catch {
      /* poll error sementara — coba lagi di interval berikutnya */
    }
  }

  return (
    <main className="min-h-dvh space-y-5 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Prototype — internal</p>
        <h1 className="font-display text-xl font-bold text-zinc-900">Video Promosi (non-ecommerce)</h1>
        <p className="mt-1 text-sm text-zinc-500">Upload klip talking-head (ada suara, maks 60 dtk) — AI nambahin 1 segmen hook lalu stitch jadi satu video.</p>
      </div>

      <input
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full rounded-2xl border-2 border-zinc-200 bg-white p-3 text-sm"
      />

      <button
        type="button"
        onClick={upload}
        disabled={!file || status.startsWith("Upload") || status.startsWith("Job dibuat")}
        className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 font-display font-bold text-white shadow-md shadow-amber-500/20 disabled:opacity-50"
      >
        Upload &amp; Generate
      </button>

      {status && <p className="text-sm text-zinc-600">{status}{jobId ? ` (job: ${jobId.slice(0, 8)}…, state: ${state})` : ""}</p>}
      {error && <p className="rounded-2xl border-2 border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {videoUrl && (
        <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] bg-zinc-900 shadow-xl shadow-amber-900/10 ring-1 ring-black/5">
          <video src={videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full" />
        </div>
      )}
    </main>
  );
}
