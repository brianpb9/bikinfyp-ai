"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { bolehTampil, deteksiIosSafari, waktuTunda, KUNCI_TUNDA } from "../../lib/pwa-pasang";

/**
 * Ajakan memasang AIUGC sebagai aplikasi.
 *
 * ---------------------------------------------------------------------------
 * DUA JALUR, KARENA BROWSERNYA MEMANG BERBEDA
 * ---------------------------------------------------------------------------
 * Chrome/Edge/Android memberi event `beforeinstallprompt`: kita simpan, lalu
 * panggil prompt() saat pengguna menekan tombol kita. Satu ketukan, selesai.
 *
 * Safari iOS TIDAK punya event itu dan tidak akan pernah punya — Apple hanya
 * menyediakan menu Bagikan → "Add to Home Screen". Jadi di sana yang bisa kita
 * lakukan cuma MENUNJUKKAN caranya. Menampilkan tombol "Pasang" yang tidak
 * memasang apa pun lebih buruk daripada tidak ada tombol sama sekali.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MUNCUL PELAN, DAN CUMA SEKALI
 * ---------------------------------------------------------------------------
 * Ini interupsi. Ia ditunda 6 detik supaya tidak menabrak orang yang baru
 * membuka halaman, dan ditutup berarti diam 30 hari — cukup lama untuk tidak
 * terasa mengejar. Aturannya sendiri ada di lib/pwa-pasang.ts supaya bisa diuji
 * tanpa DOM.
 */

interface EventPasang extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Titipan dari skrip penangkap di app/layout.tsx. */
type WindowPasang = Window & { __aiugcPasang?: EventPasang };

/** Jeda sebelum muncul. Cukup untuk halaman selesai dan mata orang mendarat. */
const JEDA_MS = 6_000;

export function AjakPasang() {
  const pathname = usePathname();
  const [ev, setEv] = useState<EventPasang | null>(null);
  const [ios, setIos] = useState(false);
  const [tampil, setTampil] = useState(false);
  const [bukaCaraIos, setBukaCaraIos] = useState(false);

  // Event bisa datang SEBELUM komponen siap, jadi ia ditangkap sedini mungkin
  // dan disimpan. Tanpa preventDefault(), Chrome menampilkan bilahnya sendiri
  // dan kita berakhir punya dua ajakan sekaligus.
  useEffect(() => {
    // EVENTNYA SUDAH DITANGKAP DI <head>, sebelum React ada.
    //
    // Chrome menyalakan beforeinstallprompt di sekitar page-load — lebih dulu
    // daripada hydration — dan tidak pernah mengulanginya. Listener di sini
    // saja berarti tombolnya nyaris tidak pernah muncul; terbukti di produksi
    // 9 Sep 2026. Skrip di app/layout.tsx menyimpannya ke window.__aiugcPasang
    // dan memberi tahu lewat event sendiri.
    const ambil = () => {
      const t = (window as WindowPasang).__aiugcPasang;
      if (t) setEv(t);
    };
    ambil();
    window.addEventListener("aiugc:pasang-siap", ambil);

    // Tetap didengar langsung juga: sebagian browser menyalakannya belakangan
    // (mis. sesudah interaksi pertama), dan di situ skrip <head> sudah selesai.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEv(e as EventPasang);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const onPasang = () => {
      setEv(null);
      setTampil(false);
      // Dibersihkan supaya ketukan berikutnya tidak memakai event basi.
      delete (window as WindowPasang).__aiugcPasang;
    };
    window.addEventListener("appinstalled", onPasang);

    setIos(deteksiIosSafari(navigator.userAgent, navigator.vendor ?? ""));
    return () => {
      window.removeEventListener("aiugc:pasang-siap", ambil);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onPasang);
    };
  }, []);

  useEffect(() => {
    setTampil(false);
    setBukaCaraIos(false);
    const t = setTimeout(() => {
      let tunda: number | null = null;
      try {
        const v = localStorage.getItem(KUNCI_TUNDA);
        tunda = v ? Number(v) : null;
      } catch { /* penyimpanan diblokir — perlakukan sebagai belum pernah ditunda */ }

      setTampil(bolehTampil({
        pathname,
        // Dua cara, karena iOS lama hanya punya navigator.standalone.
        sudahTerpasang:
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
        adaPrompt: ev !== null,
        iosSafari: ios,
        tundaSampai: Number.isFinite(tunda) ? tunda : null,
        sekarang: Date.now(),
      }));
    }, JEDA_MS);
    return () => clearTimeout(t);
  }, [pathname, ev, ios]);

  const tutup = useCallback(() => {
    setTampil(false);
    try { localStorage.setItem(KUNCI_TUNDA, String(waktuTunda(Date.now()))); } catch { /* diabaikan */ }
  }, []);

  async function pasang() {
    if (!ev) return;
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch { /* pengguna menutup dialog bawaan — bukan galat */ }
    // Event pemasangan hanya boleh dipakai SEKALI. Menyimpannya membuat
    // ketukan kedua gagal diam-diam.
    setEv(null);
    delete (window as WindowPasang).__aiugcPasang;
    setTampil(false);
  }

  if (!tampil) return null;

  return (
    <div
      role="dialog"
      aria-label="Pasang aplikasi AIUGC.ID"
      // Duduk DI ATAS bilah navigasi bawah (h-20), bukan menutupinya: bilah itu
      // satu-satunya cara pindah halaman di ponsel.
      className="fixed inset-x-0 bottom-20 z-20 mx-auto w-full max-w-md px-4"
    >
      <div className="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-xl shadow-zinc-900/10">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={44} height={44} className="rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-zinc-900">Pasang AIUGC di HP kamu</p>
            <p className="mt-0.5 text-[12px] leading-5 text-zinc-600">
              Buka langsung dari layar utama, tanpa cari-cari tab. Ukurannya kecil, tidak makan memori.
            </p>
          </div>
          <button
            type="button" onClick={tutup} aria-label="Tutup"
            className="-mr-1 -mt-1 min-h-[32px] min-w-[32px] rounded-lg text-lg leading-none text-zinc-400"
          >
            ×
          </button>
        </div>

        {ios ? (
          <>
            {/* Safari tidak punya tombol pasang. Yang jujur cuma menunjukkan
                caranya — tombol "Pasang" yang tidak memasang apa pun lebih
                buruk daripada tidak ada tombol. */}
            <button
              type="button"
              onClick={() => setBukaCaraIos((v) => !v)}
              className="mt-3 min-h-[44px] w-full rounded-xl bg-zinc-900 text-sm font-bold text-white"
            >
              {bukaCaraIos ? "Sembunyikan caranya" : "Lihat caranya"}
            </button>
            {bukaCaraIos && (
              <ol className="mt-2.5 space-y-1.5 rounded-xl bg-zinc-50 p-3 text-[12px] leading-5 text-zinc-700">
                <li>1. Ketuk tombol <b>Bagikan</b> di bawah Safari (kotak dengan panah ke atas).</li>
                <li>2. Geser ke bawah, pilih <b>Add to Home Screen</b> / <b>Ke Layar Utama</b>.</li>
                <li>3. Ketuk <b>Add</b>. Ikon AIUGC muncul di layar utama.</li>
              </ol>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => void pasang()}
            className="mt-3 min-h-[44px] w-full rounded-xl bg-zinc-900 text-sm font-bold text-white"
          >
            Pasang sekarang
          </button>
        )}
      </div>
    </div>
  );
}
