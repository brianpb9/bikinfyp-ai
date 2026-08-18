"use client";

import { ChevronRight } from "lucide-react";

// Breadcrumb langkah ala Blaze (M8) — user selalu tahu ada di mana, sudah
// lewat apa, dan masih sisa berapa.
//
// BISA DILOMPATI MAJU sejak 2026-08-12 (permintaan Brian, referensi rail kiri
// UGC Factory Higgsfield). Alurnya sekarang enam langkah; brand yang cuma mau
// mengganti satu pilihan harus menekan "Lanjut" berkali-kali untuk kembali ke
// tempatnya semula. Rail Higgsfield tidak begitu — semua tujuan terlihat dan
// langsung bisa diklik.
//
// Batasnya `maxReached`, BUKAN "bebas ke mana saja": langkah yang datanya
// belum ada tetap tidak bisa dibuka, karena membuka Konsep tanpa produk cuma
// menghasilkan layar kosong yang terasa rusak. Yang dibuka adalah langkah
// yang PERNAH dicapai — di situ datanya sudah pasti ada.
export function Stepper({
  steps,
  current,
  maxReached,
  onJump,
}: {
  steps: string[];
  current: number;
  /** Langkah terjauh yang pernah dicapai. Semua langkah <= ini bisa diklik. */
  maxReached?: number;
  onJump?: (index: number) => void;
}) {
  const batas = maxReached ?? current;
  return (
    <nav aria-label="Langkah" className="text-sm">
      {/* Di HP breadcrumb enam langkah membungkus jadi 2-3 baris yang berat
          sebelum setiap form. Ringkasan satu baris + mundur satu langkah
          menjawab dua pertanyaan yang sebenarnya: "saya di mana" dan
          "bagaimana kembali". Breadcrumb penuh tetap milik desktop. */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <span className="font-bold text-zinc-900">
          Langkah {current + 1} dari {steps.length}
          <span className="ml-1.5 font-medium text-zinc-500">· {steps[current]}</span>
        </span>
        {current > 0 && onJump && (
          <button onClick={() => onJump(current - 1)} className="rounded-lg px-2 py-1 text-xs font-semibold text-amber-700">
            ← {steps[current - 1]}
          </button>
        )}
      </div>
      <div className="hidden flex-wrap items-center gap-1 sm:flex">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const bisaDiklik = i !== current && i <= batas;
        return (
          <span key={label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-zinc-300" aria-hidden="true" />}
            {bisaDiklik && onJump ? (
              <button
                onClick={() => onJump(i)}
                className={`rounded px-1.5 py-0.5 font-medium transition-colors hover:text-amber-600 ${done ? "text-zinc-500" : "text-zinc-400"}`}
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
      </div>
    </nav>
  );
}
