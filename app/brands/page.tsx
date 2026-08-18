import Link from "next/link";
import {
  ArrowRight, Check, Coins, Eye, Film, LayoutTemplate, ShieldCheck, Sparkles,
} from "lucide-react";

export const metadata = {
  title: "BikinFYP Brands — Video iklan AI untuk brand Indonesia",
  description:
    "Satu produk jadi 2–6 variasi video siap ditinjau. Tinjau tiap adegan sebelum digabung, bayar pakai token, unduh sekaligus.",
};

// Halaman depan enterprise (permintaan Brian, referensi brand.ai + Sintra).
//
// ATURAN YANG SAYA PEGANG DI SINI: tidak ada satu pun angka, testimoni, atau
// logo pelanggan yang dikarang. Produk ini baru berjalan; menempel "dipercaya
// 500+ brand" akan ketahuan pada percakapan penjualan pertama dan merusak
// kepercayaan yang justru sedang kita bangun. Yang dipajang hanya yang benar
// ada: klip contoh yang memang kami render, dan kemampuan yang memang jalan.
//
// Publik — tidak butuh login. Middleware mengecualikan /brands dari guard.

const STEPS = [
  { icon: LayoutTemplate, title: "Pilih template", body: "Konsep yang sudah kami susun: format, durasi, sudut hook, jumlah variasi. Tinggal pilih." },
  { icon: Sparkles, title: "Masukkan produk", body: "Tempel link toko atau isi manual, tambah foto. Makin lengkap, makin nyambung hasilnya." },
  { icon: Eye, title: "Tinjau tiap adegan", body: "Lihat gambar dan kalimatnya per adegan. Ganti yang kurang pas — yang lain tetap." },
];

const PROOF = [
  { icon: ShieldCheck, title: "Produkmu dijaga tetap konsisten", body: "Foto produkmu disuntikkan ke setiap adegan, dan pemeriksaan otomatis menolak video yang produknya berubah identitas. Render yang gagal pemeriksaan tidak ditagihkan." },
  { icon: Eye, title: "Tidak ada yang digabung diam-diam", body: "Video baru disusun setelah kamu menyetujui adegannya. Brand peduli gambar dan pesan — jadi keputusannya di tanganmu, bukan di tangan AI." },
  { icon: Coins, title: "Bayar pakai token, gagal dikembalikan", body: "Token ditahan saat render mulai dan dikembalikan otomatis kalau rendernya gagal. Kamu tidak membayar hasil yang tidak jadi." },
];

const FORMATS = [
  { label: "UGC Affiliate", desc: "Gaya kreator: tangan memegang produk, atau presenter bicara santai.", src: "/previews/format-tangan.mp4" },
  { label: "UGC Ads", desc: "Iklan langsung untuk app, jasa, toko — atau produk fisik.", src: "/previews/format-ads.mp4" },
  { label: "TVC", desc: "Sinematik, kamera terkontrol, pencahayaan ditata, ditutup hero shot.", src: "/previews/format-tvc.mp4" },
];

export default function BrandsLandingPage() {
  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-lg font-bold tracking-tight">
          BikinFYP <span className="text-amber-500">Brands</span>
        </span>
        <Link
          href="/onboarding?audience=brand&next=%2Fdashboard"
          className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
        >
          Masuk
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        {/* Hero */}
        <section className="grid items-center gap-12 py-14 lg:grid-cols-2 lg:py-20">
          <div>
            <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Satu produk.
              <br />
              <span className="text-amber-500">Enam video</span> siap ditinjau.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-zinc-600">
              Tanpa syuting, tanpa talent, tanpa nunggu agensi. Masukkan produkmu, pilih konsepnya,
              tinjau tiap adegan — lalu unduh semuanya sekaligus.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/onboarding?audience=brand&next=%2Fdashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400"
              >
                Mulai sekarang <ArrowRight size={16} />
              </Link>
              <a
                href="#cara-kerja"
                className="rounded-xl border border-zinc-300 px-6 py-3.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Lihat cara kerjanya
              </a>
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              Akses brand diatur bersama tim kami — hubungi kami untuk dibukakan organisasi.
            </p>
          </div>

          {/* Klip NYATA yang memang kami render, bukan mockup. */}
          <div className="grid grid-cols-3 gap-3">
            {FORMATS.map((f, i) => (
              <div
                key={f.label}
                className={`relative aspect-[9/16] overflow-hidden rounded-2xl bg-zinc-900 shadow-lg ${i === 1 ? "translate-y-6" : ""}`}
              >
                <video src={f.src} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Cara kerja */}
        <section id="cara-kerja" className="border-t border-zinc-200 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">Tiga langkah, bukan tiga minggu</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.title}>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Icon size={19} />
                  </span>
                  <p className="mt-4 text-sm font-bold text-zinc-400">Langkah {i + 1}</p>
                  <p className="mt-0.5 font-display text-lg font-bold">{s.title}</p>
                  <p className="mt-1.5 text-sm leading-6 text-zinc-600">{s.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Format */}
        <section className="border-t border-zinc-200 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">Tiga jenis video</h2>
          <p className="mt-2 max-w-xl text-zinc-600">Pilih sesuai tujuannya, bukan sesuai istilah teknisnya.</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {FORMATS.map((f) => (
              <div key={f.label} className="overflow-hidden rounded-2xl border border-zinc-200">
                <div className="relative aspect-[9/16] bg-zinc-900">
                  <video src={f.src} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
                </div>
                <div className="p-4">
                  <p className="font-display text-base font-bold">{f.label}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Kenapa berbeda */}
        <section className="border-t border-zinc-200 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">Yang biasanya jadi masalah, kami tutup</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {PROOF.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.title} className="rounded-2xl border border-zinc-200 p-6">
                  <Icon size={20} className="text-amber-500" />
                  <p className="mt-4 font-display text-base font-bold">{p.title}</p>
                  <p className="mt-1.5 text-sm leading-6 text-zinc-600">{p.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Termasuk */}
        <section className="border-t border-zinc-200 py-16">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight">Termasuk di dalamnya</h2>
              <p className="mt-2 text-zinc-600">Fitur-fitur ini sudah terpasang — akses dibuka bertahap selama early access.</p>
            </div>
            <ul className="space-y-3">
              {[
                "Template siap pakai — tinggal ganti produknya",
                "Simpan konfigurasimu sendiri jadi template",
                "Avatar AI, atau upload foto sendiri",
                "Tinjau dan ganti adegan satu per satu",
                "Library semua video, unduh satuan atau sekaligus",
                "Rencana posting: jadwal, caption, tandai sudah tayang",
                "Anggota tim berbagi satu saldo token",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm leading-6 text-zinc-700">
                  <Check size={16} className="mt-1 shrink-0 text-emerald-500" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Penutup */}
        <section className="border-t border-zinc-200 py-20">
          <div className="rounded-3xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-10 text-center sm:p-14">
            <Film size={26} className="mx-auto text-amber-400" />
            <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Produk pertamamu bisa mulai diproses hari ini
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-zinc-400">
              Hubungi kami untuk membuka akses organisasi. Kami bantu sampai video pertamamu jadi.
            </p>
            <Link
              href="/onboarding?audience=brand&next=%2Fdashboard"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400"
            >
              Mulai sekarang <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-zinc-500">
          <span>© {new Date().getFullYear()} BikinFYP AI</span>
          <span className="flex gap-5">
            <Link href="/legal/terms" className="hover:text-zinc-800">Ketentuan</Link>
            <Link href="/legal/privacy" className="hover:text-zinc-800">Privasi</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
