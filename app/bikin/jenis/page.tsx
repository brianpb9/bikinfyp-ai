"use client";

import Link from "next/link";

// S1.5 — PILIH JENIS VIDEO. Fork sebelum masuk alur: e-commerce (produk fisik,
// tangan pegang barang) vs promosi (talking-head sendiri + hook AI, buat app/jasa
// yang tidak punya produk fisik untuk dipegang di kamera).
export default function PilihJenisPage() {
  return (
    <main className="min-h-dvh space-y-7 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <Link href="/" className="flex min-h-[44px] items-center text-base font-semibold text-zinc-700">
          ← Bikin Video
        </Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Langkah 1</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Mau bikin video apa?</h1>
      </div>

      <div className="space-y-4">
        <Link
          href="/bikin/produk"
          className="block rounded-3xl border-2 border-amber-200 bg-white p-5 shadow-sm active:scale-[0.98]"
        >
          <div className="text-3xl">🛍️</div>
          <p className="mt-2 font-display text-lg font-bold text-zinc-900">Video Jualan Produk</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Punya produk fisik (skincare, fashion, gadget, dll)? AI bikin video tangan pegang produk kamu, siap posting ke TikTok Shop.
          </p>
        </Link>

        <Link
          href="/promo"
          className="block rounded-3xl border-2 border-amber-200 bg-white p-5 shadow-sm active:scale-[0.98]"
        >
          <div className="text-3xl">🎤</div>
          <p className="mt-2 font-display text-lg font-bold text-zinc-900">Video Promosi (App/Jasa)</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Promoin app, jasa, atau apa saja tanpa produk fisik? Upload rekaman kamu sendiri, AI tambahin hook pembuka + suara.
          </p>
        </Link>
      </div>
    </main>
  );
}
