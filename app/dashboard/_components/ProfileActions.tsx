"use client";

import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";

// Tombol keluar. Diletakkan di komponen klien tersendiri supaya halaman
// Profil tetap Server Component (butuh query pg langsung).
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
          // Muat ulang penuh, bukan router.push: sesi ada di cookie, dan
          // navigasi klien akan menyajikan halaman dari cache dengan data
          // pengguna yang sudah tidak berlaku.
          window.location.href = "/onboarding";
        } catch {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
      Keluar dari akun
    </button>
  );
}
