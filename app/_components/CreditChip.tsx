"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "./api";

/** Chip kredit (⚡ N) — selalu ada di header, tap -> /kredit. */
export function CreditChip() {
  const [balance, setBalance] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    apiFetch<{ balance: number }>("/api/credits")
      .then((d) => alive && setBalance(d.balance))
      .catch(() => alive && setBalance(null));
    return () => {
      alive = false;
    };
  }, [pathname]);

  return (
    <Link
      href="/kredit"
      className="flex min-h-[44px] items-center gap-1 rounded-full bg-amber-100 px-4 font-semibold text-amber-800 active:bg-amber-200"
      aria-label="Lihat kredit saya"
    >
      ⚡ {balance === null ? "…" : `Rp${balance.toLocaleString("id-ID")}`}
    </Link>
  );
}
