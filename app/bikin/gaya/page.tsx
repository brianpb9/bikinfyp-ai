"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, SecondaryButton } from "../../_components/ui";
import { loadFlow, saveFlow, rupiah, type FlowScript, type VideoFormat } from "../../_components/flow";
import { track } from "../../_components/track";
import templateTerbukti from "../../../lib/config/template-terbukti.json";

// Preset-first (2026-08-06, riset teardown kompetitor): user memilih HASIL yang
// kelihatan, bukan label abstrak — kartu format menampilkan contoh render nyata
// (video loop / still), fallback ikon untuk format yang belum punya sample.
const FORMATS: {
  id: VideoFormat; label: string; icon: string; hint: string; needsAudio: boolean;
  previewVideo?: string; previewImage?: string;
}[] = [
  { id: "hands_only", label: "Tangan saja", icon: "/icons/ui/format-tangan.png", hint: "tanpa wajah", needsAudio: false, previewVideo: "/previews/format-tangan.mp4" },
  { id: "talking_head", label: "Wajah AI", icon: "/icons/ui/format-wajah.png", hint: "presenter AI, versi 1", needsAudio: true, previewVideo: "/previews/format-wajah.mp4" },
  { id: "vo_broll", label: "VO + Foto", icon: "/icons/ui/format-foto.png", hint: "foto asli + suara, versi 1", needsAudio: true },
];

const REGISTERS = [
  { id: "bunda", label: "Bunda", hint: "sapaan: bun — hangat, pelan" },
  { id: "bestie", label: "Bestie", hint: "sapaan: say — energik, gemas" },
  { id: "genz", label: "Gen-Z", hint: "sapaan: cuy — gue/lo, blak-blakan" },
  { id: "netral", label: "Netral", hint: "sapaan: kak — ramah, aman" },
];

type Tier = "silent_caption" | "high_quality" | "super_hq";
type HookLevel = "normal" | "berani" | "gila";

// Level hook sebagai SLIDER 0-100% (permintaan Brian 2026-08-06, gaya
// "Weirdness"-slider) — di belakang layar tetap dipetakan ke 3 level mesin.
// Copy JUJUR: data kami mendukung hook pertanyaan/payoff cepat; ujung "Gila"
// adalah eksperimen (pembuka visual nyeleneh), BUKAN janji lebih FYP.
function hookLevelFromPct(pct: number): HookLevel {
  return pct <= 33 ? "normal" : pct <= 66 ? "berani" : "gila";
}
const HOOK_LEVEL_INFO: Record<HookLevel, { icon: string; label: string; hint: string }> = {
  normal: { icon: "✅", label: "Normal", hint: "pola paling terbukti di data" },
  berani: { icon: "🔥", label: "Berani", hint: "hook lebih nendang" },
  gila: { icon: "🤪", label: "Gila", hint: "pembuka nyeleneh · eksperimen" },
};

// 5 kategori aktif (lolos uji 7–9/10) — Ibu-ibu & Daerah TETAP "Segera" (5–6/10).
const CREATOR_CATS = [
  { id: "hijaber", label: "🧕 Hijaber", note: "paling laris di TikTok Shop", active: true },
  { id: "lokal", label: "👩 Lokal/Pribumi", note: "cocok semua produk", active: true },
  { id: "chindo", label: "👩🏻 Chindo", note: "skincare premium", active: true },
  { id: "genz", label: "🧑‍🎤 Gen-Z", note: "gadget, fashion, F&B", active: true },
  { id: "pria", label: "👨 Pria", note: "gadget, F&B, produk pria", active: true },
  { id: "ibu", label: "👩‍🦱 Ibu-ibu", note: "rumah tangga, dapur, anak", active: true },
  { id: "daerah", label: "🌾 Daerah", note: "", active: false },
];
interface TierMeta {
  id: string;
  name: string;
  note: string;
  tag: string | null;
  price_idr: number;
}

