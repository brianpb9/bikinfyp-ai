import Link from "next/link";
import type { ReactNode } from "react";
import { rupiah } from "./format";

// Desktop-first shell (F-ENT-01, 2026-08-11) — deliberately NOT app/_components/
// SiteChrome (that's mobile bottom-tab, max-w-md, wrong context entirely).
// Visual bar: Higgsfield-style — dark sidebar, clean light content area.
// M4: Bulk Generate live (F-ENT-01).
const NAV = [
  { href: "/dashboard", label: "Beranda", icon: "⌂", disabled: false },
  { href: "/dashboard/bulk", label: "Bulk Generate", icon: "⚡", disabled: false },
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
          {NAV.map((item) =>
            item.disabled ? (
              <span
                key={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600"
                title="Segera hadir"
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                  Segera
                </span>
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/5"
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            )
          )}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Saldo Org</p>
          <p className="mt-1 truncate font-display text-lg font-bold text-white">{rupiah(balanceIdr)}</p>
          {userEmail && <p className="mt-3 truncate text-xs text-zinc-500">{userEmail}</p>}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
