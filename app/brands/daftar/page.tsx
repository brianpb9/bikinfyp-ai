"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, pesanUntukPengguna } from "../../_components/api";
import { ErrorText } from "../../_components/ui";
import { LogoBrands } from "../../_components/Logo";

/**
 * PENDAFTARAN BRAND — SATU TINDAKAN, BUKAN DUA.
 *
 * ---------------------------------------------------------------------------
 * MASALAH YANG DIPERBAIKI (laporan Brian 7 Sep 2026: "alur registrasi brand
 * harusnya berbeda dengan retail, tapi prosesnya sama")
 * ---------------------------------------------------------------------------
 * Ia benar secara harfiah. Sebelum ini calon brand dikirim ke /onboarding —
 * KOMPONEN YANG SAMA dengan retail, kolom yang sama (email saja), langkah yang
 * sama. Yang berbeda cuma warna dan satu kalimat.
 *
 * Dan bentuknya salah, bukan cuma tampilannya:
 *
 * 1. DUA PENDAFTARAN YANG DISAJIKAN SEBAGAI SATU. Orang mengira sedang
 *    mendaftarkan brand-nya; yang sebenarnya terjadi ia membuat akun PRIBADI,
 *    lalu ditolak masuk karena belum punya organisasi.
 *
 * 2. LAYAR PENOLAKAN ITU TERBACA SEPERTI GALAT. /dashboard/request-access
 *    berbunyi "Akun kamu belum terhubung ke organisasi" — kalimat yang benar
 *    untuk anggota tim yang undangannya gagal, tapi salah total untuk orang
 *    yang baru saja mendaftar dengan sengaja.
 *
 * 3. DATA BRAND DIMINTA PALING AKHIR. Nama perusahaan, situs, dan kategori —
 *    hal yang membuat mereka brand — baru ditanya di layar keenam, sesudah
 *    mereka terlanjur membuat akun. Untuk penjualan B2B urutannya terbalik:
 *    yang layak disaring dulu, verifikasi belakangan.
 *
 * ---------------------------------------------------------------------------
 * ALUR YANG BENAR
 * ---------------------------------------------------------------------------
 *   1. Satu formulir: brand + email penanggung jawab.
 *   2. Kode verifikasi ke email itu.
 *   3. Selesai — "sedang kami tinjau".
 *
 * Akun DAN organisasi lahir dari satu tindakan. Tidak ada layar "kamu belum
 * punya organisasi", karena organisasinya dibuat di detik yang sama dengan
 * akunnya.
 *
 * PEMULIHAN kalau tab ditutup di antara verifikasi dan pembuatan organisasi:
 * isian disimpan di sessionStorage dan dikirim ulang saat halaman dibuka lagi.
 * Kalau itu pun gagal, /dashboard/request-access tetap ada — dan di sanalah ia
 * memang berguna: sebagai jalan pemulihan, bukan sebagai jalan utama.
 */
const KATEGORI = [
  "beauty", "fashion", "muslim_fashion", "home", "kitchen", "gadget", "food", "kids", "lainnya",
] as const;

const SIMPANAN = "aiugc.brand.daftar";

type Isian = { nama: string; website: string; kategori: string; email: string };

