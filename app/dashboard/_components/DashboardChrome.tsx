"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CircleHelp, FolderKanban, Grid3x3, Home, LayoutTemplate, Library, Menu, Send, Users, UserRound, Zap, Images } from "lucide-react";
import { tokens } from "./format";
import { SidebarLogout } from "./ProfileActions";

// Desktop-first shell (F-ENT-01, 2026-08-11) — deliberately NOT app/_components/
// SiteChrome (that's mobile bottom-tab, max-w-md, wrong context entirely).
// Visual bar: Higgsfield-style — dark sidebar, clean light content area.
// M5 (visual polish pass): real icon set (lucide-react, not raw Unicode
// glyphs), active-route highlight, hover transitions — "client" so
// usePathname can drive the active state.
// Empat tujuan, bukan dua. Library dan Profil ditambahkan atas permintaan
// Brian 2026-08-11: hasil video sebelumnya cuma bisa dijangkau lewat halaman
// per-kampanye (jadi video lama praktis hilang), dan tidak ada satu pun tempat
// untuk melihat akun, saldo, atau keluar.
const NAV = [
  { href: "/dashboard", label: "Beranda", icon: Home, disabled: false },
  { href: "/dashboard/campaign", label: "Bikin Video", icon: Zap, disabled: false },

  { href: "/dashboard/templates", label: "Templates", icon: LayoutTemplate, disabled: false },
  { href: "/dashboard/projects", label: "Proyek", icon: FolderKanban, disabled: false },
  { href: "/dashboard/library", label: "Library", icon: Library, disabled: false },
  // Assets DI BAWAH Library karena keduanya "barang yang sudah ada": Library
  // hasil videonya, Assets bahan bakunya.
  { href: "/dashboard/assets", label: "Assets", icon: Images, disabled: false },
  { href: "/dashboard/publish", label: "Posting", icon: Send, disabled: false },
  { href: "/dashboard/team", label: "Tim", icon: Users, disabled: false },
  { href: "/dashboard/profile", label: "Profil", icon: UserRound, disabled: false },
] as const;

// Bantuan dipisah ke kaki sidebar, bukan ikut daftar utama: ia bukan tempat
// kerja, tapi jaring pengaman. Menaruhnya sejajar dengan Beranda membuat
// daftar navigasi terasa dua kali lebih panjang tanpa alasan.
const FOOTER_NAV = { href: "/dashboard/support", label: "Bantuan", icon: CircleHelp } as const;

// Matriks TIDAK ada di NAV tetap. Ia ditambahkan saat runtime hanya kalau
// fiturnya menyala (lihat matrixEnabled di bawah) — board menahannya sampai
// approval naskah, konfirmasi belanja, dan idempotensi selesai.
export function DashboardChrome({
  orgName,
  balanceIdr,
  userEmail,
  /** Harga satu video bersuara. Dikirim dari layout (Server Component) yang
   *  membacanya dari config — komponen ini "use client" dan tidak boleh
   *  menyalin tarif, karena salinan tarif pasti hanyut. */
  hargaVideoIdr,
  children,
}: {
  orgName: string;
  balanceIdr: number;
  userEmail: string | null;
  hargaVideoIdr: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  /**
   * Laci navigasi untuk layar kecil.
   *
   * Shell ini dibuat desktop-first dengan sengaja (brand/agency bekerja di
   * laptop), tapi di Indonesia tautan dashboard paling sering dibuka dari
   * WhatsApp — di HP. Tanpa laci, seluruh navigasi hilang di layar kecil dan
   * pengguna terjebak di halaman mana pun yang pertama ia buka.
   */
  const [laciBuka, setLaciBuka] = useState(false);
  // Menutup sendiri saat pindah halaman: laci yang tetap terbuka menutupi
  // konten yang baru saja diminta pengguna.
  useEffect(() => { setLaciBuka(false); }, [pathname]);

  return (
    <div className="flex min-h-dvh w-full bg-zinc-50 text-zinc-900">
      {/* Latar gelap saat laci terbuka — tap di luar untuk menutup. */}
      {laciBuka && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setLaciBuka(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-zinc-950 text-zinc-100 transition-transform duration-200 md:static md:translate-x-0 ${
          laciBuka ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
          <span className="text-base font-bold tracking-tight">
            BikinFYP <span className="text-amber-400">Brands</span>
          </span>
        </div>
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Organisasi</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{orgName}</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
            const Icon = item.icon;
            return item.disabled ? (
              <span
                key={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600"
                title="Segera hadir"
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {item.label}
                <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                  Segera
                </span>
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  active ? "bg-amber-400/10 text-amber-300" : "text-zinc-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-2">
          <Link
            href={FOOTER_NAV.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
              pathname?.startsWith(FOOTER_NAV.href) ? "bg-amber-400/10 text-amber-300" : "text-zinc-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <FOOTER_NAV.icon size={18} strokeWidth={2} aria-hidden="true" />
            {FOOTER_NAV.label}
          </Link>
        </div>
        <div className="border-t border-white/10 p-3">
          <Link
            href="/dashboard/credits"
            className="block rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Token</p>
            <p className="mt-1 truncate font-display text-lg font-bold text-white">{tokens(balanceIdr)}</p>
            {/* Saldo diterjemahkan jadi satuan yang berarti. "84.000 token"
                tidak memberi tahu apa pun; "≈ 7 video" langsung menjawab
                pertanyaan yang sebenarnya ada di kepala brand. Pola ini
                diambil dari Higgsfield yang menampilkan kuota sebagai "3 free
                generations", bukan angka saldo.
                Dibulatkan KE BAWAH: menjanjikan video yang tidak terbayar
                lebih buruk daripada kelihatan pelit. */}
            {hargaVideoIdr > 0 && balanceIdr >= hargaVideoIdr && (
              <p className="mt-0.5 text-[11px] text-zinc-400">
                ≈ {Math.floor(balanceIdr / hargaVideoIdr)} video bersuara
              </p>
            )}
            <p className="mt-0.5 text-[11px] font-semibold text-amber-400">Tambah token</p>
          </Link>
          {userEmail && (
            <Link
              href="/dashboard/profile"
              className="mt-2 block truncate rounded-lg px-2 py-2 text-xs text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
            >
              {userEmail}
            </Link>
          )}
          {/* Keluar ada DI CHROME, bukan cuma di halaman Profil (permintaan
              Brian 2026-08-12: tombol keluar untuk setiap user yang login).
              Terkubur satu klik di dalam halaman lain bukan "ada" — di
              perangkat bersama, keluar harus selalu terjangkau. */}
          <SidebarLogout />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {/* Bar atas HANYA di layar kecil: satu tombol menu, satu identitas. */}
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setLaciBuka(true)}
            aria-label="Buka menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700"
          >
            <Menu size={18} />
          </button>
          <span className="truncate text-sm font-bold">
            BikinFYP <span className="text-amber-500">Brands</span>
          </span>
          <Link href="/dashboard/credits" className="ml-auto text-xs font-semibold text-amber-600">
            {tokens(balanceIdr)}
          </Link>
        </div>
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}
