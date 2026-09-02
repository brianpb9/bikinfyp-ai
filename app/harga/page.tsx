import Link from "next/link";
import { TIER_HARGA } from "../../lib/paket-kredit";
import { hargaKredit, daftarPaket } from "../../lib/kredit-video-runtime";
import { JENIS_VIDEO } from "../../lib/kredit-video";
import { KUALITAS } from "../../lib/kualitas-video";
import { SiteFooter } from "../_components/SiteFooter";

// HALAMAN HARGA PUBLIK — bisa dibuka TANPA login.
//
// Kenapa ada. Sampai 2026-08-14 seluruh daftar harga BikinFYP hidup di
// /kredit, dan /kredit wajib login. Akibatnya siapa pun yang menilai kita dari
// luar — calon pelanggan yang belum daftar, dan reviewer gateway pembayaran — membuka
// bikinfyp.com, kena dinding login, lalu menyimpulkan produk dan harganya
// tidak jelas. Itu persis dua temuan onboarding gateway pembayaran 13 Agustus 2026:
//   "Produk barang/jasa yang dijual belum tersedia/belum jelas pada website"
//   "Tidak menemukan harga (harus dalam IDR) untuk barang/jasa yang tercantum"
//
// Bukan salah mereka. Dari luar, website kita memang belum menunjukkan apa
// yang dijual dan berapa harganya.
//
// Server Component tanpa "use client": halaman ini murni bacaan dan tidak
// butuh state.
//
// ANGKANYA DIBACA DARI SUMBER YANG MENAGIH, bukan dari daftar statis.
// Sejak harga per jenis video dan isi paket bisa diubah admin tanpa deploy,
// daftar yang diketik di kode DIJAMIN hanyut — dan yang membaca halaman ini
// justru reviewer gateway pembayaran dan pelanggan yang lalu ditagih angka
// lain. TIER_HARGA tinggal sebagai cadangan untuk keadaan yang belum diatur
// sama sekali, supaya halaman ini tidak pernah tampil tanpa harga.

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export const dynamic = "force-dynamic";

/** Harga per video yang BENAR-BENAR berlaku; cadangan bila belum diatur. */
async function hargaPerVideo(): Promise<{ id: string; nama: string; hargaIdr: number; dapat: string }[]> {
  const dari: Partial<Record<string, number>> = await hargaKredit().catch(() => ({}));
  const hidup = JENIS_VIDEO.filter((j) => dari[j]).map((j) => ({
    id: j,
    nama: `Video ${KUALITAS[j].label}`,
    hargaIdr: dari[j] as number,
    dapat: `${KUALITAS[j].resolusi} — ${KUALITAS[j].jelas}`,
  }));
  return hidup.length ? hidup : TIER_HARGA.map((t) => ({ id: t.id, nama: t.nama, hargaIdr: t.hargaIdr, dapat: t.dapat }));
}

export async function generateMetadata() {
  const harga = await hargaPerVideo();
  return {
    title: "Harga — BikinFYP AI",
    description:
      // Angka TIDAK diketik di sini. "Mulai Rp5.000" sempat bertahan
      // berbulan-bulan sesudah tier itu pensiun, jadi halaman publik
      // mengiklankan barang yang mesinnya sendiri tolak.
      `Harga jelas dalam Rupiah: video iklan produk mulai ${rupiah(Math.min(...harga.map((t) => t.hargaIdr)))}. Bayar per video, tanpa biaya tersembunyi.`,
  };
}

export default async function HargaPage() {
  const [harga, paket] = await Promise.all([hargaPerVideo(), daftarPaket(true).catch(() => [])]);
  const semua = [...harga.map((h) => h.hargaIdr), ...paket.map((p) => p.hargaIdr)];
  const min = Math.min(...semua);
  const max = Math.max(...semua);
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
          {harga.map((t) => (
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

      {paket.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-zinc-900">Paket langganan</h2>
          <p className="text-xs leading-5 text-zinc-500">
            Berisi jatah video per jenis. Jatah paket berlaku selama masa aktifnya; kredit
            satuan yang dibeli terpisah tidak punya masa kedaluwarsa.
          </p>
          <ul className="space-y-2">
            {paket.map((p) => (
              <li key={p.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display font-bold text-zinc-900">{p.nama}</span>
                  <span className="whitespace-nowrap font-display text-lg font-bold text-amber-700">
                    {rupiah(p.hargaIdr)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-600">
                  {[
                    p.kuotaStandard ? `${p.kuotaStandard}× Standard` : null,
                    p.kuotaPremium ? `${p.kuotaPremium}× Premium` : null,
                    p.kuotaUltra ? `${p.kuotaUltra}× Ultra` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                  Berlaku {p.masaHari} hari{p.keterangan ? ` — ${p.keterangan}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-display text-base font-bold text-amber-900">Cara kerjanya</h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-6 text-amber-900">
          <li>Daftar pakai email atau akun Google.</li>
          <li>
            Buka halaman <b>Kredit</b>, pilih paket atau jumlah video yang mau dibeli, lalu bayar lewat halaman pembayaran
            aman Duitku (QRIS, virtual account, e-wallet, atau gerai retail). Kredit masuk
            otomatis begitu pembayaran terkonfirmasi.
          </li>
          <li>Unggah foto produk atau tempel link produkmu, isi detail singkat.</li>
          <li>Satu jatah video dipotong saat pembuatan dimulai.</li>
          <li>Video lolos pemeriksaan kualitas otomatis → video bisa diunduh.</li>
          <li>Gagal lolos atau ada kendala teknis di sistem kami → jatahnya kembali, otomatis.</li>
        </ol>
      </section>

      <div className="flex gap-2">
        {/* Halaman ini statis (dibaca calon pengguna DAN reviewer gateway pembayaran),
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
