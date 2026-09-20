"use client";

import { useEffect, useRef, useState } from "react";

/**
 * VIDEO CONTOH — satu komponen untuk semua klip statis di public/.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA
 * ---------------------------------------------------------------------------
 * Audit UI 19 Sep 2026: 20 tag <video> di aplikasi, NOL yang punya `poster`.
 * Yang terlihat di browser bukan video, melainkan kotak kosong setinggi 350px
 * — di halaman daftar, di pilih format, dan di pilih gaya. Empat layar paling
 * menentukan dari produk yang menjual video, tampil tanpa satu pun gambar.
 *
 * Penyebabnya bukan berkas yang hilang: semua mp4 ada dan melayani 200. Video
 * memang belum tentu diputar — autoplay ditolak saat hemat daya, hemat data,
 * atau jaringan lambat — dan tanpa `poster` tidak ada apa pun di belakangnya.
 *
 * ---------------------------------------------------------------------------
 * TIGA HAL YANG DIJAGA KOMPONEN INI
 * ---------------------------------------------------------------------------
 * 1. POSTER SELALU ADA. Diturunkan dari nama berkasnya (scripts/buat-poster.ts
 *    membuat `x.poster.webp` di sebelah `x.mp4`), jadi tidak ada call site yang
 *    bisa lupa memasangnya.
 *
 * 2. VIDEO BARU DIMUAT SAAT TERLIHAT. Halaman /onboarding memuat lima video
 *    sekaligus — 1,7 MB — sebelum perbaikan ini, semuanya di muka. Dengan
 *    `preload="none"` + IntersectionObserver, yang di bawah lipatan baru
 *    diambil kalau benar-benar sampai ke sana. Yang dibayar pengunjung 4G
 *    tinggal poster di layar pertama (±10 KB).
 *
 * 3. GAGAL PUN TETAP ADA GAMBARNYA. Kalau videonya error atau autoplay
 *    ditolak, posternya tetap di tempat — bukan kotak kosong.
 */

/** `/previews/format-wajah.mp4` -> `/previews/format-wajah.poster.webp` */
export const posterUntuk = (src: string) => src.replace(/\.mp4$/, ".poster.webp");

export function KlipContoh({
  src,
  className = "",
  poster,
  /** Klip di layar pertama boleh dimuat lebih awal (hero). */
  prioritas = false,
}: {
  src: string;
  className?: string;
  poster?: string;
  prioritas?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [tampil, setTampil] = useState(prioritas);

  useEffect(() => {
    if (tampil) return;
    const el = ref.current;
    if (!el) return;
    // Browser tanpa IntersectionObserver (Safari lama) langsung diberi
    // videonya — lebih baik boros daripada diam-diam tidak pernah memutar.
    if (typeof IntersectionObserver === "undefined") { setTampil(true); return; }

    let io: IntersectionObserver | null = null;
    let batal = false;

    const amati = () => {
      if (batal || !ref.current) return;
      io = new IntersectionObserver(
        (entries) => { if (entries.some((e) => e.isIntersecting)) { setTampil(true); io?.disconnect(); } },
        // 96px, bukan 200px: dengan 200px strip contoh /onboarding — yang
        // duduk 135px di bawah lipatan pada layar 390x844 — masih ikut
        // terunduh seluruhnya.
        { rootMargin: "96px" },
      );
      io.observe(ref.current);
    };

    // PENGAMATAN DITUNDA SAMPAI TATA LETAK TENANG.
    //
    // Terukur 20 Sep 2026: strip contoh /onboarding jelas di bawah lipatan,
    // tapi klipnya TETAP terunduh semua (1,7 MB). Sebabnya bukan marginnya:
    // pada cat pertama, gambar dan font di atasnya belum memesan tingginya,
    // jadi strip itu sempat berada jauh lebih tinggi, memotong zona pemicu,
    // dan src-nya terpasang untuk selamanya. Mengamati sesudah `load` membuat
    // yang dinilai posisi sebenarnya, bukan posisi sesaat sebelum halaman
    // selesai disusun.
    if (document.readyState === "complete") amati();
    else window.addEventListener("load", amati, { once: true });

    return () => {
      batal = true;
      window.removeEventListener("load", amati);
      io?.disconnect();
    };
  }, [tampil]);

  useEffect(() => {
    if (!tampil) return;
    // play() ditolak di beberapa keadaan (hemat daya, izin media). Itu BUKAN
    // kegagalan yang perlu dicatat — posternya sudah menanggungnya.
    ref.current?.play().catch(() => {});
  }, [tampil]);

  return (
    <video
      ref={ref}
      // src baru dipasang saat terlihat: atribut src yang sudah ada membuat
      // Chrome mengambil videonya walau preload="none" pada sebagian versi.
      src={tampil ? src : undefined}
      poster={poster ?? posterUntuk(src)}
      preload={prioritas ? "metadata" : "none"}
      autoPlay
      muted
      loop
      playsInline
      // Poster diskalakan sama dengan videonya, jadi tidak ada lompatan saat
      // frame pertama menggantikannya.
      className={`bg-zinc-100 object-cover ${className}`}
    />
  );
}
