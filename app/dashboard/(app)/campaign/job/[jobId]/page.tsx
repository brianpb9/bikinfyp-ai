"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { apiFetch, ApiFail } from "../../../../../_components/api";
import { SkeletonCard } from "../../../../_components/Skeleton";

interface Scene {
  idx: number; duration_sec: number; prompt: string;
  video_url: string; thumb_url: string | null;
  regen_requested: boolean; regen_count: number; regen_left: number; regen_tokens: number;
}
interface Segment { role: string; start: number; end: number; text: string }
interface ReviewResponse {
  job_id: string; state: string; product_name: string; approved: boolean;
  segments: Segment[]; scenes: Scene[]; max_regen_per_scene: number;
}

const POLL_MS = 5000;

// Layar review scene (M11, F-ENT-01) — mengikuti alur yang Brian minta:
// brand melihat GAMBAR + kalimat skrip + PROMPT tiap scene, lalu menyetujui
// atau minta ganti per scene. Compositing baru jalan setelah disetujui.
// Prompt ditampilkan apa adanya (bisa dibuka), bukan diringkas: brand yang
// peduli pesan berhak tahu persis apa yang dikirim ke model.
export default function SceneReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPrompt, setOpenPrompt] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ReviewResponse>(`/api/dashboard/campaign/job/${jobId}`);
      setData(res);
      setError(null);
      return res;
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal memuat scene.");
      return null;
    }
  }, [jobId]);

  // Polling DIJALANKAN ULANG lewat pollKey, bukan lewat satu loop yang
  // menjadwalkan dirinya sendiri.
  //
  // Bug yang diperbaiki (dilaporkan Brian: "tombolnya tidak bekerja"): loop
  // lama berhenti PERMANEN begitu job sampai AWAITING_APPROVAL tanpa regen —
  // itu memang kondisi menganggur yang benar. Tapi setelah brand menekan
  // "Ganti scene ini", regen_requested jadi TRUE dan tidak ada lagi yang
  // polling, jadi spinner "Sedang dibuat ulang..." menggantung selamanya dan
  // tombol Setujui ikut terkunci (disabled saat regenerating). Dari sisi
  // brand, SEMUA tombol tampak mati padahal request-nya sukses.
  //
  // Sekarang tiap muatan menjadwalkan muatan berikutnya HANYA bila masih ada
  // yang ditunggu, dan act() menaikkan pollKey sehingga siklusnya hidup lagi.
  const [pollKey, setPollKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    (async () => {
      const res = await load();
      if (stopped) return;
      // Gagal muat pun tetap dijadwalkan ulang: gangguan jaringan sesaat tidak
      // boleh mematikan layar ini sampai halaman di-refresh manual.
      // Menganggur HANYA saat benar-benar menunggu keputusan brand: sudah di
      // gerbang review, belum disetujui, tidak ada regen berjalan. Setelah
      // disetujui, state DB masih AWAITING_APPROVAL sampai worker mengambil
      // job — tanpa `res.approved` di sini layar membeku lagi persis seperti
      // bug regenerate, cuma di langkah berikutnya.
      const waiting = !res || res.state !== "AWAITING_APPROVAL" || res.approved || res.scenes.some((s) => s.regen_requested);
      if (waiting) timerRef.current = setTimeout(() => setPollKey((k) => k + 1), POLL_MS);
    })();
    return () => { stopped = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [load, pollKey]);

  async function act(action: "approve" | "regenerate", idx?: number) {
    setBusy(action === "approve" ? "approve" : `regen-${idx}`);
    setError(null);
    try {
      await apiFetch(`/api/dashboard/campaign/job/${jobId}`, { json: { action, idx } });
      // Menaikkan pollKey memuat ulang SEKALIGUS menghidupkan lagi siklus
      // polling — tanpa ini layar membeku persis seperti bug di atas.
      setPollKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Aksi gagal.");
    } finally {
      setBusy(null);
    }
  }

  const scriptLine = (idx: number) => data?.segments?.[idx]?.text ?? null;
  const regenerating = data?.scenes.some((s) => s.regen_requested) ?? false;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Review Scene</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">{data?.product_name ?? "Memuat..."}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cek tiap scene. Kalau ada yang kurang pas, minta ganti scene itu saja — yang lain tetap.
          Video baru digabung setelah kamu setujui. Mengganti scene memakai token tambahan,
          karena setiap penggantian memanggil AI video lagi.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
        </div>
      )}

      {data && (data.approved || data.state !== "AWAITING_APPROVAL") && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
          {data.approved ? "Sudah disetujui — video sedang digabung." : "Scene-nya masih dibuat, sebentar ya."}
        </div>
      )}

      {!data ? (
        <div className="grid grid-cols-2 gap-4">{Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : (
        <ul className="space-y-4">
          {data.scenes.map((scene) => {
            const line = scriptLine(scene.idx);
            const promptOpen = openPrompt.has(scene.idx);
            return (
              <li key={scene.idx} className="flex gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="w-32 shrink-0">
                  {scene.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={scene.thumb_url} alt={`Scene ${scene.idx + 1}`} className="aspect-[9/16] w-full rounded-lg bg-zinc-900 object-cover" />
                  ) : (
                    <video src={scene.video_url} controls className="aspect-[9/16] w-full rounded-lg bg-zinc-900 object-cover" />
                  )}
                </div>

                {/* justify-between: sebelumnya seluruh isi menggumpal di atas
                    dan menyisakan ruang kosong setinggi hampir separuh kartu,
                    karena tinggi baris ditentukan thumbnail 9:16. Sekarang
                    aksinya turun ke bawah dan kartunya terbaca utuh. */}
                <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-zinc-900">Scene {scene.idx + 1}</p>
                    <span className="text-xs text-zinc-400">{scene.duration_sec.toFixed(0)} dtk</span>
                  </div>

                  {line && <p className="text-sm leading-6 text-zinc-700">&ldquo;{line}&rdquo;</p>}

                  <button
                    onClick={() => {
                      const next = new Set(openPrompt);
                      if (promptOpen) next.delete(scene.idx); else next.add(scene.idx);
                      setOpenPrompt(next);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-800"
                  >
                    <ChevronDown size={13} className={promptOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                    {promptOpen ? "Sembunyikan prompt" : "Lihat prompt yang dikirim ke AI"}
                  </button>
                  {promptOpen && (
                    <p className="rounded-lg bg-zinc-50 p-3 font-mono text-[11px] leading-5 text-zinc-600">{scene.prompt}</p>
                  )}

                  <div className="flex items-center gap-3 pt-1">
                    {scene.regen_requested ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                        <Loader2 size={13} className="animate-spin" /> Sedang dibuat ulang...
                      </span>
                    ) : (
                      <button
                        onClick={() => act("regenerate", scene.idx)}
                        disabled={busy !== null || scene.regen_left === 0 || data.approved || data.state !== "AWAITING_APPROVAL"}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                      >
                        {busy === `regen-${scene.idx}` ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                        Ganti scene ini · {scene.regen_tokens.toLocaleString("id-ID")} token
                      </button>
                    )}
                    <span className="text-xs text-zinc-400">
                      {scene.regen_left > 0 ? `sisa ${scene.regen_left}x ganti` : "batas ganti tercapai"}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Bilah persetujuan disembunyikan begitu approved_at terisi. Sebelumnya
          syaratnya cuma state, padahal state baru berubah saat WORKER mengambil
          job — jadi setelah menekan Setujui, tombolnya tetap menyala dan tidak
          ada perubahan apa pun di layar. Brand membacanya sebagai tombol rusak. */}
      {data && data.state === "AWAITING_APPROVAL" && !data.approved && (
        <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-zinc-600">
            {regenerating
              ? "Tunggu scene yang sedang dibuat ulang selesai dulu."
              : "Kalau semua sudah pas, gabungkan jadi video final."}
          </p>
          <button
            onClick={() => act("approve")}
            disabled={busy !== null || regenerating}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Setujui &amp; Gabungkan
          </button>
        </div>
      )}
    </div>
  );
}
