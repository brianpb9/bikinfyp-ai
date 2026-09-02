"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "./api";

/**
 * Chip kredit di header — SISA JATAH VIDEO, bukan saldo rupiah.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI DIGANTI
 * ────────────────────────────────────────────────────────────────────────────
 * Chip ini dulu membaca /api/credits, yaitu dompet RUPIAH warisan. Sejak render
 * dibayar dengan jatah video per jenis, angka itu berhenti berubah selamanya —
 * dan ia terpampang di SETIAP halaman.
 *
 * Akibatnya persis yang dilaporkan Brian 3 Sep 2026: ia menyelesaikan top-up
 * Rp93.000, jatahnya benar-benar masuk (langganan Mulai + 2 kredit satuan),
 * tapi header tetap menulis "Rp12.000" — bonus pendaftaran rupiah dari sistem
 * lama. Angka yang tidak pernah berubah, di tempat yang paling terlihat,
 * adalah cara tercepat membuat orang menyimpulkan pembayarannya gagal.
 *
 * Yang ditampilkan sekarang adalah TOTAL video yang masih bisa dibuat.
 * Rinciannya per jenis ada di title dan aria-label — cukup untuk yang
 * penasaran, tanpa memenuhi header dengan tiga angka.
 */

interface SisaJenis { total: number }

const LABEL: Record<string, string> = { standard: "Standard", premium: "Premium", ultra: "Ultra" };

export function CreditChip() {
  const [sisa, setSisa] = useState<Record<string, SisaJenis> | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    apiFetch<{ sisa: Record<string, SisaJenis> }>("/api/kredit-video")
      .then((d) => alive && setSisa(d.sisa))
      .catch(() => alive && setSisa(null));
    return () => {
      alive = false;
    };
    // Dibaca ulang tiap pindah halaman — termasuk saat pembeli kembali dari
    // /kredit sesudah membayar, yaitu saat angkanya paling perlu segar.
  }, [pathname]);

  const total = sisa ? Object.values(sisa).reduce((n, s) => n + s.total, 0) : null;
  const rincian = sisa
    ? Object.entries(sisa)
        .map(([j, s]) => `${LABEL[j] ?? j}: ${s.total}`)
        .join(" · ")
    : "Memuat sisa jatah video";

  return (
    <Link
      href="/kredit"
      title={rincian}
      className="flex min-h-[44px] items-center gap-1 rounded-full bg-amber-100 px-4 font-semibold text-amber-800 active:bg-amber-200"
      aria-label={`Sisa jatah video — ${rincian}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/ui/nav-kredit.png" alt="" className="h-4 w-4" />
      {total === null ? "…" : `${total} video`}
    </Link>
  );
}
