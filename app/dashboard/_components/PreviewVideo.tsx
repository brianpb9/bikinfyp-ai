"use client";

import { useCallback, useState } from "react";

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

  // Membaca ukuran lewat ref, BUKAN hanya lewat onLoadedMetadata.
  //
  // Bug nyata (2026-08-11): klip kecil sering selesai dimuat SEBELUM React
  // sempat memasang handler-nya — readyState sudah 4, event loadedmetadata
  // sudah lewat, dan kotaknya diam di 9/16 selamanya. Akibatnya klip landscape
  // tetap dipaksa masuk kotak potret, persis yang Brian keluhkan. Ref callback
  // jalan saat elemen menempel, jadi kasus "sudah telanjur dimuat" ikut
  // tertangani; handler tetap dipertahankan untuk yang belum dimuat.
  const applyAspect = useCallback((v: HTMLVideoElement | null) => {
    // videoWidth 0 = metadata belum ada; biarkan handler yang mengurus nanti.
    if (v && v.videoWidth > 0 && v.videoHeight > 0) setAspect(`${v.videoWidth} / ${v.videoHeight}`);
  }, []);

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
        ref={applyAspect}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        onLoadedMetadata={(e) => applyAspect(e.currentTarget)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