export default function DaftarBrandPage() {
  const router = useRouter();
  const [langkah, setLangkah] = useState<1 | 2>(1);
  const [isian, setIsian] = useState<Isian>({ nama: "", website: "", kategori: "", email: "" });
  const [kode, setKode] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  // Isian dipulihkan kalau halaman sempat tertutup — termasuk kalau ia tertutup
  // SESUDAH verifikasi berhasil tapi SEBELUM organisasinya sempat dibuat.
  useEffect(() => {
    try {
      const t = sessionStorage.getItem(SIMPANAN);
      if (t) setIsian((s) => ({ ...s, ...(JSON.parse(t) as Partial<Isian>) }));
    } catch { /* penyimpanan sesi diblokir browser */ }
  }, []);

  function simpan(next: Isian) {
    setIsian(next);
    try { sessionStorage.setItem(SIMPANAN, JSON.stringify(next)); } catch { /* diabaikan */ }
  }

  async function kirimData(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    setGalat(null);
    try {
      await apiFetch("/api/auth/request-otp", { json: { email: isian.email.trim() } });
      setLangkah(2);
    } catch (err) {
      setGalat(pesanUntukPengguna(err, "Gagal mengirim kode. Coba lagi ya."));
    } finally {
      setSibuk(false);
    }
  }

  async function verifikasi(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    setGalat(null);
    try {
      await apiFetch("/api/auth/verify-otp", { json: { email: isian.email.trim(), code: kode.trim() } });
      // Organisasi dibuat SEKARANG, di tindakan yang sama. Inilah yang membuat
      // alur ini satu pendaftaran, bukan dua.
      await apiFetch("/api/brands/daftar", {
        json: { nama: isian.nama.trim(), website: isian.website.trim(), kategori: isian.kategori },
      });
      try { sessionStorage.removeItem(SIMPANAN); } catch { /* diabaikan */ }
      router.replace("/dashboard/menunggu");
    } catch (err) {
      // Verifikasi mungkin SUDAH berhasil dan yang gagal pembuatan organisasinya.
      // Mengirim orang ke request-access di situ benar: di sana ada tombol
      // "Daftarkan brand kamu", dan isiannya masih tersimpan.
      setGalat(pesanUntukPengguna(err, "Kodenya salah atau sudah kedaluwarsa. Coba lagi ya."));
      setSibuk(false);
    }
  }

  const bolehLanjut =
    isian.nama.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(isian.email.trim());

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-7 bg-gradient-to-b from-amber-50/60 via-white to-white px-5 pb-24 pt-8">
      <header className="space-y-3">
        <LogoBrands tinggi={26} />
        <h1 className="font-display text-2xl font-bold leading-tight text-zinc-900">
          {langkah === 1 ? "Daftarkan brand kamu" : "Masukkan kode verifikasi"}
        </h1>
        <p className="text-sm leading-6 text-zinc-600">
          {langkah === 1
            ? "Satu langkah. Kami tinjau pendaftarannya sebelum membuka akses dashboard."
            : <>Kami kirim 6 digit ke <b className="text-zinc-900">{isian.email}</b>.</>}
        </p>
      </header>

      {langkah === 1 ? (
        <form onSubmit={kirimData} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-zinc-800">Nama brand</span>
            <input
              required minLength={2} maxLength={80}
              value={isian.nama}
              onChange={(e) => simpan({ ...isian, nama: e.target.value })}
              placeholder="Contoh: Kopi Kenangan"
              className="min-h-[48px] w-full rounded-xl border border-zinc-300 px-3 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-semibold text-zinc-800">
              Website atau toko <span className="font-normal text-zinc-400">(opsional)</span>
            </span>
            <input
              value={isian.website}
              onChange={(e) => simpan({ ...isian, website: e.target.value })}
              placeholder="https://…"
              className="min-h-[48px] w-full rounded-xl border border-zinc-300 px-3 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-semibold text-zinc-800">
              Kategori produk <span className="font-normal text-zinc-400">(opsional)</span>
            </span>
            <select
              value={isian.kategori}
              onChange={(e) => simpan({ ...isian, kategori: e.target.value })}
              className="min-h-[48px] w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
            >
              <option value="">Pilih kategori</option>
              {KATEGORI.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-semibold text-zinc-800">Email penanggung jawab</span>
            <input
              required type="email" inputMode="email"
              value={isian.email}
              onChange={(e) => simpan({ ...isian, email: e.target.value })}
              placeholder="nama@perusahaan.com"
              className="min-h-[48px] w-full rounded-xl border border-zinc-300 px-3 text-sm"
            />
            <span className="block text-[11px] text-zinc-500">
              Kode verifikasi dikirim ke sini. Alamat ini juga jadi pemilik akun brand.
            </span>
          </label>

          {galat && <ErrorText message={galat} />}

          <button
            type="submit"
            disabled={sibuk || !bolehLanjut}
            className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-zinc-900 px-6 text-base font-bold text-white shadow-lg shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none"
          >
            {sibuk ? "Mengirim kode…" : "Lanjut — kirim kode verifikasi"}
          </button>

          {/* DIKATAKAN DI DEPAN, bukan ditemukan sendiri setelah masuk. Brand
              yang mengira dapat jatah percobaan seperti retail lalu menemukan
              saldonya nol akan merasa dikelabui — dan itu percakapan pertama
              yang paling mahal untuk diperbaiki. */}
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Akun brand mulai dengan saldo token nol — berbeda dengan akun retail yang dapat satu video
            percobaan. Token diisi setelah pendaftaran disetujui.
          </p>
        </form>
      ) : (
        <form onSubmit={verifikasi} className="space-y-4">
          <input
            autoFocus required inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={kode}
            onChange={(e) => setKode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="min-h-[56px] w-full rounded-xl border border-zinc-300 px-3 text-center font-display text-2xl tracking-[0.4em]"
          />
          {galat && <ErrorText message={galat} />}
          <button
            type="submit"
            disabled={sibuk || kode.length !== 6}
            className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-zinc-900 px-6 text-base font-bold text-white shadow-lg shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none"
          >
            {sibuk ? "Memeriksa…" : "Verifikasi & daftarkan brand"}
          </button>
          <button
            type="button"
            onClick={() => { setLangkah(1); setGalat(null); }}
            className="min-h-[44px] w-full text-center text-sm text-zinc-500"
          >
            Ganti data atau email
          </button>
        </form>
      )}

      <p className="text-center text-sm text-zinc-500">
        Sudah punya akun brand?{" "}
        <Link href="/onboarding?audience=brand&next=%2Fdashboard" className="font-semibold text-amber-600">
          Masuk di sini
        </Link>
      </p>
    </main>
  );
}
