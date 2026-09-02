import Link from "next/link";
import { wajibAdmin } from "@/lib/admin-auth";
import { daftarPaket, hargaKredit } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";
import { PengaturPaket } from "./PengaturPaket";

// PAKET & HARGA — layar tempat model bisnis diatur tanpa menyentuh kode.
//
// Halaman admin KEDUA yang menulis, setelah kredensial. Alasannya sejenis:
// harga dan isi paket berubah lebih sering daripada kode, dan setiap perubahan
// yang menuntut deploy akan berakhir sebagai angka yang dibiarkan salah karena
// "nanti saja sekalian".
//
// Yang dijaga:
//   - semua angka divalidasi ULANG di server (lihat api/admin/kredit-video)
//   - paket tidak pernah dihapus, hanya dinonaktifkan — riwayat pembelian
//     tetap menunjuk id-nya
//   - mengubah isi paket TIDAK mengubah langganan yang sudah berjalan: kuota
//     disalin saat membeli, bukan dirujuk

export const dynamic = "force-dynamic";

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export default async function HalamanPaket() {
  await wajibAdmin();
  const [harga, paket] = await Promise.all([hargaKredit(), daftarPaket(false)]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Paket &amp; Harga</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Kredit dihitung per jenis video. Kredit dari paket habis saat masa berlakunya berakhir; kredit
            satuan tidak pernah hangus.
          </p>
        </div>
        <Link href="/admin" className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
          ← Admin
        </Link>
      </div>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="font-display text-lg font-bold">Harga kredit satuan</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Harga yang dibayar pembeli untuk SATU video jenis ini di luar paket.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {JENIS_VIDEO.map((j) => (
            <div key={j} className="rounded-xl border border-zinc-200 p-3">
              <p className="font-bold">{KUALITAS[j].label}</p>
              <p className="text-xs text-zinc-500">{KUALITAS[j].resolusi} · {KUALITAS[j].jelas}</p>
              <p className="mt-2 text-sm">
                {harga[j] ? (
                  <span className="font-bold text-amber-700">{rupiah(harga[j] as number)}/video</span>
                ) : (
                  <span className="text-red-600">belum diatur — tidak bisa dibeli satuan</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </section>

      <PengaturPaket
        hargaAwal={JENIS_VIDEO.map((j) => ({ jenis: j, label: KUALITAS[j].label, harga_idr: harga[j] ?? null }))}
        paketAwal={paket.map((p) => ({
          id: p.id, nama: p.nama, keterangan: p.keterangan, harga_idr: p.hargaIdr,
          kuota_standard: p.kuotaStandard, kuota_premium: p.kuotaPremium, kuota_ultra: p.kuotaUltra,
          masa_hari: p.masaHari, urutan: p.urutan, aktif: p.aktif,
        }))}
      />
    </main>
  );
}
