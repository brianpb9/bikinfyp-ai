import type { ReactNode } from "react";

/**
 * Cangkang khusus /admin.
 *
 * ---------------------------------------------------------------------------
 * KENAPA KELUAR DARI CANGKANG MOBILE
 * ---------------------------------------------------------------------------
 * Brian 9 Sep 2026: "widget terlalu kecil dan jadinya tidak informatif."
 *
 * Sebabnya bukan ukuran kartunya. /admin ikut SiteChrome, yang mengunci lebar
 * ke max-w-md (~430px) dan menempelkan bilah navigasi mobile di bawah — pilihan
 * yang benar untuk aplikasi pembuat video, karena ia memang dipakai di ponsel.
 *
 * Admin tidak. Ia dipakai di depan layar besar untuk membaca tabel dan
 * membandingkan angka, dan memaksanya ke kolom 430px membuat setiap tabel
 * menggulir menyamping serta setiap kartu memuat dua angka per baris. Ruang
 * yang tersisa di layar 1440px terbuang begitu saja.
 *
 * SiteChrome sudah punya daftar NO_CHROME untuk halaman yang tidak boleh
 * memakai cangkang itu. /admin ditambahkan ke sana, dan layout ini yang
 * menggantikannya.
 *
 * Tetap responsif: kartunya menumpuk di ponsel. Yang dibuang cuma pagunya.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-zinc-50">{children}</div>;
}
