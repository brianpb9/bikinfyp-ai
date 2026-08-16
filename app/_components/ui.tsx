"use client";

import Link from "next/link";

/** Indikator progres 5 titik untuk alur S2–S6. */
export function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 py-3" aria-label={`Langkah ${step} dari 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${i <= step ? "bg-amber-500" : "bg-zinc-200"}`}
        />
      ))}
      <span className="ml-2 text-xs text-zinc-500">Langkah {step} dari 5</span>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  href,
  disabled,
  big,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  big?: boolean;
  type?: "button" | "submit";
}) {
  const cls = `flex w-full items-center justify-center rounded-2xl bg-amber-500 font-bold text-white shadow-sm transition active:bg-amber-600 disabled:bg-zinc-300 disabled:text-zinc-500 ${
    big ? "min-h-[64px] text-xl" : "min-h-[56px] text-lg"
  }`;
  if (href && !disabled)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const cls =
    "flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-zinc-200 bg-white font-semibold text-zinc-700 active:bg-zinc-50";
  if (href)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

export function WarnCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
      {children}
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-800">{message}</div>
  );
}

/** Langkah SEBELUM tiap langkah alur retail.
 *
 *  Panah "←" dulu SELALU menuju "/" apa pun langkahnya, jadi dari Skrip ia
 *  melempar ke beranda, bukan mundur ke Gaya. Pengguna yang cuma ingin
 *  membetulkan satu pilihan kehilangan seluruh kemajuannya (temuan audit QA
 *  16 Agu 2026). */
const LANGKAH_SEBELUMNYA: Record<number, string> = {
  1: "/bikin/jenis",
  2: "/bikin/produk",
  3: "/bikin/gaya",
};

export function FlowHeader({ title, step, kembaliKe }: { title: string; step: number; kembaliKe?: string }) {
  // kembaliKe boleh menimpa, untuk halaman yang jalur masuknya tidak tunggal.
  const href = kembaliKe ?? LANGKAH_SEBELUMNYA[step] ?? "/";
  return (
    <div className="px-4 pt-3">
      <Link
        href={href}
        aria-label={`Kembali ke langkah sebelumnya dari ${title}`}
        className="flex min-h-[44px] items-center text-base font-semibold text-zinc-700"
      >
        ← {title}
      </Link>
      <ProgressDots step={step} />
    </div>
  );
}
