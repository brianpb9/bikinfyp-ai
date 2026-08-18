"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, Download, Eye, Film, Loader2, Search, Sparkles, VideoOff,
} from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";
import { BTN_PRIMARY_SM } from "@/app/dashboard/_components/buttons";

interface Video {
  job_id: string; state: string; product_name: string; created_at: string;
  format: string; duration_s: number; cost_idr: number; run_id: string | null;
  caption: string | null; video_url: string | null; download_url: string | null;
  thumb_url: string | null; fail_reason: string | null;
}
interface LibraryResponse {
  filter: string;
  counts: { all: number; ready: number; review: number; failed: number };
  videos: Video[];
}

const TERMINAL = new Set(["READY", "FAILED", "REFUNDED"]);
const POLL_MS = 8000;

const STATE_LABEL: Record<string, string> = {
  QUEUED: "Antre", GENERATING_VISUAL: "Bikin visual", AWAITING_APPROVAL: "Perlu ditinjau",
  GENERATING_VOICE: "Bikin suara", COMPOSITING: "Menyusun", QC_CHECK: "Cek kualitas",
  LABELING: "Finalisasi", READY: "Siap", FAILED: "Gagal", REFUNDED: "Gagal (kredit kembali)",
};
const FORMAT_LABEL: Record<string, string> = {
  talking_head: "Wajah AI", hands_only: "Tangan + VO", tvc: "TVC", vo_broll: "Foto + VO",
  ads: "Iklan",
};

const TABS = [
  { id: "all", label: "Semua" },
  { id: "ready", label: "Siap" },
  { id: "review", label: "Perlu ditinjau" },
  { id: "failed", label: "Gagal" },
] as const;

