"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

// Menu akun retail — sebelum ini pengguna retail TIDAK PUNYA cara keluar sama
// sekali. Tombol keluar cuma ada di dashboard brand; siapa pun yang login di
// bikinfyp.com terjebak sampai cookie-nya kedaluwarsa sendiri. Di ponsel
// bersama (warung, keluarga) itu bukan ketidaknyamanan, itu masalah keamanan.
//
// Ditaruh di header SiteChrome supaya ada di SETIAP halaman yang login, bukan
// dikubur di satu halaman yang harus dicari dulu.
export function AccountMenu() {
  const [buka, setBuka] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [keluar, setKeluar] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Kalau belum login, endpoint ini gagal dan menunya tidak ditampilkan —
    // itu perilaku yang benar: halaman anon tidak butuh tombol keluar.
    apiFetch<{ user: { email: string | null; phone: string | null } }>("/api/auth/me")
      .then((d) => setEmail(d.user.email ?? d.user.phone ?? "Akun saya"))
      .catch(() => setEmail(null));
  }, []);

  // Tutup saat menyentuh di luar. Tanpa ini menu menggantung di atas konten
  // dan menghalangi tombol lain — di layar sempit itu terasa seperti macet.
  useEffect(() => {
    if (!buka) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [buka]);

  if (!email) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setBuka((v) => !v)}
        aria-label="Menu akun"
        aria-expanded={buka}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white"
      >
        {email.slice(0, 1).toUpperCase()}
      </button>
      {buka && (
        <div className="absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
          <p className="truncate border-b border-zinc-100 px-4 py-3 text-xs text-zinc-500">{email}</p>
          <button
            onClick={async () => {
              setKeluar(true);
              try {
                await fetch("/api/auth/logout", { method: "POST" });
                // Muat ulang penuh, bukan router.push: sesi ada di cookie, dan
                // navigasi klien akan menyajikan halaman dari cache dengan data
                // pengguna yang sudah tidak berlaku.
                window.location.href = "/onboarding";
              } catch {
                setKeluar(false);
              }
            }}
            disabled={keluar}
            className="flex min-h-[48px] w-full items-center px-4 text-left text-sm font-semibold text-red-600 active:bg-red-50 disabled:opacity-50"
          >
            {keluar ? "Keluar..." : "Keluar dari akun"}
          </button>
        </div>
      )}
    </div>
  );
}
