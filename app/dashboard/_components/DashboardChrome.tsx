"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Home, Library, UserRound, Zap } from "lucide-react";
import { rupiah } from "./format";

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
  { href: "/dashboard/library", label: "Library", icon: Library, disabled: false },
  { href: "/dashboard/profile", label: "Profil", icon: UserRound, disabled: false },
] as const;

export function DashboardChrome({
  orgName,
  balanceIdr,
  userEmail,
  children,
}: {
  orgName: string;
  balanceIdr: number;
  userEmail: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh w-full bg-zinc-50 text-zinc-900">
      <aside className="flex w-64 shrink-0 flex-col bg-zinc-950 text-zinc-100">
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
        <div className="border-t border-white/10 p-3">
          <Link
            href="/dashboard/credits"
            className="block rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Saldo Org</p>
            <p className="mt-1 truncate font-display text-lg font-bold text-white">{rupiah(balanceIdr)}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-amber-400">Tambah kredit</p>
          </Link>
          {userEmail && (
            <Link
              href="/dashboard/profile"
              className="mt-2 block truncate rounded-lg px-2 py-2 text-xs text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
            >
              {userEmail}
            </Link>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
