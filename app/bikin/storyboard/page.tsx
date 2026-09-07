"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail, pesanUntukPengguna } from "../../_components/api";
import { loadFlow, saveFlow } from "../../_components/flow";
import { ErrorText } from "../../_components/ui";

/**
 * STORYBOARD — layar review terakhir sebelum video digenerate.
 *
 * ---------------------------------------------------------------------------
 * KENAPA HALAMAN INI ADA (Brian 7 Sep 2026)
 * ---------------------------------------------------------------------------
 * Alur lama: skrip disetujui -> job dibuat -> UANG DITAHAN -> video dirender ->
 * baru pengguna melihat hasilnya. Persetujuan per scene sudah ada, tapi ia
 * berjalan SESUDAH klip jadi: orang menyetujui sesuatu yang sudah dibayarnya.
 *
 * Halaman ini memindahkan gerbang itu ke depan. Gambarnya dibuat lebih dulu
 * dengan harga jauh di bawah video, pengguna melihat dan memutuskan, baru uang
 * ditahan.
 *
 * GRATIS TAPI BERKUOTA: tidak ada uang ditahan di sini sama sekali. Yang
 * menjaga margin adalah batas ganti per scene (lib/storyboard.ts).
 */

interface Scene {
  idx: number;
  duration_sec: number;
  dialog: string;
  prompt: string;
  tanpa_orang: boolean;
  image_url: string | null;
  sisa_regen: number;
}

interface Status {
  storyboard_id: string;
  status: "PENDING" | "BUILDING" | "READY" | "APPROVED" | "FAILED";
  error: string | null;
  duration_sec: number;
  siap: boolean;
  maks_regen: number;
  maks_regen_total: number;
  sisa_regen_total: number;
  scenes: Scene[];
}

/** Gambar butuh ~21 detik per scene dan digenerate paralel, jadi polling 3
 *  detik cukup rapat untuk terasa hidup tanpa membanjiri server. */
const JEDA_POLL_MS = 3_000;

