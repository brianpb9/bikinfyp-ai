"use client";

// /coba — MAGIC MOMENT tanpa login (2026-08-06): 3 kolom → 3 skrip + Skor FYP
// dalam hitungan detik, TANPA daftar. Gate baru muncul saat mau render video.
// Data percobaan disimpan di sessionStorage (racun.try) untuk prefill S2
// setelah user daftar — jangan suruh ngetik dua kali.

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../_components/api";
import { CATEGORY_OPTIONS, HOOK_FAMILY_NAMES, rupiah } from "../_components/flow";
import { track } from "../_components/track";
import { guessCategory } from "@/lib/category-guess";

interface TryScript {
  hook_family: string;
  segments: { role: string; text: string }[];
  caption: string;
  fyp_score: number | null;
}

const ROLE_LABEL: Record<string, string> = { hook: "HOOK", demo: "DEMO", cta: "CTA" };

export default function CobaPage() {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("beauty");
  const [scripts, setScripts] = useState<TryScript[] | null>(null);
  const [openIdx, setOpenIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sudah disentuh sendiri oleh pengunjung? Kalau ya, tebakan berhenti campur
  // tangan selamanya — pilihan manusia mengalahkan tebakan mesin.
  const [pilihSendiri, setPilihSendiri] = useState(false);
  const [ditebak, setDitebak] = useState(false);

  useEffect(() => {
    track("try_view");
  }, []);

  // Halaman ini adalah kesan pertama, dan dropdown-nya default "beauty" untuk
  // SEMUA orang. Ketik "Gamis Katun Premium", biarkan default, dan skripnya
  // membuka dengan "Skincare murah vs mahal tuh bedanya apa sih?" — calon
  // pelanggan menyimpulkan AI-nya bodoh, padahal dia cuma tidak diberi tahu
  // ada dropdown. Menebak dari nama produk memakai kamus yang sama dengan
  // jalur ekstraksi URL (lib/category-guess.ts).
  useEffect(() => {
    if (pilihSendiri) return;
    const tebakan = guessCategory(name);
    // "default" = tidak ketemu. Jangan timpa pilihan yang sudah ada dengan
    // tebakan kosong; lebih baik diam.
    if (tebakan === "default" || tebakan === category) return;
    setCategory(tebakan);
    setDitebak(true);
  }, [name, pilihSendiri, category]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ scripts: TryScript[] }>("/api/try", {
        json: { name: name.trim(), price_idr: parseInt(price || "0", 10), category },
      });
      setScripts(res.scripts);
      setOpenIdx(0);
      sessionStorage.setItem("racun.try", JSON.stringify({ name: name.trim(), priceIdr: parseInt(price, 10), category }));
      track("try_generated", { category });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal bikin skrip. Coba lagi ya.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-10 pt-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Gratis · tanpa daftar</p>
      <h1 className="font-display text-2xl font-bold text-zinc-900">Lihat skrip jualanmu dalam 30 detik</h1>
      <p className="mt-1 text-sm leading-6 text-zinc-600">
        Isi 3 kolom, langsung dapat 3 skrip video + Skor FYP. Suka? Baru daftar buat render videonya —
        user baru dapat bonus Rp12.000 (1 video AI Bersuara gratis).
      </p>

      <div className="mt-4 space-y-2">
        <input
          type="text"
          placeholder="Nama produk (mis. Serum Glow Bright)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="Harga (mis. 85000)"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
          className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
        />
        {price && <p className="text-sm text-zinc-500">= {rupiah(parseInt(price || "0", 10) || 0)}</p>}
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPilihSendiri(true); setDitebak(false); }}
          className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        {/* Tebakan yang tidak diberitahukan itu diam-diam mengubah hasil orang.
            Katakan bahwa kita menebak, dan katakan bahwa mereka boleh ganti. */}
        {ditebak && (
          <p className="text-sm text-zinc-500">
            Kategorinya kami tebak dari nama produk — ganti kalau meleset.
          </p>
        )}
        <button
          type="button"
          onClick={generate}
          disabled={loading || !name.trim() || !price}
          className="min-h-[56px] w-full rounded-2xl bg-amber-500 font-display text-lg font-bold text-white shadow-sm active:bg-amber-600 disabled:bg-zinc-300"
        >
          {loading ? "Nulis skripnya..." : "Bikinkan Skripnya — Gratis"}
        </button>
        {error && <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>

      {scripts && (
        <section className="mt-6 space-y-3">
          <h2 className="font-display text-xl font-bold">3 versi skripmu ✨</h2>
          {scripts.map((s, i) => (
            <div key={i} className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${openIdx === i ? "border-amber-400" : "border-zinc-200"}`}>
              <button type="button" onClick={() => setOpenIdx(i)} className="flex w-full items-center justify-between text-left">
                <p className="text-sm font-bold text-amber-700">
                  Versi {i + 1} · {HOOK_FAMILY_NAMES[s.hook_family] ?? s.hook_family}
                  {typeof s.fyp_score === "number" && (
                    <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-700">Skor FYP {s.fyp_score}</span>
                  )}
                </p>
                <span className="text-zinc-400">{openIdx === i ? "−" : "+"}</span>
              </button>
              {openIdx === i && (
                <div className="mt-2 space-y-2">
                  {s.segments.map((seg) => (
                    <div key={seg.role}>
                      <p className="text-xs font-bold text-zinc-500">{ROLE_LABEL[seg.role] ?? seg.role}</p>
                      <p className="text-sm leading-6 text-zinc-800">{seg.text}</p>
                    </div>
                  ))}
                  <p className="rounded-xl bg-zinc-50 p-2 text-xs leading-5 text-zinc-500">Caption: {s.caption}</p>
                </div>
              )}
            </div>
          ))}
          <p className="text-xs leading-5 text-zinc-500">
            Skor FYP = pola yang cenderung menang di data video jualan yang kami pelajari — korelasi, bukan jaminan.
          </p>
          <Link
            // ?daftar=1 — menembus ke FORM, bukan ke hero. Tanpa ini, orang
            // yang baru melihat skripnya sendiri dikembalikan ke halaman
            // marketing dan harus mencari lagi cara mendaftar.
            href="/onboarding?daftar=1"
            onClick={() => track("try_signup_click")}
            className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-500 font-display text-lg font-bold text-white shadow-sm active:bg-amber-600"
          >
            Render jadi video → daftar gratis (bonus Rp12.000)
          </Link>
          <p className="text-center text-xs text-zinc-500">Produkmu sudah kami ingat — tinggal upload foto setelah daftar.</p>
        </section>
      )}
    </main>
  );
}
