"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, SecondaryButton } from "../../_components/ui";
import { loadFlow, saveFlow, rupiah, type FlowScript, type VideoFormat } from "../../_components/flow";

const FORMATS: { id: VideoFormat; label: string; icon: string; hint: string; needsAudio: boolean }[] = [
  { id: "hands_only", label: "Tangan saja", icon: "/icons/ui/format-tangan.png", hint: "tanpa wajah", needsAudio: false },
  { id: "talking_head", label: "Wajah AI", icon: "/icons/ui/format-wajah.png", hint: "presenter AI, versi 1", needsAudio: true },
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

// Level hook — copy JUJUR: data kami mendukung hook pertanyaan/payoff cepat;
// "Gila" adalah eksperimen (pembuka visual nyeleneh), BUKAN janji lebih FYP.
const HOOK_LEVELS: { id: HookLevel; label: string; icon: string; hint: string }[] = [
  { id: "normal", label: "Normal", icon: "✅", hint: "pola paling terbukti di data" },
  { id: "berani", label: "Berani", icon: "🔥", hint: "hook lebih nendang" },
  { id: "gila", label: "Gila", icon: "🤪", hint: "pembuka nyeleneh · eksperimen" },
];

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
  const [hookLevel, setHookLevel] = useState<HookLevel>("normal");
  const [register, setRegister] = useState("bestie");
  const [creatorCategory, setCreatorCategory] = useState("hijaber");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);

  useEffect(() => {
    if (!loadFlow().product) router.replace("/bikin/produk");
    apiFetch<{ tiers: TierMeta[] }>("/api/meta").then((m) => setTiers(m.tiers)).catch(() => {});
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
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Langkah pengaturan</p><h2 className="font-display text-xl font-bold">Format video</h2></div>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={format === f.id}
                onClick={() => selectFormat(f.id)}
                className={`rounded-2xl border-2 p-3 text-center shadow-sm transition-transform active:scale-[0.98] ${
                  format === f.id ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.icon} alt="" className="mx-auto h-8 w-8" />
                <p className="text-sm font-bold">{f.label}</p>
                <p className="text-xs text-zinc-500">{f.hint}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Seberapa berani</p><h2 className="font-display text-xl font-bold">Level hook</h2></div>
          <div className="grid grid-cols-3 gap-2">
            {HOOK_LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={hookLevel === l.id}
                onClick={() => setHookLevel(l.id)}
                className={`rounded-2xl border-2 p-3 text-center shadow-sm transition-transform active:scale-[0.98] ${
                  hookLevel === l.id ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                }`}
              >
                <p className="text-2xl" aria-hidden="true">{l.icon}</p>
                <p className="text-sm font-bold">{l.label}</p>
                <p className="text-xs text-zinc-500">{l.hint}</p>
              </button>
            ))}
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
              {FORMATS.find((f) => f.id === format)?.label} butuh suara — Senyap + Teks disembunyikan.
            </p>
          )}
          {(tiers.length ? tiers : [{ id: "silent_caption", name: "Senyap + Teks", note: "Video bisu + caption + musik", tag: "Paling hemat", price_idr: 5000 }])
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
                🔇 Senyap + Teks memakai caption tersinkron dan musik latar; pilihan panggilan tidak dipakai.
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
