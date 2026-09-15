"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Produk { id: string; nama: string; kategori: string; foto: number }
interface Qc { passed: boolean; gagal: string[]; biaya_idr: number | null }
interface Job {
  id: string; state: string; mesin: string; video: string | null;
  created_at: string; completed_at: string | null; qc: Qc | null; produk: string;
}

const SELESAI = ["READY", "FAILED", "REFUNDED"];
const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function PanelIklan() {
  const [produk, setProduk] = useState<Produk[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pilih, setPilih] = useState("");
  const [mesin, setMesin] = useState<"standard" | "ultra">("standard");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const muat = useCallback(async () => {
    const res = await fetch("/api/admin/iklan");
    if (!res.ok) return;
    const d = (await res.json()) as { produk: Produk[]; jobs: Job[] };
    setProduk(d.produk);
    setJobs(d.jobs);
    return d.jobs;
  }, []);

  // Render iklan berjalan 10–25 menit. Halaman menyegarkan diri HANYA selama
  // masih ada job yang belum selesai — dasbor yang memanggil server tiap
  // beberapa detik selamanya adalah beban yang tidak ada yang meminta.
  useEffect(() => {
    let hidup = true;
    const putar = async () => {
      const daftar = await muat();
      if (!hidup) return;
      const berjalan = (daftar ?? []).some((j) => !SELESAI.includes(j.state));
      if (berjalan) timer.current = setTimeout(putar, 15_000);
    };
    void putar();
    return () => { hidup = false; if (timer.current) clearTimeout(timer.current); };
  }, [muat]);

  async function mulai() {
    if (!pilih) return;
    setSibuk(true);
    setGalat(null);
    try {
      const res = await fetch("/api/admin/iklan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: pilih, mesin }),
      });
      const d = (await res.json().catch(() => ({}))) as { job_id?: string; message_id?: string; message?: string };
      if (!res.ok || !d.job_id) throw new Error(d.message_id ?? d.message ?? "Gagal memulai render.");
      await muat();
      if (!timer.current) timer.current = setTimeout(() => void muat(), 15_000);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memulai render.");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-bold text-zinc-900">Render baru</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Naskah, gambar kunci, klip, dan suara dibuat dari foto produk aslinya — tidak perlu skrip lebih dulu.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-600">Produk</span>
            <select
              value={pilih} onChange={(e) => setPilih(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm"
            >
              <option value="">— pilih produk (harus punya foto) —</option>
              {produk.map((p) => (
                <option key={p.id} value={p.id}>{p.nama} · {p.kategori} · {p.foto} foto</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-600">Mesin video</span>
            <select
              value={mesin} onChange={(e) => setMesin(e.target.value as "standard" | "ultra")}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm"
            >
              <option value="standard">Standard (±Rp25 rb)</option>
              <option value="ultra">Ultra (±Rp60 rb)</option>
            </select>
          </label>
          <button
            type="button" onClick={() => void mulai()} disabled={!pilih || sibuk}
            className="mt-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {sibuk ? "Mengantre…" : "Render"}
          </button>
        </div>
        {galat && <p className="mt-2 text-xs font-semibold text-red-700">{galat}</p>}
        {mesin === "ultra" && (
          <p className="mt-2 text-[11px] leading-4 text-zinc-500">
            Ultra (Seedance 2.5) menolak gambar berwajah, jadi gambar kuncinya dibuat tanpa wajah —
            gerak dan realismenya lebih baik, presenternya tidak pernah terlihat.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Render beta terakhir</h2>
        {jobs.length === 0 && <p className="text-xs text-zinc-500">Belum ada.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="rounded-xl border border-zinc-200 bg-white p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">{j.produk}</p>
                <p className="font-mono text-[11px] text-zinc-400">{j.id.slice(0, 8)} · {j.mesin} · {new Date(j.created_at).toLocaleString("id-ID")}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  j.state === "READY" ? "bg-emerald-50 text-emerald-700"
                  : j.state === "FAILED" ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-600"}`}>
                  {j.state}
                </span>
                {j.video && (
                  <a href={j.video} target="_blank" rel="noreferrer"
                     className="rounded border border-zinc-300 px-2 py-1 text-[10px] font-semibold text-zinc-700">▶ Lihat</a>
                )}
              </div>
            </div>
            {j.qc && (
              <p className="mt-2 text-[11px] text-zinc-600">
                Gerbang: {j.qc.passed ? <b className="text-emerald-700">semua lulus</b> : <span className="text-amber-700">gagal di {j.qc.gagal.join(", ")}</span>}
                {j.qc.biaya_idr !== null && <> · biaya {rupiah(j.qc.biaya_idr)}</>}
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
