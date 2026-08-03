"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditChip } from "./CreditChip";

const NO_CHROME = ["/onboarding"];
const NO_NAV_PREFIX = ["/bikin", "/onboarding"];

/** Header + nav bawah global. Disembunyikan di layar tertentu. */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideAll = NO_CHROME.some((p) => pathname.startsWith(p));
  const hideNav = NO_NAV_PREFIX.some((p) => pathname.startsWith(p));

  if (hideAll) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-100 bg-white px-4">
        <Link href="/" className="text-lg font-bold tracking-tight text-zinc-900">
          BikinFYP <span className="text-amber-500">AI</span>
        </Link>
        <CreditChip />
      </header>
      <div className="flex-1 pb-20">{children}</div>
      {!hideNav && (
        <nav className="fixed bottom-0 left-1/2 z-10 flex w-full max-w-md -translate-x-1/2 border-t border-zinc-100 bg-white">
          <NavItem href="/" label="Beranda" icon="🏠" active={pathname === "/"} />
          <NavItem href="/video" label="Video" icon="📼" active={pathname.startsWith("/video")} />
          <NavItem href="/kredit" label="Kredit" icon="⚡" active={pathname.startsWith("/kredit")} />
        </nav>
      )}
    </div>
  );
}

function NavItem({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
        active ? "font-bold text-amber-600" : "text-zinc-500"
      }`}
    >
      <span className="text-xl">{icon}</span>
      {label}
    </Link>
  );
}
