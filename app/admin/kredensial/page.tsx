import Link from "next/link";
import { wajibAdmin } from "@/lib/admin-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { daftarKredensial, pastikanLingkunganDuitku, redirectUriGoogleTerdaftar, statusLingkunganDuitku } from "@/lib/kredensial";
import { config } from "@/lib/config";
import type { BarisTampilan } from "@/lib/kredensial-tipe";
import { FormKredensial } from "./FormKredensial";

// KREDENSIAL PARTNER — satu-satunya halaman admin yang MENULIS.
//
// Sisanya baca-saja karena sistem ini belum punya konsep peran. Halaman ini
// jadi pengecualian dengan alasan yang jelas: mengganti API key lewat SSH
// memaksa restart container, dan restart di tengah antrean render membunuh
// job yang sedang berjalan.
//
// Batas yang menjaganya tetap aman:
//   - nilai rahasia TIDAK PERNAH dikirim utuh ke layar, hanya 4 karakter akhir
//   - tersimpan terenkripsi AES-256-GCM, kunci diturunkan dari AUTH_SECRET
//   - audit mencatat siapa mengganti apa, TIDAK PERNAH nilainya
//   - mengosongkan kolom = kembali ke nilai .env, bukan menghapus kemampuan

export const dynamic = "force-dynamic";

const URUTAN: BarisTampilan["kelompok"][] = ["Video & AI", "Pembayaran", "Email & Login", "Penyimpanan"];

export default async function HalamanKredensial() {
  const user = await wajibAdmin();

  if (!postgresRuntimeEnabled()) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <h1 className="font-display text-xl font-bold">Kredensial</h1>
        <p className="mt-2 text-zinc-600">Postgres tidak aktif — halaman ini hanya berguna di produksi.</p>
      </main>
    );
  }

  const baris = await daftarKredensial();
  // Tanpa jaringan bila pasangan kunci sudah dikenali; kalau belum, halaman
  // ini justru tempat yang tepat untuk bertanya ke Duitku.
  await pastikanLingkunganDuitku();
  const duitku = statusLingkunganDuitku();
  const dariDb = baris.filter((b) => b.sumber === "database").length;
  const kosong = baris.filter((b) => b.sumber === "kosong").length;

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-xl font-bold text-zinc-900">Kredensial partner</h1>
          <Link href="/admin" className="text-xs font-semibold text-amber-700 underline underline-offset-2">
            ← kembali ke admin
          </Link>
        </div>
        <p className="text-xs text-zinc-500">
          Masuk sebagai {user.email} · {dariDb} dari database, {baris.length - dariDb - kosong} dari .env, {kosong} kosong
        </p>
      </header>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <b>Berlaku tanpa restart.</b> Perubahan langsung dipakai proses web, dan menyusul di worker
        paling lambat 30 detik. Mengosongkan kolom mengembalikan nilainya ke <code>.env</code> server —
        bukan mematikan fiturnya.
      </div>

      {URUTAN.map((kelompok) => {
        const isi = baris.filter((b) => b.kelompok === kelompok);
        if (isi.length === 0) return null;
        return (
          <section key={kelompok} className="space-y-2">
            <h2 className="text-sm font-bold text-zinc-900">{kelompok}</h2>
            <div className="space-y-2">
              {isi.map((b) => (
                <FormKredensial key={b.nama} baris={b} />
              ))}
            </div>
            {kelompok === "Pembayaran" && duitku.terpasang && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                <p className="flex flex-wrap items-center gap-2">
                  <b className="text-zinc-900">Lingkungan Duitku</b>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                      duitku.lingkungan === "production" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {duitku.lingkungan.toUpperCase()}
                  </span>
                  <span className="font-mono text-[11px]">{duitku.merchant}</span>
                </p>
                <p className="mt-1">
                  {duitku.sumber === "terdeteksi" ? (
                    <>
                      Dikenali otomatis oleh Duitku untuk kode merchant dan API key di atas
                      {duitku.diperiksa_at && <> · diperiksa {duitku.diperiksa_at.slice(0, 16).replace("T", " ")} UTC</>}. Tidak
                      bergantung pada <code>DUITKU_IS_PRODUCTION</code>.
                    </>
                  ) : (
                    <>
                      Belum dikenali Duitku — sementara memakai <code>DUITKU_IS_PRODUCTION</code> dari .env.
                      {duitku.galat && <span className="mt-1 block text-red-600">{duitku.galat}</span>}
                    </>
                  )}
                </p>
                {duitku.kanal.length > 0 && (
                  <p className="mt-1">
                    Kanal aktif di merchant ini:{" "}
                    {duitku.kanal.map((k) => `${k.nama}${k.biayaIdr > 0 ? ` (biaya Rp${k.biayaIdr.toLocaleString("id-ID")})` : ""}`).join(", ")}
                  </p>
                )}
                <p className="mt-2">
                  <b>Callback URL</b> untuk didaftarkan di proyek Duitku:
                </p>
                <p className="mt-1 select-all break-all rounded-lg border border-zinc-300 bg-white p-2 font-mono text-[11px] text-zinc-900">
                  {config.appBaseUrl ? `${config.appBaseUrl.replace(/\/+$/, "")}/api/webhooks/duitku` : "APP_BASE_URL belum diisi di server."}
                </p>
              </div>
            )}
            {kelompok === "Email & Login" && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                <p>
                  <b>Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs</b> wajib
                  memuat <b>setiap</b> alamat di bawah ini <b>persis</b>, tanpa garis miring di akhir. Satu baris =
                    satu entri. Semuanya wajib ada: redirect_uri mengikuti domain yang sedang dibuka
                    pengunjung, jadi domain yang alamatnya belum didaftarkan tidak bisa dipakai login Google.
                </p>
                <p className="mt-1.5 select-all whitespace-pre-line break-all rounded-lg border border-zinc-300 bg-white p-2 font-mono text-[11px] text-zinc-900">
                  {redirectUriGoogleTerdaftar().join("\n") ||
                    "APP_BASE_URL belum diisi di server — alamatnya belum bisa dipastikan."}
                </p>
                <p className="mt-1.5">
                  Beda satu karakter pun ditolak Google dengan <code>Error 400: redirect_uri_mismatch</code>,
                  dan penolakannya terjadi sebelum server kita tersentuh — jadi tidak ada log di sisi kita
                  yang bisa menunjukkan penyebabnya.
                </p>
              </div>
            )}
          </section>
        );
      })}

      <p className="text-[11px] leading-5 text-zinc-500">
        Nilai rahasia disimpan terenkripsi dan tidak pernah ditampilkan utuh — hanya empat karakter
        terakhir, cukup untuk memastikan yang terpasang memang yang Anda maksud. Catatan audit
        merekam siapa mengganti apa, tidak pernah nilainya.
      </p>
    </main>
  );
}
