"use client";

import { useState } from "react";

// Pratinjau yang KOTAKNYA MENGIKUTI VIDEONYA (permintaan Brian 2026-08-11:
// "kalau video landscape di buat landscape kotaknya").
//
// Rasio dibaca dari metadata video saat dimuat, BUKAN dari kolom yang diisi
// manual di definisi template. Kolom manual pasti melenceng begitu ada yang
// mengganti berkasnya dan lupa memperbarui angkanya — dan melencengnya baru
// ketahuan sebagai video terpotong di layar brand. Membaca dari berkasnya
// membuat keduanya mustahil berbeda.
//
// Nilai awal 9:16 karena mayoritas klip kita potret; begitu metadata masuk,
// kotaknya menyesuaikan sendiri.
export function PreviewVideo({
  src,
  className = "",
  fallback,
}: {
  src: string | null;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [aspect, setAspect] = useState("9 / 16");

  if (!src) {
    return (
      <div className={`relative w-full overflow-hidden bg-zinc-900 ${className}`} style={{ aspectRatio: aspect }}>
        {fallback}
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden bg-zinc-900 ${className}`} style={{ aspectRatio: aspect }}>
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          // Video rusak melaporkan 0 — jangan sampai membuat aspectRatio jadi
          // NaN dan kotaknya kolaps jadi setinggi nol.
          if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(`${v.videoWidth} / ${v.videoHeight}`);
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
