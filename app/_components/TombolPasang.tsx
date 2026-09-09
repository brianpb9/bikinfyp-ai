"use client";

import { useEffect, useState } from "react";
import { deteksiIosSafari } from "../../lib/pwa-pasang";

/**
 * Pintu PERMANEN untuk memasang aplikasi.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA, PADAHAL SUDAH ADA BANNER
 * ---------------------------------------------------------------------------
 * Banner AjakPasang muncul 6 detik setelah halaman terbuka, dan hanya di
 * halaman yang bukan alur kerja. Itu cukup untuk MENAWARKAN, tapi tidak cukup
 * untuk DITEMUKAN: orang yang melewatinya sekali — atau menutupnya — tidak
 * punya cara lain selain menunggu 30 hari.
 *
 * Brian mencobanya di ponsel 9 Sep 2026 dan tidak menemukan apa-apa. Sebab
 * utamanya memang bug (seluruh /dashboard terblokir), tapi kejadian itu
 * memperlihatkan hal lain: fitur yang hanya hidup di banner berjangka waktu
 * TIDAK PUNYA alamat tetap. Kalau ada yang bertanya "di mana tombolnya?",
 * harus ada jawaban yang bisa ditunjuk.
 *
 * Komponen ini menyembunyikan dirinya kalau memang tidak ada yang bisa
 * dikerjakan — sudah terpasang, atau browsernya tidak mendukung sama sekali.
 * Menampilkan tombol mati lebih buruk daripada tidak menampilkan apa pun.
 */

interface EventPasang extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type WindowPasang = Window & { __aiugcPasang?: EventPasang };

export function TombolPasang({ className = "" }: { className?: string }) {
  const [ev, setEv] = useState<EventPasang | null>(null);
  const [ios, setIos] = useState(false);
  const [terpasang, setTerpasang] = useState(true); // anggap terpasang sampai terbukti tidak
  const [caraIos, setCaraIos] = useState(false);

  useEffect(() => {
    const ambil = () => setEv((window as WindowPasang).__aiugcPasang ?? null);
    ambil();
    window.addEventListener("aiugc:pasang-siap", ambil);
    const onPrompt = (e: Event) => { e.preventDefault(); setEv(e as EventPasang); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onPasang = () => { setEv(null); setTerpasang(true); };
    window.addEventListener("appinstalled", onPasang);

    setIos(deteksiIosSafari(navigator.userAgent, navigator.vendor ?? ""));
    setTerpasang(
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    return () => {
      window.removeEventListener("aiugc:pasang-siap", ambil);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onPasang);
    };
  }, []);

  // Tidak ada yang bisa dikerjakan -> tidak usah ada tombolnya.
  if (terpasang || (!ev && !ios)) return null;

  async function pasang() {
    if (!ev) return;
    try { await ev.prompt(); await ev.userChoice; } catch { /* dialog ditutup — bukan galat */ }
    setEv(null);
    delete (window as WindowPasang).__aiugcPasang;
  }

  if (ios) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setCaraIos((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span aria-hidden>📲</span> Pasang aplikasi
        </button>
        {caraIos && (
          <ol className="mt-1.5 space-y-1 rounded-lg bg-zinc-50 p-2 text-[11px] leading-5 text-zinc-600">
            <li>1. Ketuk <b>Bagikan</b> di bawah Safari.</li>
            <li>2. Pilih <b>Add to Home Screen</b>.</li>
            <li>3. Ketuk <b>Add</b>.</li>
          </ol>
        )}
      </div>
    );
  }

  return (
    <button type="button" onClick={() => void pasang()} className={`flex w-full items-center gap-2 text-left ${className}`}>
      <span aria-hidden>📲</span> Pasang aplikasi
    </button>
  );
}