// S3 — PILIH GAYA (Langkah 2/5) — tier harga AKTIF (keputusan final 3-tier)
export default function GayaPage() {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>("silent_caption");
  const [tiers, setTiers] = useState<TierMeta[]>([]);
  const [format, setFormat] = useState<VideoFormat>("hands_only");
  const [durationSec, setDurationSec] = useState<15 | 30 | 45>(15);
  const [hookPct, setHookPct] = useState(15);
  const hookLevel = hookLevelFromPct(hookPct);
  // Template Terbukti: preset dari pola video pemenang GMV (korelasional).
  const [templateId, setTemplateId] = useState<string | null>(null);

  function applyTemplate(id: string) {
    if (templateId === id) {
      setTemplateId(null); // tap ulang = lepas template
      return;
    }
    const t = templateTerbukti.templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setFormat(t.preset.format as VideoFormat);
    setTier(t.preset.qualityTier as Tier);
    setDurationSec(t.preset.durationSec as 15 | 30 | 45);
  }
  const [register, setRegister] = useState("bestie");
  const [creatorCategory, setCreatorCategory] = useState("hijaber");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);

  useEffect(() => {
    if (!loadFlow().product) router.replace("/bikin/produk");
    apiFetch<{ tiers: TierMeta[] }>("/api/meta").then((m) => setTiers(m.tiers)).catch(() => {});
    track("gaya_view");
  }, [router]);

  const selectedTier = tiers.find((t) => t.id === tier);
  const selectedCategory = CREATOR_CATS.find((c) => c.id === creatorCategory);

  function selectFormat(id: VideoFormat) {
    setFormat(id);
    // Wajah AI & VO+Foto namanya sendiri menjanjikan suara — tier senyap
    // ditolak API (lihat app/api/jobs/route.ts), jadi naikkan otomatis di sini
    // biar user tidak kena error yang membingungkan.
    const needsAudio = FORMATS.find((f) => f.id === id)?.needsAudio;
    if (needsAudio && tier === "silent_caption") setTier("high_quality");
  }

  async function generate() {
    const product = loadFlow().product;
    if (!product) return router.replace("/bikin/produk");
    setLoading(true);
    setError(null);
    setNoCredits(false);
    try {
      const res = await apiFetch<{ scripts: FlowScript[] }>("/api/scripts/generate", {
        json: {
          product_id: product.productId,
          register: tier === "silent_caption" ? "netral" : register,
          emotion: "senang",
          format,
          quality_tier: tier,
          duration_s: durationSec,
          hook_level: hookLevel,
          ...(templateId
            ? { hook_families: templateTerbukti.templates.find((t) => t.id === templateId)?.preset.hookFamilies }
            : {}),
        },
      });
      saveFlow({ register, qualityTier: tier, format, durationSec, hookLevel, creatorCategory, scripts: res.scripts, selectedScriptId: undefined });
      router.push("/bikin/skrip");
    } catch (err) {
      if (err instanceof ApiFail && err.code === "INSUFFICIENT_CREDITS") {
        setNoCredits(true);
        saveFlow({ returnTo: "/bikin/gaya" });
      }
      setError(err instanceof Error ? err.message : "Gagal bikin skrip. Coba lagi ya.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-10">
      <FlowHeader title="Gaya Video" step={2} />
      <div className="space-y-7 px-4">
        <section className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pola dari {templateTerbukti.total_winners} video pemenang</p>
            <h2 className="font-display text-xl font-bold">🏆 Template Terbukti</h2>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {templateTerbukti.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={templateId === t.id}
                onClick={() => applyTemplate(t.id)}
                className={`w-44 shrink-0 rounded-2xl border-2 p-3 text-left shadow-sm transition-transform active:scale-[0.98] ${
                  templateId === t.id ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                }`}
              >
                <p className="text-sm font-bold leading-tight">{t.name}</p>
                <p className="mt-1 text-[11px] leading-4 text-zinc-500">{t.desc}</p>
                <p className="mt-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  {t.count} dari {templateTerbukti.total_winners} video pemenang
                </p>
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-4 text-zinc-400">
            {templateTerbukti.disclaimer} Pilih template = format, durasi & gaya hook ikut diatur otomatis (masih bisa kamu ubah).
          </p>
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Langkah pengaturan</p><h2 className="font-display text-xl font-bold">Format video</h2></div>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={format === f.id}
                onClick={() => selectFormat(f.id)}
                className={`overflow-hidden rounded-2xl border-2 text-center shadow-sm transition-transform active:scale-[0.98] ${
                  format === f.id ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                }`}
              >
                {f.previewVideo ? (
                  <video src={f.previewVideo} autoPlay muted loop playsInline className="aspect-[9/16] w-full object-cover" />
                ) : f.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.previewImage} alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center bg-zinc-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.icon} alt="" className="h-10 w-10" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-sm font-bold">{f.label}</p>
                  <p className="text-xs text-zinc-500">{f.hint}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Seberapa berani</p><h2 className="font-display text-xl font-bold">Level hook</h2></div>
          <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-zinc-800">
                <span aria-hidden="true">{HOOK_LEVEL_INFO[hookLevel].icon}</span> {HOOK_LEVEL_INFO[hookLevel].label}
                <span className="ml-1 font-normal text-zinc-500">· {HOOK_LEVEL_INFO[hookLevel].hint}</span>
              </p>
              <p className="font-display text-sm font-bold text-amber-600">{hookPct}%</p>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={hookPct}
              onChange={(e) => setHookPct(Number(e.target.value))}
              aria-label="Level hook: 0 aman sampai 100 gila"
              className="mt-3 h-2 w-full cursor-pointer accent-amber-500"
            />
            <div className="mt-1 flex justify-between text-[10px] font-semibold text-zinc-400">
              <span>Aman & terbukti</span>
              <span>Berani</span>
              <span>Gila 🤪</span>
            </div>
          </div>
          {hookLevel === "gila" && (
            <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Level Gila = pembuka visual super energik. Ini eksperimen — di data kami hook pertanyaan
              yang paling sering menang, jadi cek Skor FYP tiap versi sebelum pilih ya.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih paket</p><h2 className="font-display text-xl font-bold">Kualitas video</h2></div>
          {FORMATS.find((f) => f.id === format)?.needsAudio && (
            <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {FORMATS.find((f) => f.id === format)?.label} butuh suara — Teks + Musik disembunyikan.
            </p>
          )}
          {(tiers.length ? tiers : [{ id: "silent_caption", name: "Teks + Musik", note: "Teks gede + musik, tanpa suara ngomong", tag: "Paling hemat", price_idr: 5000 }])
            .filter((t) => !(FORMATS.find((f) => f.id === format)?.needsAudio && t.id === "silent_caption"))
            .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTier(t.id as Tier)}
              className={`relative w-full rounded-2xl border-2 p-4 text-left ${
                tier === t.id ? "border-amber-500 bg-amber-50 shadow-sm" : "border-zinc-200 bg-white shadow-sm"
              }`}
            >
              {t.tag && (
                <span className="absolute -top-3 right-4 rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold text-white">
                  {t.tag}
                </span>
              )}
              <span className="flex items-center justify-between">
                <span className="font-bold">{t.name}</span>
                <span className="font-bold text-amber-700">{rupiah(Math.round(t.price_idr * (durationSec / 15)))}/video</span>
              </span>
              <span className="text-sm text-zinc-500">{t.note}</span>
            </button>
          ))}
        </section>

        <details className="group rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-3 p-4 marker:content-none">
            <span>
              <span className="block text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Opsional</span>
              <span className="font-display text-lg font-bold">Sesuaikan gaya kreator</span>
              <span className="block text-sm text-zinc-500">{selectedCategory?.label ?? "Pilih kategori"}{tier === "silent_caption" ? " · tanpa suara" : ` · ${REGISTERS.find((r) => r.id === register)?.label ?? "suara"}`}</span>
            </span>
            <span aria-hidden="true" className="text-xl text-amber-700 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="space-y-6 border-t border-zinc-100 p-4 pt-5">
            <section className="space-y-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Sesuaikan audiens</p><h2 className="font-display text-xl font-bold">Kategori kreator</h2></div>
              <div className="grid grid-cols-2 gap-2">
            {CREATOR_CATS.filter((c) => c.active).map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={creatorCategory === c.id}
                onClick={() => setCreatorCategory(c.id)}
                className={`rounded-2xl border-2 p-3 text-left ${
                  creatorCategory === c.id ? "border-amber-500 bg-amber-50 shadow-sm" : "border-zinc-200 bg-white shadow-sm"
                }`}
              >
                <p className="font-bold">{c.label}</p>
                <p className="text-xs text-zinc-500">{c.note}</p>
              </button>
            ))}
            {CREATOR_CATS.filter((c) => !c.active).map((c) => (
              <button key={c.id} type="button" disabled className="rounded-2xl border-2 border-zinc-100 bg-zinc-50 p-3 text-left opacity-60">
                <p className="font-bold text-zinc-500">{c.label}</p>
                <p className="text-xs font-semibold text-amber-600">Segera</p>
              </button>
            ))}
              </div>
            </section>

            {tier === "silent_caption" ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                🔇 Teks + Musik memakai caption tersinkron dan musik latar; pilihan panggilan tidak dipakai.
              </div>
            ) : (
              <section className="space-y-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih karakter</p><h2 className="font-display text-xl font-bold">Suara & panggilan</h2></div>
                {REGISTERS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRegister(r.id)}
                className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 text-left ${
                  register === r.id ? "border-amber-500 bg-amber-50 shadow-sm" : "border-zinc-200 bg-white shadow-sm"
                }`}
              >
                <span className={`h-4 w-4 rounded-full border-2 ${register === r.id ? "border-amber-500 bg-amber-500" : "border-zinc-300"}`} />
                <span>
                  <span className="block font-bold">{r.label}</span>
                  <span className="block text-xs text-zinc-500">{r.hint}</span>
                </span>
              </button>
                ))}
              </section>
            )}

            <section className="space-y-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Panjang video</p><h2 className="font-display text-xl font-bold">Durasi</h2></div>
              <div className="flex gap-2">
                {([15, 30, 45] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={durationSec === d}
                    onClick={() => setDurationSec(d)}
                    className={`rounded-2xl border-2 px-5 py-3 font-bold shadow-sm ${
                      durationSec === d ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                    }`}
                  >
                    {d} dtk
                  </button>
                ))}
              </div>
              {durationSec > 15 && (
                <p className="text-xs text-zinc-500">
                  Video {durationSec} detik ~{Math.round(durationSec / 15)}x harga 15 detik (lebih banyak AI video-gen).
                </p>
              )}
            </section>
          </div>
        </details>

        <ErrorText message={error} />
        {noCredits && (
          <div className="space-y-2">
            <SecondaryButton href="/kredit?return_to=%2Fbikin%2Fgaya">Top-up dulu di sini →</SecondaryButton>
          </div>
        )}
        <PrimaryButton onClick={generate} disabled={loading}>
          {loading ? "Lagi nulis skrip..." : `Bikinkan Skripnya${selectedTier ? ` · ${rupiah(Math.round(selectedTier.price_idr * (durationSec / 15)))}` : ""}`}
        </PrimaryButton>
      </div>
    </main>
  );
}
