"use client";

import { ChevronRight } from "lucide-react";

// Breadcrumb langkah ala Blaze (M8) — user selalu tahu ada di mana, sudah
// lewat apa, dan masih sisa berapa. Langkah yang sudah dilewati bisa diklik
// untuk mundur; langkah di depan TIDAK bisa diloncati (datanya belum ada).
export function Stepper({
  steps,
  current,
  onJump,
}: {
  steps: string[];
  current: number;
  onJump?: (index: number) => void;
}) {
  return (
    <nav aria-label="Langkah" className="flex flex-wrap items-center gap-1 text-sm">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span key={label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-zinc-300" aria-hidden="true" />}
            {done && onJump ? (
              <button
                onClick={() => onJump(i)}
                className="rounded px-1.5 py-0.5 font-medium text-zinc-500 transition-colors hover:text-amber-600"
              >
                {label}
              </button>
            ) : (
              <span
                aria-current={active ? "step" : undefined}
                className={`px-1.5 py-0.5 ${active ? "font-bold text-zinc-900" : done ? "font-medium text-zinc-500" : "text-zinc-300"}`}
              >
                {label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