// Library org — tab tersendiri atas permintaan Brian (referensi tab Library
// Suno). Sebelum ini hasil hanya bisa dijangkau lewat halaman per-kampanye,
// jadi video lama praktis hilang. Di sini semuanya berkumpul, bisa dicari,
// disaring, dan yang paling penting: BISA DIUNDUH — tombol unduh sebelumnya
// memang tidak pernah ada di mana pun.
export default function LibraryPage() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");
  // Beranda menautkan ke ?filter=review. Dibaca dari window, bukan
  // useSearchParams, supaya halaman ini tidak butuh batas <Suspense> hanya
  // untuk satu parameter opsional.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("filter");
    if (f && ["all", "ready", "review", "failed"].includes(f)) setTab(f);
  }, []);
  const [q, setQ] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<LibraryResponse>(`/api/dashboard/library?filter=${tab}`);
      setData(res);
      setError(null);
      return res;
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal memuat library.");
      return null;
    }
  }, [tab]);

  // Polling hanya selama masih ada yang berjalan. Pola pollKey yang sama
  // dipakai di layar review scene setelah bug "layar membeku" di sana.
  const [pollKey, setPollKey] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const res = await load();
      if (stopped) return;
      const running = !res || res.videos.some((v) => !TERMINAL.has(v.state) && v.state !== "AWAITING_APPROVAL");
      if (running) timer = setTimeout(() => setPollKey((k) => k + 1), POLL_MS);
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [load, pollKey]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data?.videos ?? [];
    // Ikut mencari di caption. Mencari hanya di nama produk praktis percuma
    // begitu satu produk punya belasan video — semuanya cocok atau semuanya
    // tidak. Yang membedakan video satu dengan lainnya adalah captionnya.
    return (data?.videos ?? []).filter(
      (v) =>
        v.product_name.toLowerCase().includes(needle) ||
        (v.caption ?? "").toLowerCase().includes(needle)
    );
  }, [data, q]);

  const downloadable = visible.filter((v) => v.download_url);

  // Unduh semua: klik berurutan dengan jeda. Browser memblokir banyak unduhan
  // serentak dari satu gestur, jadi jeda ini bukan kosmetik — tanpa itu hanya
  // berkas pertama yang benar-benar tersimpan.
  async function downloadAll() {
    setBulkBusy(true);
    try {
      for (const v of downloadable) {
        const a = document.createElement("a");
        a.href = v.download_url!;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 700));
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const counts = data?.counts ?? { all: 0, ready: 0, review: 0, failed: 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Organisasi</p>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Library</h1>
          <p className="mt-1 text-sm text-zinc-500">Semua video yang pernah dibuat, dari semua kampanye.</p>
        </div>
        {/* Di HP: cari melebar penuh dan tombol unduh turun baris — w-56 tetap
            untuk desktop. Dua kontrol berdempetan di 360px membuat keduanya
            tidak bisa dipakai. */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari produk atau caption..."
              className="w-full rounded-xl border border-zinc-300 sm:w-56 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400"
            />
          </div>
          <button
            onClick={downloadAll}
            disabled={bulkBusy || downloadable.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {bulkBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Unduh semua{downloadable.length > 0 ? ` (${downloadable.length})` : ""}
          </button>
        </div>
      </div>

      {/* Dua kartu ringkas di atas, mengikuti pola Library yang Brian kirim:
          angka penting terbaca duluan sebelum daftar panjang. */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4">
        <button
          onClick={() => setTab("ready")}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-left shadow-sm transition-transform hover:-translate-y-0.5"
        >
          <Film size={20} className="text-white/80" />
          <p className="mt-6 font-display text-3xl font-bold text-white">{counts.ready}</p>
          <p className="text-sm font-semibold text-white/90">Siap diunduh</p>
        </button>
        <button
          onClick={() => setTab("review")}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 p-5 text-left shadow-sm transition-transform hover:-translate-y-0.5"
        >
          <Eye size={20} className="text-white/70" />
          <p className="mt-6 font-display text-3xl font-bold text-white">{counts.review}</p>
          <p className="text-sm font-semibold text-white/80">Menunggu kamu tinjau</p>
        </button>
      </section>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {t.label} {counts[t.id as keyof typeof counts]}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!data ? (
        <ul className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex gap-4 rounded-2xl border border-zinc-200 bg-white p-3">
              <div className="h-24 w-16 animate-pulse rounded-lg bg-zinc-200" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
              </div>
            </li>
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <Sparkles size={24} className="text-zinc-300" />
          <p className="text-sm text-zinc-500">{q ? `Tidak ada video untuk "${q}".` : "Belum ada video di sini."}</p>
          <Link href="/dashboard/campaign" className="text-sm font-semibold text-amber-600 hover:text-amber-700">Bikin video pertama</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((v) => (
            <li key={v.job_id} className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-3 transition-shadow hover:shadow-md">
              <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                {v.thumb_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumb_url} alt="" className="h-full w-full object-cover" />
                ) : v.video_url ? (
                  <video src={v.video_url} preload="metadata" muted className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-600">
                    {TERMINAL.has(v.state) ? <VideoOff size={16} /> : <Loader2 size={16} className="animate-spin" />}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-zinc-900">{v.product_name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span>{FORMAT_LABEL[v.format] ?? v.format}</span>
                  <span className="text-zinc-300">·</span>
                  <span>{v.duration_s} dtk</span>
                  <span className="text-zinc-300">·</span>
                  <span>{new Date(v.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                </p>
                {/* Caption dipakai sebagai PEMBEDA baris, bukan hiasan. Kasus
                    normal di sini adalah beberapa variasi dari SATU produk:
                    tanpa baris ini semuanya tampil "Glowlab Barrier Serum"
                    yang sama persis dan brand tidak bisa membedakan mana yang
                    mana tanpa memutar satu per satu. */}
                {v.caption && (
                  <p className="mt-1 truncate text-xs italic text-zinc-400">“{v.caption}”</p>
                )}
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold">
                  {v.state === "READY" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      <CheckCircle2 size={11} /> {STATE_LABEL[v.state]}
                    </span>
                  ) : v.state === "AWAITING_APPROVAL" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                      <Eye size={11} /> {STATE_LABEL[v.state]}
                    </span>
                  ) : TERMINAL.has(v.state) ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">{STATE_LABEL[v.state] ?? v.state}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                      <Loader2 size={11} className="animate-spin" /> {STATE_LABEL[v.state] ?? v.state}
                    </span>
                  )}
                </p>
                {/* Sebelumnya video gagal hanya bertuliskan "Gagal" tanpa satu
                    kata pun alasan — brand tidak tahu harus mengulang, ganti
                    produk, atau menghubungi kami. Padahal tokennya sudah
                    dikembalikan, jadi diamnya terasa lebih buruk dari
                    kenyataannya. */}
                {v.fail_reason && (
                  <p className="mt-1 text-xs leading-5 text-red-600">{v.fail_reason}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {v.state === "AWAITING_APPROVAL" && (
                  <Link
                    href={`/dashboard/campaign/job/${v.job_id}`}
                    className={BTN_PRIMARY_SM}
                  >
                    <Eye size={13} /> Tinjau
                  </Link>
                )}
                {v.download_url && (
                  <a
                    href={v.download_url}
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <Download size={13} /> Unduh
                  </a>
                )}
                {v.run_id && (
                  <Link
                    href={`/dashboard/campaign/${v.run_id}`}
                    className="rounded-lg px-2 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-zinc-700"
                  >
                    Kampanye
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
