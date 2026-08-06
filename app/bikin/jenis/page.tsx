"use client";

import Link from "next/link";

// S1.5 — PILIH JENIS VIDEO, gaya quiz (2026-08-06, adopsi funnel kompetitor +
// penamaan produk Brian): dua produk dengan PREVIEW nyata, bukan label abstrak.
// - AI UGC Affiliate: e-commerce, produk fisik dipegang tangan AI -> TikTok Shop
// - AI UGC Ads: promosi app/jasa, rekaman sendiri + hook AI
export default function PilihJenisPage() {
  return (
    <main className="min-h-dvh space-y-6 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <Link href="/" className="flex min-h-[44px] items-center text-base font-semibold text-zinc-700">
          ← Bikin Video
        </Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Langkah 1 · pilih satu</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Mau bikin video apa?</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/bikin/produk"
          className="overflow-hidden rounded-3xl border-2 border-amber-300 bg-white shadow-sm active:scale-[0.98]"
        >
          <video src="/previews/format-tangan.mp4" autoPlay muted loop playsInline className="aspect-[9/16] w-full object-cover" />
          <div className="p-3">
            <p className="font-display text-base font-bold leading-tight text-zinc-900">AI UGC Affiliate</p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              Jualan produk fisik ke TikTok Shop — AI peragakan produkmu, tinggal upload foto.
            </p>
          </div>
        </Link>

        <Link
          href="/promo"
          className="overflow-hidden rounded-3xl border-2 border-zinc-200 bg-white shadow-sm active:scale-[0.98]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/showcase/hijaber.webp" alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" decoding="async" />
          <div className="p-3">
            <p className="font-display text-base font-bold leading-tight text-zinc-900">AI UGC Ads</p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              Promosi app, jasa, atau toko — upload rekamanmu, AI tambah hook pembuka + suara.
            </p>
          </div>
        </Link>
      </div>

      <p className="text-center text-xs text-zinc-500">
        Bingung? Kalau produkmu bisa dipegang tangan, pilih <b>AI UGC Affiliate</b>.
      </p>
    </main>
  );
}
