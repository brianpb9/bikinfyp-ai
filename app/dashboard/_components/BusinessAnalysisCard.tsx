"use client";

import { useState } from "react";
import { AlertCircle, Building2, Globe, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { apiFetch, ApiFail } from "../../_components/api";

export interface BrandProfile {
  website_url: string | null;
  business_type: string | null;
  category: string | null;
  audience: string | null;
  elevator_pitch: string | null;
}

// Kartu "Analisa Bisnis" (M7, F-ENT-01) — paste website brand, Gemini baca
// & bikin profil singkat, disimpan di organizations. Bukan syarat wajib
// buat pakai dashboard (bulk-generate tetap jalan tanpa ini) — murni biar
// brand ngerasa "AI ini beneran ngerti bisnis saya" di langkah pertama,
// sesuai arahan Brian 2026-08-11.
export function BusinessAnalysisCard({ initial }: { initial: BrandProfile }) {
  const [profile, setProfile] = useState<BrandProfile>(initial);
  const [url, setUrl] = useState(initial.website_url ?? "");
  const [editing, setEditing] = useState(!initial.business_type);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!url.trim()) { setError("Masukkan link website dulu."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ website_url: string; business_name: string; business_type: string; category: string; audience: string; elevator_pitch: string }>(
        "/api/dashboard/business-analysis",
        { json: { url: url.trim() } }
      );
      setProfile({ website_url: res.website_url, business_type: res.business_type, category: res.category, audience: res.audience, elevator_pitch: res.elevator_pitch });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Analisa gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  if (!editing && profile.business_type) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Building2 size={13} /> Profil Bisnis
          </p>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700"
          >
            <RotateCcw size={12} /> Analisa ulang
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-zinc-400">Jenis usaha</p>
            <p className="font-medium text-zinc-900">{profile.business_type}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-400">Kategori</p>
            <p className="font-medium text-zinc-900">{profile.category}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-400">Audiens</p>
            <p className="font-medium text-zinc-900">{profile.audience}</p>
          </div>
          {profile.website_url && (
            <div>
              <p className="text-xs text-zinc-400">Website</p>
              <p className="truncate font-medium text-zinc-900">{profile.website_url}</p>
            </div>
          )}
        </div>
        {profile.elevator_pitch && <p className="mt-3 text-sm text-zinc-600">{profile.elevator_pitch}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
        <Building2 size={13} /> Analisa Bisnis
      </p>
      <p className="mt-1 text-sm text-zinc-500">Masukkan website bisnismu — AI baca dan bikin profil singkat otomatis.</p>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Globe size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="namabisnis.com"
            className="w-full rounded-lg border border-zinc-300 py-2 pl-9 pr-3 text-sm text-zinc-900 transition-colors focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? "Menganalisa..." : "Analisa"}
        </button>
      </div>
    </section>
  );
}
