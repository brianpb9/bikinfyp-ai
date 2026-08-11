"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, CalendarDays, Check, Download, Info, Loader2, Plus, Trash2,
} from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";
import { campaignFormatLabel } from "../../_components/campaign-kind";

interface Plan {
  id: string; job_id: string; channel: string; scheduled_at: string;
  caption: string | null; status: string; posted_at: string | null;
  product_name: string; download_url: string | null;
}
interface ReadyVideo {
  job_id: string; product_name: string;
  format: string; duration_s: number; caption: string | null;
}
interface PublishResponse { plans: Plan[]; ready: ReadyVideo[] }

/** Label pilihan video yang benar-benar membedakan satu video dari lainnya. */
function readyLabel(v: ReadyVideo): string {
  const parts = [v.product_name, campaignFormatLabel(v.format), `${v.duration_s} dtk`].filter(Boolean);
  const head = parts.join(" · ");
  const cap = (v.caption ?? "").trim();
  return cap ? `${head} — ${cap.slice(0, 45)}${cap.length > 45 ? "…" : ""}` : head;
}

const CHANNELS = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "shopee", label: "Shopee Video" },
  { id: "youtube", label: "YouTube Shorts" },
  { id: "lainnya", label: "Lainnya" },
] as const;

// Rencana posting.
//
// Halaman ini SENGAJA tidak memasang tombol "Publish sekarang". Posting
// otomatis butuh Content Posting API TikTok/Instagram — OAuth per akun plus
// peninjauan aplikasi oleh platform — dan belum satu pun kami punya. Tombol
// yang tampak mem-posting tapi sebenarnya tidak adalah kebohongan yang baru
// ketahuan brand saat kontennya tidak pernah tayang.
//
// Yang dilakukan sekarang: menyusun jadwal, menyiapkan caption, mengunduh
// berkasnya, lalu menandai sudah diposting. Brand memang mengunggah manual
// hari ini — ini mempercepat pekerjaan itu, bukan berpura-pura menggantikannya.
export default function PublishPage() {
  const [data, setData] = useState<PublishResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [jobId, setJobId] = useState("");
  const [channel, setChannel] = useState<string>("tiktok");
  const [when, setWhen] = useState("");
  const [caption, setCaption] = useState("");

  // Memilih video sekaligus mengisi captionnya. Caption itu HASIL yang sudah
  // kita buat dan tersimpan; menyuruh brand membuka library, menyalin, lalu
  // menempelkannya ke sini adalah pekerjaan yang kita ciptakan sendiri.
  // Caption yang sudah diketik sendiri tidak ditimpa.
  function pickVideo(nextJobId: string) {
    setJobId(nextJobId);
    const picked = data?.ready.find((v) => v.job_id === nextJobId);
    const auto = picked?.caption?.trim() ?? "";
    const untouched = caption.trim() === "" ||
      data?.ready.some((v) => (v.caption ?? "").trim() === caption.trim());
    if (auto && untouched) setCaption(auto);
  }

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<PublishResponse>("/api/dashboard/publish"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal memuat rencana posting.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy("create"); setError(null);
    try {
      await apiFetch("/api/dashboard/publish", {
        json: { job_id: jobId, channel, scheduled_at: new Date(when).toISOString(), caption },
      });
      setOpen(false); setJobId(""); setWhen(""); setCaption("");
      await load();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menjadwalkan.");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      await apiFetch("/api/dashboard/publish", { method: "PATCH", json: { id, status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal memperbarui.");
    } finally { setBusy(null); }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await apiFetch("/api/dashboard/publish", { method: "DELETE", json: { id } });
      await load();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menghapus.");
    } finally { setBusy(null); }
  }

  const planned = data?.plans.filter((p) => p.status === "planned") ?? [];
  const done = data?.plans.filter((p) => p.status !== "planned") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Organisasi</p>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Rencana posting</h1>
          <p className="mt-1 text-sm text-zinc-500">Susun jadwal, siapkan caption, unduh, lalu tandai kalau sudah tayang.</p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          disabled={(data?.ready.length ?? 0) === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} /> Jadwalkan video
        </button>
      </div>

      {/* Batas kemampuan dinyatakan di muka, bukan disembunyikan di FAQ. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          Unggahan otomatis ke TikTok dan Instagram belum aktif — kami masih menunggu izin
          Content Posting API dari platform. Sementara ini videonya kamu unggah sendiri, dan
          halaman ini yang mengurus jadwal, caption, dan berkasnya.
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
        </div>
      )}

      {open && (
        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Video</label>
              <select
                value={jobId} onChange={(e) => pickVideo(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              >
                <option value="">Pilih video siap...</option>
                {/* Label harus MEMBEDAKAN. Isi normalnya adalah beberapa
                    variasi dari satu produk, jadi nama produk saja membuat
                    setiap baris tertulis sama persis dan brand menebak-nebak
                    mana yang dijadwalkan. Format, durasi, dan potongan caption
                    yang membedakannya. */}
                {data?.ready.map((v) => (
                  <option key={v.job_id} value={v.job_id}>{readyLabel(v)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Kanal</label>
              <select
                value={channel} onChange={(e) => setChannel(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              >
                {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Tanggal & jam</label>
              <input
                type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Caption (opsional)</label>
              <input
                value={caption} onChange={(e) => setCaption(e.target.value)}
                placeholder="Terisi otomatis dari videonya"
                className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-amber-400"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              Batal
            </button>
            <button
              onClick={create}
              disabled={!jobId || !when || busy === "create"}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
            >
              {busy === "create" ? <Loader2 size={15} className="animate-spin" /> : <CalendarDays size={15} />}
              Simpan jadwal
            </button>
          </div>
        </div>
      )}

      {!data ? (
        <div className="h-32 animate-pulse rounded-2xl bg-zinc-100" />
      ) : data.plans.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <CalendarDays size={24} className="text-zinc-300" />
          <p className="text-sm text-zinc-500">
            {data.ready.length === 0 ? "Belum ada video siap untuk dijadwalkan." : "Belum ada jadwal posting."}
          </p>
          <Link href={data.ready.length === 0 ? "/dashboard/templates" : "/dashboard/library"} className="text-sm font-semibold text-amber-600 hover:text-amber-700">
            {data.ready.length === 0 ? "Bikin video dulu" : "Lihat library"}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {[["Terjadwal", planned], ["Riwayat", done]].map(([title, list]) => {
            const rows = list as Plan[];
            if (rows.length === 0) return null;
            return (
              <section key={title as string} className="space-y-3">
                <h2 className="text-sm font-bold text-zinc-900">{title as string} {rows.length}</h2>
                <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  {rows.map((p, i) => (
                    <li key={p.id} className={`flex flex-wrap items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-zinc-100" : ""}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-zinc-900">{p.product_name}</span>
                        <span className="mt-0.5 block text-xs text-zinc-500">
                          {CHANNELS.find((c) => c.id === p.channel)?.label ?? p.channel}
                          <span className="mx-1.5 text-zinc-300">·</span>
                          {new Date(p.scheduled_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {p.caption && <span className="mt-1 block truncate text-xs text-zinc-400">{p.caption}</span>}
                      </span>

                      {p.status === "posted" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                          <Check size={10} /> Sudah tayang
                        </span>
                      )}
                      {p.status === "skipped" && (
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold text-zinc-500">Dilewati</span>
                      )}

                      <span className="flex shrink-0 items-center gap-2">
                        {p.download_url && (
                          <a
                            href={p.download_url} download
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
                          >
                            <Download size={13} /> Unduh
                          </a>
                        )}
                        {p.status === "planned" && (
                          <button
                            onClick={() => setStatus(p.id, "posted")}
                            disabled={busy === p.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                          >
                            {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            Sudah diposting
                          </button>
                        )}
                        <button
                          onClick={() => remove(p.id)}
                          disabled={busy === p.id}
                          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          title="Hapus dari rencana"
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
