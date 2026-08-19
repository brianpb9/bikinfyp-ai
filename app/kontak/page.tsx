import Link from "next/link";
import { KONTAK } from "../../lib/kontak";
import { SiteFooter } from "../_components/SiteFooter";

// HALAMAN KONTAK PUBLIK — bisa dibuka TANPA login (didaftarkan di middleware).
//
// Syarat onboarding Duitku (2026-08-19): "informasi contact support berupa
// nomor telepon, email, dan alamat pada website". Halaman ini adalah jawaban
// langsungnya; footer publik menautkan ke sini dari semua halaman utama.
// Server Component murni bacaan, sama seperti /harga.

export const metadata = {
  title: "Kontak — BikinFYP AI",
  description: `Hubungi tim ${KONTAK.produk}: email ${KONTAK.email}, telepon/WhatsApp ${KONTAK.teleponTampil}.`,
};

export default function KontakPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-24 pt-6">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">{KONTAK.produk}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Kontak &amp; Dukungan</h1>
        <p className="text-sm leading-6 text-zinc-600">
          Ada pertanyaan soal pesanan, pembayaran, atau hasil video? Tim kami siap bantu.
        </p>
      </header>

      <section className="space-y-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">Email</p>
          <a href={`mailto:${KONTAK.email}`} className="mt-1 block font-display text-lg font-bold text-amber-700 underline underline-offset-2">
            {KONTAK.email}
          </a>
          <p className="mt-1 text-xs text-zinc-500">Dibalas maksimal 1×24 jam pada hari kerja.</p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">Telepon</p>
          <a href={`tel:${KONTAK.teleponTel}`} className="mt-1 block font-display text-lg font-bold text-amber-700 underline underline-offset-2">
            {KONTAK.teleponTampil}
          </a>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-zinc-400">WhatsApp</p>
          <a
            href={`https://wa.me/${KONTAK.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex min-h-[44px] w-fit items-center rounded-2xl bg-green-600 px-4 text-sm font-bold text-white"
          >
            Chat via WhatsApp ({KONTAK.whatsappTampil})
          </a>
          <p className="mt-2 text-xs text-zinc-500">{KONTAK.jamLayanan}</p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">Alamat</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-zinc-800">{KONTAK.usaha}</p>
          <p className="text-sm leading-6 text-zinc-600">{KONTAK.alamat}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        <p className="font-bold">Soal pembayaran &amp; refund</p>
        <p>
          Kendala top-up atau kredit belum masuk setelah bayar? Sertakan nomor order kamu
          (format <code>racun-...</code>) saat menghubungi kami supaya cepat kami telusuri.
          Ketentuan lengkap ada di <Link href="/legal/refund" className="underline">Kebijakan Refund</Link>.
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
