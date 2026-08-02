"use client";

import { useRef, useState } from "react";
import { apiFetch, ApiFail } from "../_components/api";

const MAX_CLIPS = 5;

// Video Promosi (non-ecommerce) — PROTOTYPE, sengaja mentah/tidak dipoles.
// Buktikan alur upload (N klip) -> generate hook AI + VO -> stitch jalan
// teknis dulu (brief: BRIEF_VIDEO_NON_ECOMMERCE.md), sebelum UI polish.
export default function PromoPrototypePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const busy = status.startsWith("Upload") || status.startsWith("Job dibuat");

  function stopPoll() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function upload() {
    if (files.length < 1) return;
    setError(null);
    setVideoUrl(null);
    try {
      const uploadedClipUrls: string[] = [];
      for (const [i, file] of files.entries()) {
        setStatus(`Upload klip ${i + 1}/${files.length}...`);
        const fd = new FormData();
        fd.set("clip", file);
        const up = await apiFetch<{ uploaded_clip_url: string; size_bytes: number }>("/api/promo/upload", { formData: fd });
        uploadedClipUrls.push(up.uploaded_clip_url);
      }
      setStatus("Semua klip terupload. Bikin job...");
      const job = await apiFetch<{ id: string; state: string }>("/api/promo/jobs", { json: { uploaded_clip_urls: uploadedClipUrls } });
      setJobId(job.id);
      setState(job.state);
      setStatus("Job dibuat — generating hook AI + VO + stitch (bisa ~1-2 menit)...");
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
        <p className="mt-1 text-sm text-zinc-500">Upload 1-{MAX_CLIPS} klip talking-head (ada suara, maks 60 dtk/klip) — AI bikin 1 segmen hook + VO di depan, lalu stitch jadi satu video.</p>
      </div>

      <input
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_CLIPS))}
        className="block w-full rounded-2xl border-2 border-zinc-200 bg-white p-3 text-sm"
      />
      {files.length > 0 && (
        <ul className="space-y-1 text-sm text-zinc-600">
          {files.map((f, i) => (
            <li key={i}>{i + 1}. {f.name} ({(f.size / 1024).toFixed(0)}KB)</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={upload}
        disabled={files.length < 1 || busy}
        className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 font-display font-bold text-white shadow-md shadow-amber-500/20 disabled:opacity-50"
      >
        Upload &amp; Generate ({files.length} klip)
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
