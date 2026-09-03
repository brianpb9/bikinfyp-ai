"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "./_components/api";
import { PrimaryButton } from "./_components/ui";
import { relTime } from "./_components/flow";
import { JobThumb } from "./_components/JobThumb";
import { SiteFooter } from "./_components/SiteFooter";

interface JobItem {
  id: string;
  state: string;
  product_name: string;
  created_at: string;
  thumb_url: string | null;
  preview_url: string | null;
}

// S1 — BERANDA
export default function HomePage() {
  // SISA JATAH VIDEO, bukan saldo rupiah. Kartu ini sempat berbunyi "Kredit
  // tinggal Rp12.000" ke pengguna yang baru saja membeli 9 video — angka
  // rupiah warisan yang tidak pernah berubah lagi, dipajang sebagai kredit.
  const [sisaVideo, setSisaVideo] = useState<number | null>(null);
  const [jobs, setJobs] = useState<JobItem[] | null>(null);
  // User yang menutup HP saat render lalu buka app lagi mendarat DI SINI,
  // bukan di halaman proses — beranda wajib memberi tahu ada video yang
  // sedang dibikin (permintaan Brian 2026-08-07).
  const [processing, setProcessing] = useState<JobItem[]>([]);

  useEffect(() => {
    apiFetch<{ total_video: number }>("/api/auth/me")
      .then((d) => setSisaVideo(d.total_video))
      .catch(() => setSisaVideo(null));
    apiFetch<{ jobs: JobItem[] }>("/api/jobs")
      .then((d) => {
        setJobs(d.jobs.filter((j) => j.state === "READY").slice(0, 6));
        setProcessing(d.jobs.filter((j) => !["READY", "FAILED", "REFUNDED"].includes(j.state)));
      })
      .catch(() => setJobs([]));
  }, []);

  const isNewUser = jobs !== null && jobs.length === 0 && processing.length === 0;

  return (
    // Kolom flex, bukan sekadar min-h-dvh: beranda pengguna baru isinya pendek,
    // dan tanpa ini footer identitas merchant berhenti tepat di bawah konten —
    // menggantung di tengah layar dengan ruang kosong di bawahnya (feedback
    // Brian 19 Agu). flex-1 pada pembungkus konten yang mendorongnya ke dasar.
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div className="flex-1 space-y-7">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Studio kreator</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Beranda</h1>
      </div>

      <Link
        href="/bikin/jenis"
        className={`flex w-full items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-amber-500 font-display font-extrabold text-white shadow-lg shadow-amber-500/20 active:from-amber-500 active:to-amber-600 ${
          isNewUser ? "min-h-[100px] text-2xl" : "min-h-[60px] text-lg"
        }`}
      >
        ＋ BIKIN VIDEO
      </Link>

      {processing.length > 0 && (
        <Link
          href={`/bikin/proses?job=${processing[0].id}`}
          className="flex items-center gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-4 shadow-sm active:bg-amber-100"
        >
          <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-amber-900">
              {processing.length} video sedang dibikin
            </span>
            <span className="block truncate text-xs text-amber-800">
              {processing.map((j) => j.product_name).join(", ")} — tap untuk lihat progres
            </span>
          </span>
          <span className="shrink-0 font-bold text-amber-600">→</span>
        </Link>
      )}

      {jobs === null ? null : jobs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-base font-bold text-zinc-800">Video terakhir</h2>
          <div className="grid grid-cols-3 gap-3">
            {jobs.slice(0, 3).map((j) => (
              <Link key={j.id} href={`/bikin/hasil?job=${j.id}`} className="space-y-1">
                <div className="aspect-[9/16] overflow-hidden rounded-2xl bg-zinc-200 shadow-sm ring-1 ring-black/5">
                  <JobThumb preview_url={j.preview_url} thumb_url={j.thumb_url} alt={j.product_name} />
                </div>
                <p className="truncate text-xs text-zinc-600">
                  {j.product_name} · {relTime(j.created_at)}
                </p>
              </Link>
            ))}
          </div>
          <Link href="/video" className="flex min-h-[44px] items-center text-sm font-semibold text-amber-600">
            Lihat semua →
          </Link>
        </section>
      ) : (
        <div className="space-y-3 overflow-hidden rounded-3xl border border-amber-200 bg-white text-center shadow-sm">
          <div className="bg-gradient-to-br from-amber-100 via-orange-50 to-white px-6 pb-4 pt-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ui/empty-video.png" alt="" className="mx-auto h-12 w-12" />
            <p className="mt-2 font-display text-lg font-bold text-zinc-900">Belum ada video</p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">Yuk bikin yang pertama — gratis pakai video bonus kamu!</p>
          </div>
        </div>
      )}

      {/* Ambang 2 video, bukan nominal rupiah: yang menentukan orang perlu
          top-up adalah berapa video lagi yang bisa ia buat, bukan berapa rupiah
          tersisa di dompet yang sudah tidak dipakai. */}
      {sisaVideo !== null && sisaVideo <= 2 && (
        <Link
          href="/kredit"
          className="flex min-h-[56px] items-center justify-between rounded-2xl border-2 border-amber-200 bg-amber-50 px-4"
        >
          <span className="font-semibold text-amber-900">
            {sisaVideo === 0 ? "Jatah videomu habis" : `Sisa ${sisaVideo} video lagi`}
          </span>
          <span className="font-bold text-amber-600">{sisaVideo === 0 ? "Beli →" : "Tambah →"}</span>
        </Link>
      )}

      </div>

      <SiteFooter />
    </main>
  );
}
