"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, pesanUntukPengguna } from "../../_components/api";
import { ErrorText, PrimaryButton } from "../../_components/ui";


/**
 * Pendaftaran mandiri brand (brand.aiugc.id).
 *
 * FORMULIRNYA PENDEK DENGAN SENGAJA. Tabel organizations punya sembilan kolom
 * profil (audiens, elevator pitch, logo, warna, tagline, jenis usaha…), dan
 * meminta semuanya di depan pintu menurunkan pendaftaran tanpa menaikkan mutu
 * peninjauan: yang dibutuhkan admin untuk memutuskan hanya nama, situs, dan
 * kategori. Sisanya diisi di onboarding SESUDAH disetujui, saat orangnya sudah
 * punya alasan untuk menyelesaikannya.
 */
const KATEGORI = [
  "beauty", "fashion", "muslim_fashion", "home", "kitchen", "gadget", "food", "kids", "lainnya",
] as const;

export default function DaftarBrandPage() {
  const router = useRouter();
  const [nama, setNama] = useState("");
  const [website, setWebsite] = useState("");
  const [kategori, setKategori] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/brands/daftar", {
        method: "POST",
        json: { nama, website, kategori },
      });
      // Ke halaman tunggu, BUKAN ke dashboard: organisasinya masih 'pending',
      // dan mengantar ke dashboard hanya membuat requireOrgContext memantulkan
      // balik — pengguna melihat kedipan tanpa penjelasan.
      router.replace("/dashboard/menunggu");
    } catch (err) {
      setError(pesanUntukPengguna(err, "Pendaftarannya gagal. Coba lagi ya."));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 bg-gradient-to-b from-indigo-50/60 via-white to-white px-4 pb-24 pt-8">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">AIUGC.ID Brands</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Daftarkan brand kamu</h1>
        <p className="text-sm leading-6 text-zinc-600">
          Kami tinjau dulu sebelum membuka aksesnya. Biasanya tidak lama, dan kami kabari lewat email.
        </p>
      </header>

      <form onSubmit={kirim} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-zinc-800">Nama brand</span>
          <input
            required
            minLength={2}
            maxLength={80}
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder="Contoh: Kopi Kenangan"
            className="min-h-[44px] w-full rounded-xl border border-zinc-300 px-3 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-zinc-800">
            Website atau toko <span className="font-normal text-zinc-400">(boleh dikosongkan)</span>
          </span>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
            className="min-h-[44px] w-full rounded-xl border border-zinc-300 px-3 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-zinc-800">
            Kategori produk <span className="font-normal text-zinc-400">(boleh dikosongkan)</span>
          </span>
          <select
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
          >
            <option value="">Pilih kategori</option>
            {KATEGORI.map((k) => (
              <option key={k} value={k}>{k.replace("_", " ")}</option>
            ))}
          </select>
        </label>

        {error && <ErrorText message={error} />}

        <PrimaryButton type="submit" disabled={loading || nama.trim().length < 2}>
          {loading ? "Mengirim…" : "Kirim pendaftaran"}
        </PrimaryButton>

        {/* DIKATAKAN DI DEPAN, bukan ditemukan sendiri setelah masuk.
            Brand yang mengira dapat jatah percobaan seperti retail lalu
            menemukan saldonya nol akan merasa dikelabui — dan itu percakapan
            pertama yang paling mahal untuk diperbaiki. */}
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Akun brand mulai dengan saldo token nol. Token diisi setelah brand disetujui — berbeda dengan
          akun retail yang dapat satu video percobaan.
        </p>
      </form>
    </main>
  );
}
