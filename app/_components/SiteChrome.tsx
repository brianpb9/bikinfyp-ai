"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { CreditChip } from "./CreditChip";
import { AccountMenu } from "./AccountMenu";

/** Getar haptic halus tiap tap tombol/link (Android Chrome; iOS mengabaikan
 * navigator.vibrate tanpa error). Bagian dari juice tombol — Brian 2026-08-07:
 * "tekan tombol ga satisfying". Dipasang global sekali di SiteChrome.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA PENJAGA userActivation
 * ---------------------------------------------------------------------------
 * Dilaporkan Brian 7 Sep 2026 dari console:
 *
 *   [Intervention] Blocked call to navigator.vibrate because user hasn't
 *   tapped on the frame or any embedded frame yet
 *
 * Chrome menolak vibrate() sampai halamannya pernah benar-benar disentuh. Kita
 * memanggilnya di `pointerdown` — dan pada tap PERTAMA sesudah halaman dimuat,
 * aktivasi penggunanya belum tercatat. Jadi panggilan itu SELALU ditolak sekali
 * per halaman.
 *
 * try/catch tidak menolongnya: ini bukan lemparan, melainkan intervensi yang
 * ditulis Chrome ke console. Jadi yang terjadi tiap sesi: satu baris peringatan
 * yang tidak bisa ditekan, dan tap pertama yang memang tidak pernah bergetar.
 *
 * navigator.userActivation.hasBeenActive menjawab persis pertanyaan itu —
 * "halaman ini sudah pernah disentuh?" — jadi panggilannya dilewati saat kita
 * sudah tahu ia akan ditolak. Tap kedua dan seterusnya tetap bergetar seperti
 * sebelumnya. Browser tanpa userActivation (Safari lama) dibiarkan lewat: di
 * sana vibrate memang tidak ada dan `?.` sudah menanganinya.
 */
function useTapHaptics() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.("button, a, [role=button]")) {
        const aktivasi = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
        if (aktivasi && !aktivasi.hasBeenActive) return;
        try { navigator.vibrate?.(8); } catch { /* browser tanpa izin vibrate */ }
      }
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}

// /dashboard (2026-08-11, F-ENT-01): desktop-first enterprise dashboard,
// punya chrome sendiri (DashboardChrome) — bottom-tab mobile ini salah konteks total.
const NO_CHROME = ["/onboarding", "/coba", "/mulai", "/dashboard", "/brands", "/harga"]; // halaman anon (magic moment & quiz iklan) — chip kredit & nav menyesatkan
const NO_NAV_PREFIX = ["/bikin", "/onboarding"];

/** Header + nav bawah global. Disembunyikan di layar tertentu. */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideAll = NO_CHROME.some((p) => pathname.startsWith(p));
  const hideNav = NO_NAV_PREFIX.some((p) => pathname.startsWith(p));
  useTapHaptics();

  if (hideAll) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-100 bg-white px-4">
        <Link href="/" className="text-lg font-bold tracking-tight text-zinc-900">
          AIUGC.ID <span className="text-amber-500">AI</span>
        </Link>
        <div className="flex items-center gap-2">
          <CreditChip />
          {/* Tombol keluar wajib ada di SETIAP halaman yang login (permintaan
              Brian 2026-08-12). Sebelum ini pengguna retail tidak punya cara
              keluar sama sekali — hanya dashboard brand yang punya. */}
          <AccountMenu />
        </div>
      </header>
      <div className="flex-1 pb-20">{children}</div>
      {!hideNav && (
        <nav className="fixed bottom-0 left-1/2 z-10 flex w-full max-w-md -translate-x-1/2 border-t border-zinc-100 bg-white">
          <NavItem href="/" label="Beranda" icon="/icons/ui/nav-home.png" active={pathname === "/"} />
          <NavItem href="/video" label="Video" icon="/icons/ui/nav-video.png" active={pathname.startsWith("/video")} />
          <NavItem href="/kredit" label="Kredit" icon="/icons/ui/nav-kredit.png" active={pathname.startsWith("/kredit")} />
          {/* Profil: satu tempat untuk "punyaku sekarang apa?". Sebelumnya
              jawabannya tersebar — saldo di /kredit, video di /video, dan
              riwayat pembelian tidak di mana-mana. */}
          <NavItem
            href="/profil"
            label="Profil"
            active={pathname.startsWith("/profil")}
            icon={
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
            }
          />
        </nav>
      )}
    </div>
  );
}

/**
 * `icon` boleh berupa path gambar ATAU elemen SVG.
 *
 * Profil tidak punya berkas ikonnya sendiri, dan memakai ulang nav-kredit.png
 * berarti dua tab bersebelahan bergambar sama — pengguna memilih tab dengan
 * MELIHAT, bukan membaca, jadi dua gambar identik menghapus gunanya ikon.
 * Menggambarnya inline lebih jujur daripada meminjam gambar yang salah.
 */
function NavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string | React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
        active ? "font-bold text-amber-600" : "text-zinc-500"
      }`}
    >
      {typeof icon === "string" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className={`h-6 w-6 ${active ? "" : "opacity-60"}`} />
      ) : (
        <span className={`flex h-6 w-6 items-center justify-center ${active ? "" : "opacity-60"}`}>{icon}</span>
      )}
      {label}
    </Link>
  );
}
