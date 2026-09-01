import Link from "next/link";
import { wajibAdmin } from "@/lib/admin-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { daftarKredensial } from "@/lib/kredensial";
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
