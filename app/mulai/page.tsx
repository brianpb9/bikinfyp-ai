"use client";

// /mulai — QUIZ FUNNEL untuk traffic iklan (backlog #8, adopsi pola onboarding
// kompetitor 2026-08-06): 2 langkah cepat -> pitch personal -> magic moment.
// TANPA login, TANPA fake scarcity (beda dari kompetitor: kami tidak bohong
// "you can't change this later"). Objection mapping dipakai untuk memilih
// pitch, dan jawabannya masuk telemetry (quiz_objection) untuk iklan nanti.

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "../_components/track";

type Product = "affiliate" | "ads";

const OBJECTIONS: { id: string; label: string; pitch: string }[] = [
  {
    id: "waktu",
    label: "Bikin konten makan waktu banget",
    pitch: "Dari foto produk jadi video siap posting dalam ±3 menit — tanpa syuting, tanpa editing.",
  },
  {
    id: "kamera",
    label: "Nggak pede muncul di kamera",
    pitch: "Kamu nggak perlu muncul sama sekali — AI yang memperagakan produkmu (tangan atau presenter AI).",
  },
  {
    id: "mahal",
    label: "Jasa kreator/UGC mahal",
    pitch: "Mulai Rp12.000 per video bersuara — bandingkan dengan jasa UGC ratusan ribu per konten.",
  },
  {
    id: "sepi",
    label: "Video-ku sepi views & orderan",
    pitch: "Tiap skrip dinilai Skor FYP dari pola ratusan video jualan yang terbukti menghasilkan order.",
  },
];

export default function MulaiQuizPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [product, setProduct] = useState<Product>("affiliate");
  const [objection, setObjection] = useState<(typeof OBJECTIONS)[number] | null>(null);

  useEffect(() => {
    track("quiz_view");
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-10 pt-8">
      <div className="mb-5 flex items-center justify-between">
        <span className="font-display text-base font-extrabold text-zinc-900">Bikin<span className="text-amber-500">FYP</span>.AI</span>
        <span className="text-xs font-semibold text-zinc-400">kuis 30 detik · langkah {step}/3</span>
      </div>
      <div className="mb-6 flex gap-1.5">
        {[1, 2, 3].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-amber-500" : "bg-zinc-200"}`} />
        ))}
      </div>

      {step === 1 && (
        <section>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Mau bikin video apa?</h1>
          <p className="mt-1 text-sm text-zinc-500">Pilih yang paling dekat — bisa ganti kapan saja kok.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setProduct("affiliate"); track("quiz_product", { product: "affiliate" }); setStep(2); }}
              className="overflow-hidden rounded-3xl border-2 border-amber-300 bg-white text-left shadow-sm active:scale-[0.98]"
            >
              <video src="/previews/format-tangan.mp4" autoPlay muted loop playsInline className="aspect-[9/16] w-full object-cover" />
              <div className="p-3">
                <p className="font-display text-base font-bold leading-tight">AI UGC Affiliate</p>
                <p className="mt-1 text-xs leading-4 text-zinc-500">Jualan produk fisik ke TikTok Shop</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setProduct("ads"); track("quiz_product", { product: "ads" }); setStep(2); }}
              className="overflow-hidden rounded-3xl border-2 border-zinc-200 bg-white text-left shadow-sm active:scale-[0.98]"
            >
              <video src="/previews/format-wajah.mp4" autoPlay muted loop playsInline className="aspect-[9/16] w-full object-cover" />
              <div className="p-3">
                <p className="font-display text-base font-bold leading-tight">AI UGC Ads</p>
                <p className="mt-1 text-xs leading-4 text-zinc-500">Promosi app, jasa, atau toko</p>
              </div>
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Apa yang paling nahan kamu selama ini?</h1>
          <div className="mt-4 space-y-2">
            {OBJECTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { setObjection(o); track("quiz_objection", { objection: o.id }); setStep(3); }}
                className="w-full rounded-2xl border-2 border-zinc-200 bg-white p-4 text-left font-semibold text-zinc-800 shadow-sm active:scale-[0.99] active:bg-amber-50"
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && objection && (
        <section className="space-y-5 text-center">
          <p className="text-5xl" aria-hidden="true">✨</p>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Pas banget.</h1>
          <p className="rounded-3xl border border-amber-100 bg-white p-5 text-base leading-7 text-zinc-700 shadow-sm">{objection.pitch}</p>
          <Link
            href={product === "affiliate" ? "/coba" : "/promo"}
            onClick={() => track("quiz_done", { product, objection: objection.id })}
            className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-500 font-display text-lg font-bold text-white shadow-sm active:bg-amber-600"
          >
            {product === "affiliate" ? "Lihat skripmu sekarang — gratis, tanpa daftar" : "Mulai bikin AI UGC Ads"}
          </Link>
          <p className="text-xs text-zinc-400">Tanpa kartu kredit · user baru dapat bonus Rp12.000 (1 video gratis)</p>
        </section>
      )}
    </main>
  );
}
