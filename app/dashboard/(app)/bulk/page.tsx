"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ImageOff, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";
import { rupiah } from "../../_components/format";

type ReadyItem = {
  status: "ready"; url: string; product_id: string; script_id: string; product_name: string;
  price_idr: number; category: string; image_url: string | null; caption: string; hook_family: string;
};
type FailedItem = { status: "failed"; url: string; reason: string };
type BulkItem = ReadyItem | FailedItem;

// Halaman submit bulk-generate (M4, F-ENT-01, polish M5) — dua fase sesuai
// gerbang HITL di API: (1) generate & review, (2) satu klik "Setujui Semua"
// yang benar-benar meng-approve tiap skrip (bukan formalitas UI).
export default function BulkGeneratePage() {
  const router = useRouter();
  const [urlsText, setUrlsText] = useState("");
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkRunId, setBulkRunId] = useState<string | null>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  async function handleGenerate() {
    const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) { setError("Masukkan minimal 1 link produk."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ bulk_run_id: string; items: BulkItem[] }>("/api/dashboard/bulk", { json: { urls } });
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
        json: { bulk_run_id: bulkRunId, items: ready.map((i) => ({ product_id: i.product_id, script_id: i.script_id })) },
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
        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-semibold text-zinc-900">Link produk (satu per baris, maks 10)</label>
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            rows={8}
            placeholder={"https://www.tokopedia.com/toko/produk-a\nhttps://shopee.co.id/produk-b"}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 font-mono text-sm text-zinc-900 transition-colors focus:border-amber-500 focus:outline-none"
          />
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? "Memproses..." : "Generate Skrip"}
          </button>
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
