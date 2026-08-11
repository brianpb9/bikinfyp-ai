"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Film, LayoutTemplate, Sparkles, Trash2, User } from "lucide-react";
import { apiFetch } from "../../../_components/api";
import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from "@/lib/templates";

// Galeri template (permintaan Brian: "tinggal ganti productnya saja").
// Memilih template hanya mengisi awal wizard — brand tetap bisa mengubah
// apa pun sesudahnya. Itu disengaja: template adalah titik berangkat, bukan
// kunci. Semua nilainya kelihatan di langkah Konsep, jadi tidak ada yang
// terjadi diam-diam di belakang layar.

// Tiga jenis, sama persis dengan kartu di langkah Jenis. "UGC Ads" sempat
// hilang di sini karena filternya dibuat sebelum format ads ada — akibatnya
// galeri tidak pernah bisa disaring ke jenis yang ketiga.
const KINDS = [
  { id: "all", label: "Semua" },
  { id: "affiliate", label: "UGC Affiliate" },
  { id: "ads", label: "UGC Ads" },
  { id: "tvc", label: "TVC" },
] as const;

const ACCENT: Record<CampaignTemplate["accent"], string> = {
  amber: "from-amber-400 to-orange-500",
  rose: "from-rose-400 to-pink-600",
  emerald: "from-emerald-400 to-teal-600",
  violet: "from-violet-400 to-purple-600",
  sky: "from-sky-400 to-blue-600",
  zinc: "from-zinc-700 to-zinc-950",
};

const FORMAT_LABEL: Record<string, string> = {
  hands_only: "Tangan + VO", talking_head: "Wajah AI", tvc: "Sinematik",
};

interface OrgTemplate {
  id: string; name: string; note: string | null; kind: string; format: string;
  duration_sec: number; quality_tier: string; hook_level: string;
  hook_family: string | null; variant_count: number;
}

export default function TemplatesPage() {
  const [kind, setKind] = useState<string>("all");
  // Template buatan brand sendiri (masukan tester). Dipisah dari bawaan supaya
  // jelas mana keputusan kami dan mana milik mereka — brand harus bisa
  // menghapus miliknya tanpa takut merusak yang bawaan.
  const [mine, setMine] = useState<OrgTemplate[]>([]);
  const loadMine = useCallback(async () => {
    try {
      const res = await apiFetch<{ templates: OrgTemplate[] }>("/api/dashboard/templates");
      setMine(res.templates);
    } catch { /* galeri bawaan tetap berguna walau daftar milik brand gagal dimuat */ }
  }, []);
  useEffect(() => { void loadMine(); }, [loadMine]);

  async function removeMine(id: string) {
    await apiFetch("/api/dashboard/templates", { method: "DELETE", json: { id } }).catch(() => undefined);
    await loadMine();
  }

  const visible = useMemo(
    () => (kind === "all" ? CAMPAIGN_TEMPLATES : CAMPAIGN_TEMPLATES.filter((t) => t.kind === kind)),
    [kind]
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Organisasi</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Templates</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Konsep yang sudah kami susun — format, durasi, sudut hook, dan jumlah variasinya
          sudah diatur. Kamu tinggal masukkan produknya.
        </p>
      </div>

      {mine.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
            <User size={14} className="text-zinc-400" /> Template kamu
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-amber-400">
                <Link href={`/dashboard/campaign?orgtpl=${t.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-zinc-900">{t.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                    {t.duration_sec} dtk · {FORMAT_LABEL[t.format] ?? t.format} · {t.variant_count} variasi
                  </span>
                  {t.note && <span className="mt-0.5 block truncate text-xs text-zinc-400">{t.note}</span>}
                </Link>
                <button
                  onClick={() => removeMine(t.id)}
                  className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  title="Hapus template"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              kind === k.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map((t) => (
          <li key={t.id}>
            <Link
              href={`/dashboard/campaign?template=${t.id}`}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md"
            >
              {/* Bingkai 9:16, MENGIKUTI videonya. Sebelumnya 16:10 dengan
                  object-cover, jadi klip potret terpotong habis dan yang
                  terlihat cuma pita tengahnya — persis keluhan Brian
                  2026-08-11. Sekarang seluruh frame kelihatan tanpa crop.

                  overflow-hidden + absolute inset-0 tetap wajib: media dengan
                  ukuran alami sendiri akan memaksa kotak aspect-ratio molor
                  kalau dibiarkan memakai h-full saja. */}
              <div className="relative aspect-[9/16] w-full overflow-hidden bg-zinc-900">
                {t.preview ? (
                  <video
                    src={t.preview}
                    autoPlay muted loop playsInline
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${ACCENT[t.accent]}`}>
                    <Film size={28} className="text-white/70" />
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
                  {t.durationSec} dtk · {FORMAT_LABEL[t.format] ?? t.format}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <p className="font-display text-base font-bold text-zinc-900">{t.name}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{t.when}</p>
                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold text-zinc-600">
                    {t.count} variasi
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 transition-colors group-hover:text-amber-700">
                    Pakai template <ArrowRight size={13} />
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white p-5">
        <LayoutTemplate size={18} className="mt-0.5 shrink-0 text-zinc-400" />
        <div>
          <p className="text-sm font-semibold text-zinc-800">Mau konsep yang benar-benar bebas?</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Mulai dari kosong dan atur sendiri format, durasi, avatar, dan level hook-nya.
          </p>
          <Link href="/dashboard/campaign" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:text-amber-700">
            <Sparkles size={13} /> Bikin dari nol
          </Link>
        </div>
      </div>
    </div>
  );
}
