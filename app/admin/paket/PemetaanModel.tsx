"use client";

import { useState } from "react";

/**
 * PEMETAAN MESIN & MODEL PER PAKET.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA LAYAR INI ADA
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian 4 Sep 2026: menentukan sendiri model tiap paket, "sehingga
 * memungkinkan ekspansi bisnis model apabila kedepan muncul efisiensi bisnis
 * dengan perubahan model untuk setiap packagenya".
 *
 * Sampai kini mesin dan model dipaku di kode. Mengganti model Premium menuntut
 * ubah kode, bangun image, dan deploy — dan deploy terbukti membunuh job yang
 * sedang berjalan. Keputusan komersial tidak seharusnya menuntut rilis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YANG DITAMPILKAN APA ADANYA
 * ────────────────────────────────────────────────────────────────────────────
 * Tiap baris menyatakan apakah nilainya BAWAAN KODE atau keputusan admin, dan
 * menyebut bawaannya. Tanpa itu, layar tidak bisa membedakan "belum pernah
 * diatur" dari "diatur ke nilai yang kebetulan sama" — dan orang yang mengira
 * sudah mengubah sesuatu padahal belum adalah cara termahal kehilangan sore.
 */

interface Baris {
  kualitas: string;
  label: string;
  mesin: string;
  model: string;
  bawaan: boolean;
  mesin_bawaan: string;
  model_bawaan: string;
}

const MESIN = [
  { id: "byteplus", label: "BytePlus (Seedance)", contoh: "dreamina-seedance-2-0-mini-260615" },
  { id: "kie-grok", label: "kie.ai (Grok Imagine)", contoh: "grok-imagine/image-to-video" },
];

export function PemetaanModel({ awal }: { awal: Baris[] }) {
  const [baris, setBaris] = useState<Baris[]>(awal);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [pesan, setPesan] = useState<{ kualitas: string; teks: string; galat: boolean } | null>(null);

  const ubah = (k: string, patch: Partial<Baris>) =>
    setBaris((b) => b.map((x) => (x.kualitas === k ? { ...x, ...patch } : x)));

  async function kirim(b: Baris, keBawaan = false) {
    setSibuk(b.kualitas);
    setPesan(null);
    try {
      const res = await fetch("/api/admin/kredit-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          keBawaan
            ? { aksi: "model_bawaan", kualitas: b.kualitas }
            : { aksi: "model", kualitas: b.kualitas, mesin: b.mesin, model: b.model },
        ),
      });
      const j = (await res.json()) as { message_id?: string; ok?: boolean };
      if (!res.ok) throw new Error(j.message_id ?? "Gagal menyimpan.");
      if (keBawaan) {
        ubah(b.kualitas, { mesin: b.mesin_bawaan, model: b.model_bawaan, bawaan: true });
      } else {
        ubah(b.kualitas, { bawaan: false });
      }
      setPesan({ kualitas: b.kualitas, teks: keBawaan ? "Dikembalikan ke bawaan." : "Tersimpan. Berlaku untuk render berikutnya.", galat: false });
    } catch (e) {
      setPesan({ kualitas: b.kualitas, teks: e instanceof Error ? e.message : "Gagal menyimpan.", galat: true });
    } finally {
      setSibuk(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="font-display text-lg font-bold">Mesin &amp; model per paket</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Menentukan dengan apa tiap paket dirender. Perubahan berlaku untuk render berikutnya —
        job yang sedang berjalan memakai model yang dipilih saat ia dimulai.
      </p>
      {/* Peringatan yang JUJUR, bukan basa-basi: mengganti mesin mengubah biaya
          pokok, dan harga jual TIDAK ikut berubah sendiri. */}
      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-4 text-amber-800">
        Mengganti mesin mengubah <strong>biaya pokok</strong> per video. Harga jual tidak ikut berubah —
        periksa marginnya di bagian harga di atas setelah mengganti.
      </p>

      <div className="mt-4 space-y-3">
        {baris.map((b) => (
          <div key={b.kualitas} className="rounded-xl border border-zinc-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {b.label}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.bawaan ? "bg-zinc-100 text-zinc-600" : "bg-emerald-50 text-emerald-700"}`}>
                  {b.bawaan ? "bawaan kode" : "diatur admin"}
                </span>
              </p>
              {!b.bawaan && (
                <button
                  type="button"
                  onClick={() => void kirim(b, true)}
                  disabled={sibuk === b.kualitas}
                  className="text-xs font-semibold text-zinc-500 underline disabled:opacity-50"
                >
                  Kembalikan ke bawaan
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[220px_1fr_auto]">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-zinc-500">Mesin</span>
                <select
                  value={b.mesin}
                  onChange={(e) => ubah(b.kualitas, { mesin: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                >
                  {MESIN.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-zinc-500">Id model</span>
                <input
                  value={b.model}
                  onChange={(e) => ubah(b.kualitas, { model: e.target.value })}
                  placeholder={MESIN.find((m) => m.id === b.mesin)?.contoh}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
                />
              </label>

              <button
                type="button"
                onClick={() => void kirim(b)}
                disabled={sibuk === b.kualitas || !b.model.trim()}
                className="self-end rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {sibuk === b.kualitas ? "Menyimpan…" : "Simpan"}
              </button>
            </div>

            <p className="mt-2 font-mono text-[11px] text-zinc-400">
              bawaan: {b.mesin_bawaan} · {b.model_bawaan}
            </p>
            {pesan?.kualitas === b.kualitas && (
              <p className={`mt-1 text-xs ${pesan.galat ? "text-red-600" : "text-emerald-700"}`}>{pesan.teks}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
