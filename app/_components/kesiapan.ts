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

/** Satu tabel keputusan untuk SEMUA CTA utama. */
export function ajakan(status: Kesiapan): AjakanCta {
  switch (status) {
    case "terbuka":
      return { label: "Bikin video pertama — gratis", href: "/onboarding#daftar", mulaiDaftar: true, catatan: "" };
    case "tertutup":
      return {
        label: "Lihat contoh skripnya — tanpa daftar",
        href: "/coba",
        mulaiDaftar: false,
        catatan: "Pembuatan video sedang ditutup sementara — kami sedang merapikan mesinnya.",
      };
    case "tidak-sehat":
      return {
        label: "Lihat contoh skripnya — tanpa daftar",
        href: "/coba",
        mulaiDaftar: false,
        catatan: "Kami belum bisa memastikan ketersediaan sistem saat ini.",
      };
    default:
      // Keadaan "memuat" HARUS tetap CTA yang berfungsi tanpa JavaScript:
      // ini yang dirender server, dan bila hidrasi mati (kelas kegagalan yang
      // benar-benar pernah terjadi di dev), inilah satu-satunya tombol yang
      // dilihat pengunjung. Tautan /coba bekerja murni lewat <a href>.
      return { label: "Lihat contoh skripnya — tanpa daftar", href: "/coba", mulaiDaftar: false, catatan: "" };
  }
}