export default function StoryboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Status | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [buka, setBuka] = useState<number | null>(null);
  const idRef = useRef<string | null>(null);

  const muat = useCallback(async (id: string) => {
    try {
      setData(await apiFetch<Status>(`/api/storyboard/${id}`));
    } catch (err) {
      setGalat(pesanUntukPengguna(err, "Gagal memuat storyboard."));
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("sb") ?? loadFlow().storyboardId ?? null;
    if (!id) { router.replace("/bikin/skrip"); return; }
    idRef.current = id;
    void muat(id);
  }, [muat, router]);

  // Berhenti memoll begitu tidak ada lagi yang bisa berubah. Membiarkannya
  // jalan terus membakar baterai ponsel pengguna untuk jawaban yang sama.
  const masihBerjalan = data?.status === "PENDING" || data?.status === "BUILDING";
  useEffect(() => {
    if (!masihBerjalan || !idRef.current) return;
    const t = setInterval(() => void muat(idRef.current!), JEDA_POLL_MS);
    return () => clearInterval(t);
  }, [masihBerjalan, muat]);

  async function ganti(idx: number) {
    if (!idRef.current) return;
    setSibuk(true); setGalat(null);
    try {
      await apiFetch(`/api/storyboard/${idRef.current}/scene/${idx}`, { json: {} });
      await muat(idRef.current);
    } catch (err) {
      setGalat(pesanUntukPengguna(err, "Gagal mengganti scene."));
    } finally { setSibuk(false); }
  }

  async function hapus() {
    if (!idRef.current) return;
    setSibuk(true); setGalat(null);
    try {
      await apiFetch(`/api/storyboard/${idRef.current}`, { method: "DELETE" });
      saveFlow({ storyboardId: undefined });
      router.replace("/bikin/skrip");
    } catch (err) {
      setGalat(pesanUntukPengguna(err, "Gagal menghapus storyboard."));
      setSibuk(false);
    }
  }

  async function generate() {
    if (!idRef.current || !data?.siap) return;
    setSibuk(true); setGalat(null);
    try {
      const f = loadFlow();
      // Parameter render diambil server dari baris storyboard, bukan dari sini
      // — lihat gerbang storyboard di app/api/jobs/route.ts. Yang dikirim cuma
      // penunjuknya.
      const job = await apiFetch<{ job_id: string }>("/api/jobs", {
        json: { script_id: f.selectedScriptId, storyboard_id: idRef.current },
      });
      saveFlow({ jobId: job.job_id, storyboardId: undefined });
      router.push(`/bikin/proses?job=${job.job_id}`);
    } catch (err) {
      if (err instanceof ApiFail && err.code === "INSUFFICIENT_CREDITS") {
        router.push("/bikin/paket");
        return;
      }
      setGalat(pesanUntukPengguna(err, "Gagal memulai generate."));
      setSibuk(false);
    }
  }

  if (!data) {
    return <main className="mx-auto max-w-md px-5 py-10 text-sm text-zinc-500">Memuat storyboard…</main>;
  }

  const belumJadi = data.scenes.filter((s) => !s.image_url).length;

  return (
    <main className="mx-auto max-w-md space-y-5 px-5 pb-40 pt-6">
      <header className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Langkah terakhir</p>
        <h1 className="font-display text-2xl font-bold leading-tight text-zinc-900">Cek storyboard-nya</h1>
        <p className="text-sm leading-6 text-zinc-600">
          {data.scenes.length} scene · {data.duration_sec} detik. Belum ada token yang terpakai — token baru
          dipotong saat kamu menekan Generate. Jatah ganti gambar tersisa {data.sisa_regen_total} dari{" "}
          {data.maks_regen_total}.
        </p>
      </header>

      {data.status === "FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Ada gambar yang gagal dibuat. Kamu bisa coba ganti scene-nya, atau hapus storyboard dan ulangi.
          Tidak ada token yang terpotong.
        </div>
      )}

      {masihBerjalan && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Menggambar {belumJadi} scene lagi… sekitar 20 detik per gambar.
        </div>
      )}

      <ol className="space-y-4">
        {data.scenes.map((s) => (
          <li key={s.idx} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="relative aspect-[9/16] w-full bg-zinc-100">
              {s.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.image_url} alt={`Scene ${s.idx + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full animate-pulse items-center justify-center text-xs text-zinc-400">
                  Menggambar scene {s.idx + 1}…
                </div>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
                {s.idx + 1} · {s.duration_sec.toFixed(0)}s
              </span>
            </div>

            <div className="space-y-2.5 p-3.5">
              {s.dialog ? (
                <p className="text-sm leading-6 text-zinc-800">“{s.dialog}”</p>
              ) : (
                <p className="text-sm italic text-zinc-500">
                  {s.tanpa_orang ? "Shot produk — tanpa dialog." : "Tanpa dialog."}
                </p>
              )}

              {/* Prompt ditampilkan apa adanya: ini teks yang benar-benar
                  dikirim ke mesin video. Menyembunyikannya berarti meminta
                  pengguna menyetujui sesuatu yang tidak boleh ia baca. */}
              <button
                type="button"
                onClick={() => setBuka(buka === s.idx ? null : s.idx)}
                className="min-h-[36px] text-xs font-semibold text-zinc-500 underline underline-offset-2"
              >
                {buka === s.idx ? "Sembunyikan arahan kamera" : "Lihat arahan kamera"}
              </button>
              {buka === s.idx && (
                <p className="rounded-lg bg-zinc-50 p-2.5 text-[11px] leading-5 text-zinc-600">{s.prompt}</p>
              )}

              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[11px] text-zinc-400">
                  {s.sisa_regen > 0 ? `Bisa diganti ${s.sisa_regen}x lagi` : "Jatah ganti habis"}
                </span>
                <button
                  type="button"
                  disabled={sibuk || masihBerjalan || s.sisa_regen === 0}
                  onClick={() => void ganti(s.idx)}
                  className="min-h-[40px] rounded-lg border border-zinc-300 px-3.5 text-sm font-semibold text-zinc-700 disabled:opacity-40"
                >
                  Ganti gambar
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {galat && <ErrorText message={galat} />}

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md space-y-2 border-t border-zinc-200 bg-white/95 p-4 backdrop-blur">
        <button
          type="button"
          disabled={sibuk || !data.siap}
          onClick={() => void generate()}
          className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-zinc-900 px-6 text-base font-bold text-white shadow-lg shadow-zinc-900/20 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none"
        >
          {data.siap ? "Generate video sekarang" : "Menunggu semua gambar…"}
        </button>
        <button
          type="button"
          disabled={sibuk}
          onClick={() => void hapus()}
          className="min-h-[40px] w-full text-center text-sm text-zinc-500 disabled:opacity-40"
        >
          Hapus storyboard & ubah skrip
        </button>
      </div>
    </main>
  );
}
