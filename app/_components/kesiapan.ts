"use client";

import { useEffect, useState } from "react";

/**
 * KESIAPAN SISTEM untuk seluruh CTA — satu sumber, empat keadaan.
 *
 * KENAPA ADA (audit ulang 18 Agu, READY-01/READY-02).
 *
 * Versi pertama menaruh pemeriksaan health di hero atas saja, dan memakai
 * boolean. Dua cacat lahir dari situ:
 *
 *   SATU HALAMAN, DUA JAWABAN. CTA bawah tetap berkata "Bikin video pertama —
 *   gratis" saat intake ditutup, sementara CTA atas sudah mengarah ke demo.
 *
 *   GAGAL TERBUKA. Boolean-nya mulai dari false = "intake terbuka", jadi
 *   health yang timeout, 503, atau JSON-nya tidak terbaca semuanya dibaca
 *   sebagai "silakan daftar". Untuk operasi yang mengeluarkan uang, ketidak-
 *   tahuan harus membaca sebagai tidak-tahu, bukan sebagai izin.
 */
export type Kesiapan = "memuat" | "terbuka" | "tertutup" | "tidak-sehat";

export function useKesiapan(): Kesiapan {
  const [status, setStatus] = useState<Kesiapan>("memuat");

  useEffect(() => {
    let batal = false;
    const kendali = new AbortController();
    // Batas waktu sendiri: health yang menggantung tidak boleh membuat CTA
    // tertahan di "memuat" selamanya.
    const jam = setTimeout(() => kendali.abort(), 6000);
    fetch("/api/health", { signal: kendali.signal })
      .then(async (r) => {
        if (!r.ok) return "tidak-sehat" as const;
        const d = await r.json().catch(() => null);
        if (!d || typeof d.intake !== "string") return "tidak-sehat" as const;
        return d.intake === "open" ? ("terbuka" as const) : ("tertutup" as const);
      })
      .then((s) => { if (!batal) setStatus(s); })
      .catch(() => { if (!batal) setStatus("tidak-sehat"); })
      .finally(() => clearTimeout(jam));
    return () => { batal = true; kendali.abort(); clearTimeout(jam); };
  }, []);

  return status;
}

export interface AjakanCta {
  label: string;
  href: string;
  /** true = tombol memulai alur daftar di halaman ini, bukan pindah halaman. */
  mulaiDaftar: boolean;
  /** Kalimat kecil di bawah tombol. Kosong = tidak perlu penjelasan. */
  catatan: string;
}

/**
 * Satu tabel keputusan untuk SEMUA CTA utama.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MENDAFTAR TIDAK LAGI DIIKAT PADA IZIN MERENDER (2 Sep 2026).
 * ────────────────────────────────────────────────────────────────────────────
 * Versi sebelumnya mengganti SETIAP CTA utama dengan "Lihat contoh skripnya"
 * begitu intake ditutup. Akibatnya, selama JOB_INTAKE_MODE=closed, seluruh
 * landing page tidak punya satu pun jalan menuju pendaftaran — pengunjung yang
 * sudah yakin pun digiring ke jalur yang tidak menghasilkan akun.
 *
 * Itu mencampur dua hal yang berbeda. Intake tertutup berarti VIDEO belum bisa
 * dirender; ia tidak berarti orang tidak boleh punya akun. Mereka masih bisa
 * mendaftar, menyiapkan produk, dan menunggu — dan kita tidak kehilangan
 * pendaftar hanya karena mesin sedang dirapikan.
 *
 * Jadi CTA utama SELALU mengajak mendaftar. Yang berubah menurut kesiapan
 * hanyalah KALIMAT JUJURNYA di bawah tombol.
 */
export function ajakan(status: Kesiapan): AjakanCta {
  switch (status) {
    case "terbuka":
      return { label: "Bikin video pertama — gratis", href: "/onboarding#daftar", mulaiDaftar: true, catatan: "" };
    case "tertutup":
      return {
        label: "Daftar gratis — 1 video demo",
        href: "/onboarding#daftar",
        mulaiDaftar: true,
        catatan: "Pembuatan video sedang ditutup sementara. Daftar sekarang, kami kabari begitu dibuka.",
      };
    case "tidak-sehat":
      return {
        label: "Daftar gratis — 1 video demo",
        href: "/onboarding#daftar",
        mulaiDaftar: true,
        catatan: "Kami belum bisa memastikan ketersediaan sistem saat ini.",
      };
    default:
      // Keadaan "memuat" HARUS tetap CTA yang berfungsi tanpa JavaScript:
      // ini yang dirender server, dan bila hidrasi mati (kelas kegagalan yang
      // benar-benar pernah terjadi di dev), inilah satu-satunya tombol yang
      // dilihat pengunjung. Karena itu ia memakai <a href> ke halaman daftar,
      // BUKAN onClick yang menuntut hidrasi.
      return { label: "Daftar gratis — 1 video demo", href: "/onboarding?daftar=1", mulaiDaftar: false, catatan: "" };
  }
}
