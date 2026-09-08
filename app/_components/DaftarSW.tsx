"use client";

import { useEffect } from "react";

/**
 * Mendaftarkan service worker.
 *
 * ---------------------------------------------------------------------------
 * KENAPA SESUDAH `load`, BUKAN LANGSUNG
 * ---------------------------------------------------------------------------
 * Pendaftaran memicu unduhan sw.js dan pengisian cache awal. Melakukannya saat
 * halaman masih memuat berarti berebut bandwidth dengan bundel yang justru
 * sedang ditunggu pengguna — di jaringan 3G Indonesia itu terasa. Ditunda ke
 * setelah `load`, jadi ia gratis.
 *
 * ---------------------------------------------------------------------------
 * KEGAGALANNYA DITELAN, TAPI DICATAT
 * ---------------------------------------------------------------------------
 * Service worker adalah peningkatan, bukan prasyarat. Browser yang menolaknya
 * (mode privat sebagian, kebijakan perusahaan, storage penuh) harus tetap
 * memakai aplikasi seperti biasa. Yang tidak boleh terjadi adalah gagal DIAM —
 * kalau pendaftaran selalu gagal di suatu perangkat, kita perlu bisa melihatnya
 * di konsol saat ada yang melapor.
 */
export function DaftarSW() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const daftar = () => {
      navigator.serviceWorker.register("/sw.js").catch((e) => {
        console.warn("[pwa] service worker gagal didaftarkan:", e);
      });
    };

    if (document.readyState === "complete") daftar();
    else {
      window.addEventListener("load", daftar, { once: true });
      return () => window.removeEventListener("load", daftar);
    }
  }, []);

  return null;
}
