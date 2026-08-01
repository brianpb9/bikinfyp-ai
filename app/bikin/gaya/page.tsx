"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, SecondaryButton } from "../../_components/ui";
import { loadFlow, saveFlow, rupiah, type FlowScript } from "../../_components/flow";

const REGISTERS = [
  { id: "bunda", label: "Bunda", hint: "sapaan: bun — hangat, pelan" },
  { id: "bestie", label: "Bestie", hint: "sapaan: say — energik, gemas" },
  { id: "genz", label: "Gen-Z", hint: "sapaan: cuy — gue/lo, blak-blakan" },
  { id: "netral", label: "Netral", hint: "sapaan: kak — ramah, aman" },
];

type Tier = "silent_caption" | "high_quality" | "super_hq";

// 5 kategori aktif (lolos uji 7–9/10) — Ibu-ibu & Daerah TETAP "Segera" (5–6/10).
const CREATOR_CATS = [
  { id: "hijaber", label: "🧕 Hijaber", note: "paling laris di TikTok Shop", active: true },
  { id: "lokal", label: "👩 Lokal/Pribumi", note: "cocok semua produk", active: true },
  { id: "chindo", label: "👩🏻 Chindo", note: "skincare premium", active: true },
  { id: "genz", label: "🧑‍🎤 Gen-Z", note: "gadget, fashion, F&B", active: true },
  { id: "pria", label: "👨 Pria", note: "gadget, F&B, produk pria", active: true },
  { id: "ibu", label: "👩‍🦱 Ibu-ibu", note: "", active: false },
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
          format: "hands_only",
          quality_tier: tier,
        },
      });
      saveFlow({ register, qualityTier: tier, creatorCategory, scripts: res.scripts, selectedScriptId: undefined });
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
            <button type="button" aria-pressed="true" className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-3 text-center shadow-sm transition-transform active:scale-[0.98]">
              <div className="text-2xl">✋</div>
              <p className="text-sm font-bold">Tangan saja</p>
              <p className="text-xs text-zinc-500">tanpa wajah</p>
            </button>
            {["VO + foto", "Wajah AI"].map((f) => (
              <button key={f} type="button" disabled className="rounded-2xl border-2 border-zinc-100 bg-zinc-50 p-3 text-center opacity-60">
                <div className="text-2xl">{f === "Wajah AI" ? "🙂" : "🖼️"}</div>
                <p className="text-sm font-bold text-zinc-500">{f}</p>
                <p className="text-xs font-semibold text-amber-600">Segera</p>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih paket</p><h2 className="font-display text-xl font-bold">Kualitas video</h2></div>
          {(tiers.length ? tiers : [{ id: "silent_caption", name: "Senyap + Teks", note: "Video bisu + caption + musik", tag: "Paling hemat", price_idr: 5000 }]).map((t) => (
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
                <span className="font-bold text-amber-700">{rupiah(t.price_idr)}/video</span>
              </span>
              <span className="text-sm text-zinc-500">{t.note}</span>
            </button>
          ))}
        </section>

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
          <div className="rounded-2xl border border-zinc-100 bg-white p-4 text-sm leading-6 text-zinc-600 shadow-sm">
            🔇 Tier Senyap + Teks tidak ada suara — skrip tampil sebagai caption tersinkron dengan
            musik latar. Pilihan register suara tidak dipakai.
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
            <div className="rounded-2xl border-2 border-amber-500 bg-amber-50 px-5 py-3 font-bold shadow-sm">15 dtk</div>
            {[30, 45].map((d) => (
              <div key={d} className="rounded-2xl border-2 border-zinc-100 bg-zinc-50 px-5 py-3 font-bold text-zinc-400">
                {d} <span className="text-xs font-semibold text-amber-600">Segera</span>
              </div>
            ))}
          </div>
        </section>

        <ErrorText message={error} />
        {noCredits && (
          <div className="space-y-2">
            <SecondaryButton href="/kredit?return_to=%2Fbikin%2Fgaya">Top-up dulu di sini →</SecondaryButton>
          </div>
        )}
        <PrimaryButton onClick={generate} disabled={loading}>
          {loading ? "Lagi nulis skrip..." : `Bikinkan Skripnya${selectedTier ? ` · ${rupiah(selectedTier.price_idr)}` : ""}`}
        </PrimaryButton>
      </div>
    </main>
  );
}
