"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImageIcon, Loader2, Upload } from "lucide-react";
import { apiFetch, ApiFail } from "../../_components/api";

interface Kit { logo_url: string | null; color: string | null; tagline: string | null }

const DEFAULT_COLOR = "#0F0F10";

// Brand kit — logo, warna, tagline yang dipakai membuat endcard di akhir tiap
// video. Ditaruh di Profil bersama setelan brand lain: diisi sekali, jarang
// disentuh lagi.
export function BrandKitCard() {
  const [kit, setKit] = useState<Kit | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [tagline, setTagline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<Kit>("/api/dashboard/brand-kit");
      setKit(res);
      setColor(res.color ?? DEFAULT_COLOR);
      setTagline(res.tagline ?? "");
    } catch { /* biarkan kosong; brand bisa mengisi dari nol */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const fd = new FormData();
      fd.set("color", color);
      fd.set("tagline", tagline);
      const f = fileRef.current?.files?.[0];
      if (f) fd.set("logo", f);
      await apiFetch("/api/dashboard/brand-kit", { formData: fd });
      if (fileRef.current) fileRef.current.value = "";
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menyimpan brand kit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-sm font-bold text-zinc-900">Brand kit</p>
        <p className="mt-0.5 text-xs leading-5 text-zinc-500">
          Dipakai membuat layar penutup di akhir tiap video. Tanpa ini, videonya keluar tanpa endcard.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="flex flex-wrap items-start gap-5">
        {/* Pratinjau endcard: yang dilihat brand persis susunan yang dirender —
            logo di tengah, tagline di bawahnya, di atas warna brand. */}
        <div
          className="flex h-40 w-24 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-zinc-200"
          style={{ backgroundColor: color }}
        >
          {kit?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kit.logo_url} alt="Logo" className="max-h-14 max-w-[70%] object-contain" />
          ) : (
            <ImageIcon size={20} className="text-white/40" />
          )}
          {tagline && <span className="px-2 text-center text-[9px] font-bold text-white">{tagline}</span>}
        </div>

        <div className="min-w-56 flex-1 space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Logo</label>
            <button
              onClick={() => fileRef.current?.click()}
              className="mt-1.5 flex w-full items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-sm text-zinc-600 transition-colors hover:border-amber-400"
            >
              <Upload size={15} /> {kit?.logo_url ? "Ganti logo" : "Unggah logo"}
              <span className="ml-auto text-xs text-zinc-400">PNG/JPG/WebP, maks 2 MB</span>
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={() => setSaved(false)} />
          </div>

          <div className="flex gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Warna</label>
              <input
                type="color" value={color} onChange={(e) => { setColor(e.target.value); setSaved(false); }}
                className="mt-1.5 h-10 w-16 cursor-pointer rounded-lg border border-zinc-300 bg-white p-1"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Tagline</label>
              <input
                value={tagline} onChange={(e) => { setTagline(e.target.value); setSaved(false); }}
                maxLength={60} placeholder="Satu baris singkat"
                className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-amber-400"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : null}
          Simpan brand kit
        </button>
        {saved && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check size={13} /> Tersimpan</span>}
      </div>
    </div>
  );
}
