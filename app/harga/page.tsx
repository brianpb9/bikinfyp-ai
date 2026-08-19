import Link from "next/link";
import { PAKET_KREDIT, TIER_HARGA, rentangHarga } from "../../lib/paket-kredit";
import { SiteFooter } from "../_components/SiteFooter";

// HALAMAN HARGA PUBLIK — bisa dibuka TANPA login.
//
// Kenapa ada. Sampai 2026-08-14 seluruh daftar harga BikinFYP hidup di
// /kredit, dan /kredit wajib login. Akibatnya siapa pun yang menilai kita dari
// luar — calon pelanggan yang belum daftar, dan reviewer Midtrans — membuka
// bikinfyp.com, kena dinding login, lalu menyimpulkan produk dan harganya
// tidak jelas. Itu persis dua temuan onboarding Midtrans 13 Agustus 2026:
//   "Produk barang/jasa yang dijual belum tersedia/belum jelas pada website"
//   "Tidak menemukan harga (harus dalam IDR) untuk barang/jasa yang tercantum"
//
// Bukan salah mereka. Dari luar, website kita memang belum menunjukkan apa
// yang dijual dan berapa harganya.
//
// Server Component tanpa "use client": halaman ini murni bacaan, tidak butuh
// state, dan bentuk statis membuatnya lebih cepat dibaca perayap maupun orang.

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export const metadata = {
  title: "Harga — BikinFYP AI",
  description:
    // Angka TIDAK diketik di sini. "Mulai Rp5.000" sempat bertahan berbulan-bulan
    // sesudah tier itu pensiun, jadi halaman publik mengiklankan barang yang
    // mesinnya sendiri tolak. Diturunkan dari TIER_HARGA supaya tidak bisa hanyut lagi.
    `Harga jelas dalam Rupiah: video iklan produk mulai ${rupiah(Math.min(...TIER_HARGA.map((t) => t.hargaIdr)))}. Tanpa langganan, tanpa biaya tersembunyi.`,
};


export default function HargaPage() {
  const { min, max } = rentangHarga();
  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-24 pt-6">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">BikinFYP AI</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Harga</h1>
        <p className="text-sm leading-6 text-zinc-600">
          Semua harga dalam Rupiah dan sudah final. Tidak ada langganan otomatis, tidak ada biaya
          tersembunyi. Rentang {rupiah(min)} – {rupiah(max)}.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-zinc-900">Harga per video</h2>
        <p className="text-xs text-zinc-500">
          Yang kamu dapat: satu video iklan produkmu, siap diunduh dan diposting.
        </p>
        <ul className="space-y-2">
          {TIER_HARGA.map((t) => (
            <li key={t.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display font-bold text-zinc-900">{t.nama}</span>
                <span className="whitespace-nowrap font-display text-lg font-bold text-amber-700">
                  {rupiah(t.hargaIdr)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-600">{t.dapat}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-zinc-900">Paket kredit</h2>
        <p className="text-xs leading-5 text-zinc-500">
          Videonya dibayar pakai kredit. Kredit tidak punya masa kedaluwarsa — bisa dipakai
          kapan saja. Top-up kredit dilakukan mandiri dari halaman Kredit setelah masuk akun.
        </p>
        <ul className="space-y-2">
          {PAKET_KREDIT.map((p) => (
            <li key={p.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display font-bold text-zinc-900">{p.name}</span>
                <span className="whitespace-nowrap font-display text-lg font-bold text-amber-700">
                  {rupiah(p.price)}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                {p.perVideo}
                {p.tag ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{p.tag}</span> : null}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-zinc-500">{p.badge}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-display text-base font-bold text-amber-900">Cara kerjanya</h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-6 text-amber-900">
          <li>Daftar pakai email atau akun Google.</li>
          <li>
            Buka halaman <b>Kredit</b>, pilih paket, lalu bayar lewat halaman pembayaran
            aman Duitku (QRIS, virtual account, e-wallet, atau gerai retail). Kredit masuk
            otomatis begitu pembayaran terkonfirmasi.
          </li>
          <li>Unggah foto produk atau tempel link produkmu, isi detail singkat.</li>
          <li>Kredit ditahan dulu, belum dipotong, sementara videomu dibuat.</li>
          <li>Video lolos pemeriksaan kualitas otomatis → kredit dipotong, video bisa diunduh.</li>
          <li>Gagal lolos atau ada kendala teknis di sistem kami → kredit kembali penuh, otomatis.</li>
        </ol>
      </section>

      <div className="flex gap-2">
        {/* Halaman ini statis (dibaca calon pengguna DAN reviewer Midtrans),
            jadi CTA-nya tidak membaca health — ia mengarah ke landing yang
            CTA-nya health-aware, bukan langsung ke langkah daftar. */}
        <Link
          href="/"
          className="flex min-h-[56px] flex-1 items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-bold text-white"
        >
          Lihat cara kerjanya
        </Link>
      </div>

      <SiteFooter />
    </main>
  );
}
