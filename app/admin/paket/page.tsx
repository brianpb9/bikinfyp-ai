import Link from "next/link";
import { wajibAdmin } from "@/lib/admin-auth";
import { daftarPaket, hargaKredit } from "@/lib/kredit-video-runtime";
import { JENIS_VIDEO } from "@/lib/kredit-video";
import { KUALITAS } from "@/lib/kualitas-video";
import { PengaturPaket } from "./PengaturPaket";
import { PemetaanModel } from "./PemetaanModel";
import { mesinBerlaku, modelBerlaku, muatPemetaan, pemetaanTersimpan } from "@/lib/pemetaan-model";
import { KATALOG_MODEL } from "@/lib/katalog-model";
import type { Kualitas } from "@/lib/kualitas-video";

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
  // Dimuat di server sebelum dirender: layar harus menampilkan yang BERLAKU,
  // bukan bawaan kode yang kebetulan ada di memori proses ini.
  await muatPemetaan();
  const diaturAdmin = new Set(pemetaanTersimpan().map((b) => b.kualitas));

  // BENTUKNYA DISAMAKAN DENGAN /admin.
  //
  // Halaman ini memakai max-w-4xl + p-6 sementara /admin memakai lebar cangkang
  // + p-4, dan keduanya berdampingan lewat satu tautan. Berpindah di antara dua
  // halaman yang paginya berbeda membuat isinya seolah melompat — itu yang
  // Brian sebut "tidak beraturan".
  return (
    <main className="space-y-5 p-4">
      {/* Tautan kembali DI ATAS judul, bukan di sebelahnya: berdampingan, ia
          menekan judul jadi dua baris di lebar ponsel dan berdesakan dengan
          kalimat penjelasnya. */}
      <Link href="/admin" className="inline-flex min-h-[36px] items-center text-sm font-semibold text-zinc-500">
        ← Admin
      </Link>
      <header className="space-y-1 border-b border-zinc-200 pb-3">
        <h1 className="font-display text-xl font-bold text-zinc-900">Paket &amp; Harga</h1>
        <p className="text-xs leading-relaxed text-zinc-500">
          Kredit dihitung per jenis video. Kredit dari paket habis saat masa berlakunya berakhir;
          kredit satuan tidak pernah hangus.
        </p>
      </header>

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-bold text-zinc-900">Harga kredit satuan</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Harga yang dibayar pembeli untuk SATU video jenis ini di luar paket.
          </p>
        </div>
        {/* Dua kolom, bukan tiga. sm:grid-cols-3 memaksa tiga kartu berdesakan
            di lebar cangkang, dan harganya — yang justru isi kartunya — jadi
            terpotong. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {JENIS_VIDEO.map((j) => (
            <div
              key={j}
              // Jenis yang BELUM diatur diberi garis merah, bukan cuma tulisan
              // merah: ia berarti pembeli tidak bisa membeli jenis itu sama
              // sekali, dan keadaan itu pantas terlihat sebelum dibaca.
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                harga[j] ? "border-zinc-200" : "border-l-4 border-l-red-500 border-zinc-200"
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {KUALITAS[j].label}
              </p>
              {harga[j] ? (
                <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none text-zinc-900">
                  {rupiah(harga[j] as number)}
                  <span className="ml-1 text-xs font-medium text-zinc-400">/video</span>
                </p>
              ) : (
                <p className="mt-1.5 font-display text-lg font-bold leading-tight text-red-700">
                  Belum diatur
                </p>
              )}
              <p className="mt-2 text-xs text-zinc-500">
                {harga[j]
                  ? `${KUALITAS[j].resolusi} · ${KUALITAS[j].jelas}`
                  : "Tidak bisa dibeli satuan sampai harganya diisi."}
              </p>
            </div>
          ))}
        </div>
      </section>

      <PemetaanModel
        awal={(Object.keys(KUALITAS) as Kualitas[]).map((k) => ({
          kualitas: k,
          label: KUALITAS[k].label,
          mesin: mesinBerlaku(k),
          model: modelBerlaku(k),
          bawaan: !diaturAdmin.has(k),
          mesin_bawaan: KUALITAS[k].mesin,
          model_bawaan: KUALITAS[k].model,
        }))}
        katalog={KATALOG_MODEL.map((m) => ({ id: m.id, label: m.label, mesin: m.mesin, tarif: m.tarif, catatan: m.catatan }))}
      />

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
