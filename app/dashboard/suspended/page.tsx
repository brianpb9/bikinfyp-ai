// Halaman untuk anggota organisasi yang ditangguhkan.
//
// Dibedakan dari /dashboard/request-access dengan sengaja: mengarahkan pengguna
// tertangguh ke halaman "minta akses" menyembunyikan keadaan sebenarnya dan
// membuatnya mengulang pendaftaran yang tidak akan pernah berhasil.
//
// Nomor kontak diambil dari config, TIDAK diketik di sini — nomor karangan di
// halaman dukungan lebih buruk daripada tidak ada nomor sama sekali.
import { config } from "@/lib/config";

export const metadata = { title: "Organisasi ditangguhkan — AIUGC.ID" };

export default function Suspended() {
  const wa = config.supportWhatsapp.replace(/[^0-9]/g, "");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="font-display text-2xl font-bold text-zinc-900">Organisasi ditangguhkan</h1>
      <p className="text-sm leading-6 text-zinc-600">
        Akses dashboard untuk organisasi ini sedang dihentikan sementara. Data, video,
        dan kredit yang sudah ada tidak dihapus.
      </p>
      <p className="text-sm leading-6 text-zinc-600">
        Biasanya soal penagihan atau verifikasi yang belum selesai.
      </p>
      {wa ? (
        <a
          href={`https://wa.me/${wa}`}
          className="mt-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white"
        >
          Hubungi dukungan
        </a>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          Hubungi tim AIUGC.ID lewat kanal dukungan yang biasa kamu pakai.
        </p>
      )}
    </main>
  );
}
