"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../_components/api";
import { PrimaryButton } from "../_components/ui";
import { relTime } from "../_components/flow";
import { track } from "../_components/track";
import { JobThumb } from "../_components/JobThumb";

interface JobItem {
  id: string;
  state: string;
  product_name: string;
  created_at: string;
  thumb_url: string | null;
  preview_url: string | null;
  script_id: string;
  fyp_score?: number | null;
  fyp_posted_url?: string | null;
}

// Lapor hasil posting (loop belajar Skor FYP): link beku setelah tersimpan,
// angka views/pesanan boleh diisi/diperbarui menyusul.
function ReportForm({ job }: { job: JobItem }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(job.fyp_posted_url ?? "");
  const [views, setViews] = useState("");
  const [orders, setOrders] = useState("");
  const [saved, setSaved] = useState(Boolean(job.fyp_posted_url));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/jobs/${job.id}/report`, {
        json: {
          posted_url: url,
          views: views.trim() === "" ? null : Number(views),
          orders: orders.trim() === "" ? null : Number(orders),
        },
      });
      setSaved(true);
      track("report_saved");
      setMsg("✓ Tersimpan. Makasih — data ini bikin Skor FYP makin akurat.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal menyimpan. Coba lagi ya.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-left text-xs font-semibold text-amber-700 underline underline-offset-2"
      >
        {saved ? "✓ Terlapor · perbarui hasil" : "Sudah diposting? Lapor hasilnya →"}
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={saved}
        placeholder="https:// link postinganmu"
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm disabled:text-zinc-400"
      />
      <div className="flex gap-2">
        <input type="number" min={0} value={views} onChange={(e) => setViews(e.target.value)} placeholder="Views"
          className="w-1/2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm" />
        <input type="number" min={0} value={orders} onChange={(e) => setOrders(e.target.value)} placeholder="Pesanan"
          className="w-1/2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm" />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy || url.trim() === ""}
        className="min-h-[40px] rounded-xl bg-amber-500 px-4 text-sm font-bold text-white disabled:bg-zinc-300"
      >
        {busy ? "Menyimpan..." : "Simpan hasil"}
      </button>
      {msg && <p className="text-xs text-zinc-600">{msg}</p>}
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  READY: "Siap posting",
  FAILED: "Gagal",
  REFUNDED: "Gagal · kredit balik",
  QUEUED: "Antre",
};

const FAILED_STATES = new Set(["FAILED", "REFUNDED"]);

// S8 — RIWAYAT VIDEO
export default function VideoPage() {
  const [jobs, setJobs] = useState<JobItem[] | null>(null);
  // Tab Berhasil/Gagal (permintaan Brian 2026-08-07): video gagal tidak boleh
  // menumpuk di daftar utama — dipisah ke tab sendiri.
  const [tab, setTab] = useState<"ok" | "failed">("ok");

  useEffect(() => {
    apiFetch<{ jobs: JobItem[] }>("/api/jobs")
      .then((d) => setJobs(d.jobs))
      .catch(() => setJobs([]));
  }, []);

  async function download(jobId: string) {
    try {
      track("download_click");
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
      ) : (() => {
        const processing = jobs.filter((j) => !FAILED_STATES.has(j.state) && j.state !== "READY");
        const ok = jobs.filter((j) => j.state === "READY");
        const failed = jobs.filter((j) => FAILED_STATES.has(j.state));
        const shown = tab === "ok" ? ok : failed;
        return (
        <>
          {/* Job yang masih diproses selalu tampil di atas — dan penegasan
              bahwa menutup HP tidak menghentikan pembuatan video (server-side). */}
          {processing.map((j) => (
            <div key={j.id} className="flex items-center gap-3 rounded-3xl border border-amber-200 bg-amber-50/70 p-3 shadow-sm">
              <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{j.product_name}</p>
                <p className="text-xs text-amber-800">Sedang dibikin di server — boleh tutup aplikasi, hasilnya muncul di sini.</p>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1" role="tablist">
            {([["ok", `Berhasil (${ok.length})`], ["failed", `Gagal (${failed.length})`]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-[44px] rounded-xl text-sm font-bold transition-colors ${tab === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "ok" && ok.some((j) => typeof j.fyp_score === "number") && (
            <p className="rounded-2xl bg-zinc-50 p-3 text-xs leading-5 text-zinc-500">
              <b>Skor skrip</b> menilai rencana kontennya (hook, struktur, timing) dibanding
              pola video yang terbukti menang — bukan kualitas gambar videonya.
            </p>
          )}
          {tab === "failed" && failed.length > 0 && (
            <p className="rounded-2xl bg-zinc-50 p-3 text-xs leading-5 text-zinc-500">
              Kredit video gagal otomatis dikembalikan. Tap “Duplikat & edit” untuk coba lagi dengan skrip yang sama.
            </p>
          )}
          {shown.length === 0 && (
            <p className="rounded-3xl border border-zinc-100 bg-white p-6 text-center text-sm text-zinc-500 shadow-sm">
              {tab === "ok" ? "Belum ada video berhasil." : "Tidak ada video gagal. 👍"}
            </p>
          )}
          {tab === "ok" && ok.length === 1 && processing.length === 0 && (
            <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm font-bold text-amber-900">Koleksimu baru dimulai ✨</p>
              <p className="mt-1 text-sm leading-5 text-amber-800">Coba satu gaya lain agar punya video untuk dibandingkan dan diposting.</p>
              <Link href="/bikin/produk" className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm active:bg-amber-600">Bikin video lagi</Link>
            </aside>
          )}
          {shown.map((j) => (
          <div key={j.id} className="flex gap-3 rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm transition-transform active:scale-[0.99]">
            <div className="h-24 w-16 shrink-0 overflow-hidden rounded-2xl bg-zinc-200 ring-1 ring-black/5">
              <JobThumb preview_url={j.preview_url} thumb_url={j.thumb_url} alt={j.product_name} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-bold">{j.product_name}</p>
              <p className="text-xs text-zinc-500">
                {relTime(j.created_at)} · {STATE_LABEL[j.state] ?? "Sedang dibikin"}
                {/* Skor menilai RENCANA konten (skrip/struktur vs pola video
                    pemenang), bukan kualitas render — di video gagal disembunyikan
                    dan labelnya dibuat jujur (insiden "video sampah skor 97"). */}
                {typeof j.fyp_score === "number" && j.state === "READY" && (
                  <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-bold text-amber-700" title="Menilai skrip & struktur konten — bukan kualitas gambar">Skor skrip {j.fyp_score}</span>
                )}
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
              {j.state === "READY" && <ReportForm job={j} />}
            </div>
          </div>
          ))}
        </>
        );
      })()}
    </main>
  );
}
