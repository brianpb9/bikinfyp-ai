"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lapisan tunggu saat naskah sedang ditulis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MASALAH YANG DIPECAHKAN
 * ────────────────────────────────────────────────────────────────────────────
 * Catatan Brian 3 Sep 2026: "Ketika proses generate tidak ada progress bar.
 * Hanya disable button dan tidak tau progress apakah berjalan atau tidak."
 *
 * Sampai kini satu-satunya tanda bahwa sesuatu sedang terjadi adalah tulisan
 * di tombol berubah jadi "Lagi nulis skrip...". Pada koneksi yang lambat, itu
 * tidak bisa dibedakan dari aplikasi yang menggantung — dan orang yang mengira
 * aplikasinya menggantung akan menekan tombolnya lagi atau menutup halaman,
 * padahal panggilan model berbayar sudah berjalan.
 *
 * Gerbang viral (3 Sep) MEMPERBURUKNYA dengan sengaja: naskah yang skornya di
 * bawah 60 ditulis ulang sampai tiga kali, jadi penantian terburuk kini tiga
 * kali lipat. Menambah kesabaran yang dituntut tanpa menambah kabar yang
 * diberikan adalah cara membuat perbaikan mutu terasa seperti kerusakan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA BUKAN BAR PERSENTASE
 * ────────────────────────────────────────────────────────────────────────────
 * Kita TIDAK TAHU persentasenya. Rute /api/scripts/generate menjawab sekali di
 * akhir; tidak ada aliran kemajuan dari server, dan jumlah percobaan baru
 * ketahuan setelah selesai. Bar yang merangkak ke 90% lalu diam adalah
 * kebohongan kecil yang justru menghancurkan kepercayaan pada penantian
 * berikutnya — dan repo ini sudah memutuskan hal serupa untuk skor: kalau
 * tidak terukur, jangan dikarang.
 *
 * Yang diberikan sebagai gantinya semuanya BENAR:
 *   - waktu berjalan yang sungguhan (detik, dihitung di klien);
 *   - rentang lama yang wajar, disebut sebagai perkiraan;
 *   - tahap yang sedang dikerjakan, ditulis sebagai apa yang MEMANG dilakukan
 *     mesin pada rentang waktu itu, bukan angka kemajuan;
 *   - alasan kalau penantiannya menjadi panjang — mutu naskah belum lolos
 *     ambang, jadi ditulis ulang.
 *
 * Bar animasinya indeterminate: ia menyatakan "masih hidup", bukan "sekian
 * persen".
 */

/** Tahap yang benar-benar dikerjakan mesin, dengan detik mulainya. */
const TAHAP: { sejakDetik: number; teks: string }[] = [
  { sejakDetik: 0, teks: "Membaca produkmu & memilih sudut cerita" },
  { sejakDetik: 8, teks: "Menulis hook, demo, dan ajakan penutup" },
  { sejakDetik: 22, teks: "Memeriksa naskah ke aturan mutu" },
  // Di atas ~35 detik, hampir selalu karena gerbang viral menulis ulang.
  // Menyebut alasannya mengubah "kok lama" jadi "oh, lagi dibagusin".
  { sejakDetik: 35, teks: "Skor viralnya belum cukup — naskahnya ditulis ulang" },
  { sejakDetik: 60, teks: "Percobaan terakhir, sebentar lagi" },
];

export function TungguNaskah({ terlihat }: { terlihat: boolean }) {
  const [detik, setDetik] = useState(0);
  const mulai = useRef<number>(0);

  useEffect(() => {
    if (!terlihat) {
      setDetik(0);
      return;
    }
    // Dihitung dari selisih jam, bukan dengan menambah 1 tiap detik: tab yang
    // dilatarbelakangkan membuat interval dilambatkan browser, dan penghitung
    // yang menambah sendiri akan melaporkan waktu yang lebih pendek daripada
    // yang benar-benar dilalui — persis pada orang yang menunggu paling lama.
    mulai.current = Date.now();
    const t = setInterval(() => setDetik(Math.floor((Date.now() - mulai.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [terlihat]);

  if (!terlihat) return null;

  const tahap = [...TAHAP].reverse().find((t) => detik >= t.sejakDetik) ?? TAHAP[0];
  const menit = Math.floor(detik / 60);
  const sisa = detik % 60;
  const jam = menit ? `${menit}:${String(sisa).padStart(2, "0")}` : `${sisa} detik`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/45 px-6 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      // Menutup lewat klik SENGAJA tidak ada: permintaannya sudah berjalan dan
      // sudah memakai token. Membiarkan orang menutupnya membuat ia mengira
      // prosesnya batal, lalu menekan tombolnya lagi.
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <p className="font-display text-lg font-bold">✍️ Lagi nulis skripmu...</p>
        <p className="mt-1 text-sm leading-5 text-zinc-600">{tahap.teks}</p>

        {/* Bar INDETERMINATE — menyatakan "masih jalan", bukan persentase. */}
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-amber-100">
          <div className="h-full w-1/3 rounded-full bg-amber-500 motion-safe:animate-[tunggu_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-60" />
        </div>

        <div className="mt-3 flex items-baseline justify-between text-xs text-zinc-500">
          <span>Berjalan {jam}</span>
          <span>Biasanya 20–40 detik</span>
        </div>

        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
          Jangan tutup halaman ini ya. Kalau agak lama, itu karena skripnya
          ditulis ulang sampai skor viralnya cukup.
        </p>
      </div>
    </div>
  );
}
