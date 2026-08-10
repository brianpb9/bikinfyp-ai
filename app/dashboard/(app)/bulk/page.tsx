"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ImageOff, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";
import { rupiah } from "../../_components/format";
import { AVATAR_PRESETS, type AvatarGender } from "@/lib/avatar-presets";

type Format = "talking_head" | "hands_only";
type Tier = "high_quality" | "super_hq";

type ReadyItem = {
  status: "ready"; url: string; product_id: string; script_id: string; product_name: string;
  price_idr: number; category: string; image_url: string | null; caption: string; hook_family: string;
};
type FailedItem = { status: "failed"; url: string; reason: string };
type BulkItem = ReadyItem | FailedItem;

const TIER_BASE_PRICE_IDR: Record<Tier, number> = { high_quality: 12_000, super_hq: 26_667 };
function estimatePriceIdr(tier: Tier, durationSec: number): number {
  return Math.round(TIER_BASE_PRICE_IDR[tier] * (durationSec / 15));
}

// Halaman submit bulk-generate (M4, F-ENT-01, polish M5, toggle M6) — dua
// fase sesuai gerbang HITL di API: (1) generate & review, (2) satu klik
// "Setujui Semua" yang benar-benar meng-approve tiap skrip (bukan
// formalitas UI). Pengaturan (format/durasi/tier/avatar) berlaku untuk
// SATU batch penuh — bukan per-produk (M6: sebelumnya hardcode
// hands_only/high_quality/15dtk, sekarang toggle beneran).
export default function BulkGeneratePage() {
  const router = useRouter();
  const [urlsText, setUrlsText] = useState("");
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkRunId, setBulkRunId] = useState<string | null>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [format, setFormat] = useState<Format>("hands_only");
  const [tier, setTier] = useState<Tier>("high_quality");
  const [durationSec, setDurationSec] = useState<15 | 30 | 45>(15);
  const [avatarGender, setAvatarGender] = useState<AvatarGender>("female");
  const [creatorCategory, setCreatorCategory] = useState("hijaber");

  function selectFormat(next: Format) {
    setFormat(next);
    if (next === "talking_head") setDurationSec(15); // aturan retail: Wajah AI cuma 15dtk
  }

  const avatarsForGender = AVATAR_PRESETS.filter((a) => a.gender === avatarGender);

  async function handleGenerate() {
    const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) { setError("Masukkan minimal 1 link produk."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ bulk_run_id: string; items: BulkItem[] }>("/api/dashboard/bulk", {
        json: { urls, tier, duration_sec: durationSec },
      });
      setBulkRunId(res.bulk_run_id);
      setItems(res.items);
      setPhase("review");
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal generate. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!bulkRunId) return;
    const ready = items.filter((i): i is ReadyItem => i.status === "ready" && !excluded.has(i.script_id));
    if (ready.length === 0) { setError("Tidak ada item yang dipilih."); return; }
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/dashboard/bulk/confirm", {
        json: {
          bulk_run_id: bulkRunId, format, creator_category: creatorCategory,
          items: ready.map((i) => ({ product_id: i.product_id, script_id: i.script_id })),
        },
      });
      router.push(`/dashboard/bulk/${bulkRunId}`);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal mulai render. Coba lagi.");
      setLoading(false);
    }
  }

  const readyItems = items.filter((i): i is ReadyItem => i.status === "ready");
  const failedItems = items.filter((i): i is FailedItem => i.status === "failed");
  const selectedCount = readyItems.filter((i) => !excluded.has(i.script_id)).length;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Bulk Generate</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Bikin banyak video sekaligus</h1>
        <p className="mt-1 text-sm text-zinc-500">Tempel link produk (satu per baris), AI bikin skrip untuk semua, kamu tinjau &amp; setujui sekali klik.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {phase === "input" && (
        <div className="space-y-6">
          <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <label className="block text-sm font-semibold text-zinc-900">Link produk (satu per baris, maks 10)</label>
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={8}
              placeholder={"https://www.tokopedia.com/toko/produk-a\nhttps://shopee.co.id/produk-b"}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 font-mono text-sm text-zinc-900 transition-colors focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-zinc-900">Pengaturan video (berlaku untuk semua produk di batch ini)</p>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Format</p>
              <div className="flex gap-2">
                {([
                  { id: "talking_head" as const, label: "Wajah AI" },
                  { id: "hands_only" as const, label: "Tangan + VO" },
                ]).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => selectFormat(f.id)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      format === f.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Durasi</p>
              <div className="flex gap-2">
                {([15, 30, 45] as const).map((d) => {
                  const disabled = format === "talking_head" && d !== 15;
                  return (
                    <button
                      key={d}
                      onClick={() => !disabled && setDurationSec(d)}
                      disabled={disabled}
                      title={disabled ? "Wajah AI cuma tersedia 15 detik" : undefined}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        durationSec === d ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {d} dtk
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Tier kualitas</p>
              <div className="flex gap-2">
                {([
                  { id: "high_quality" as const, label: "AI Bersuara" },
                  { id: "super_hq" as const, label: "AI Bersuara Pro" },
                ]).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTier(t.id)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      tier === t.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">Estimasi ~{rupiah(estimatePriceIdr(tier, durationSec))}/video (harga pasti dihitung ulang server saat render).</p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Avatar</p>
                <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5">
                  {(["female", "male"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setAvatarGender(g)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        avatarGender === g ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
                      }`}
                    >
                      {g === "female" ? "Female" : "Male"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {avatarsForGender.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setCreatorCategory(a.id)}
                    title={a.name}
                    className={`overflow-hidden rounded-xl border-2 transition-colors ${
                      creatorCategory === a.id ? "border-amber-500" : "border-transparent hover:border-zinc-200"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.img} alt={a.name} className="aspect-square w-full object-cover" />
                    <p className="truncate px-1 py-1 text-[10px] font-medium text-zinc-600">{a.name}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Memproses..." : "Generate Skrip"}
            </button>
          </div>
        </div>
      )}

      {phase === "review" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
            {readyItems.length} produk siap, {failedItems.length} gagal diproses. Pilih yang mau dirender, lalu setujui semua.
          </div>

          {readyItems.length > 0 && (
            <ul className="space-y-3">
              {readyItems.map((item) => {
                const checked = !excluded.has(item.script_id);
                return (
                  <li
                    key={item.script_id}
                    className={`flex items-start gap-4 rounded-2xl border bg-white p-4 shadow-sm transition-colors ${checked ? "border-amber-300" : "border-zinc-200 opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(excluded);
                        if (e.target.checked) next.delete(item.script_id); else next.add(item.script_id);
                        setExcluded(next);
                      }}
                      className="mt-1 h-4 w-4 accent-amber-500"
                    />
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-300">
                        <ImageOff size={20} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-900">
                        <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                        {item.product_name}
                      </p>
                      <p className="text-xs text-zinc-500">{rupiah(item.price_idr)} · hook {item.hook_family}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{item.caption}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {failedItems.length > 0 && (
            <ul className="space-y-2">
              {failedItems.map((item) => (
                <li key={item.url} className="flex items-start gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-zinc-400" />
                  <span><span className="font-mono">{item.url}</span> — {item.reason}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              disabled={loading || selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Memulai render..." : `Setujui ${selectedCount} & Mulai Render`}
            </button>
            <button
              onClick={() => { setPhase("input"); setItems([]); setBulkRunId(null); }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
            >
              <RotateCcw size={16} />
              Ulangi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
