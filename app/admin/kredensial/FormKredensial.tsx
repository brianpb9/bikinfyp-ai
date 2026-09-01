"use client";

import { useState } from "react";
import type { BarisTampilan } from "@/lib/kredensial-tipe";

const LENCANA: Record<BarisTampilan["sumber"], { teks: string; kelas: string }> = {
  database: { teks: "database", kelas: "bg-emerald-50 text-emerald-700" },
  env: { teks: ".env server", kelas: "bg-zinc-100 text-zinc-600" },
  kosong: { teks: "kosong", kelas: "bg-red-50 text-red-700" },
};

export function FormKredensial({ baris }: { baris: BarisTampilan }) {
  const [nilai, setNilai] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  async function simpan(kosongkan: boolean) {
    setSibuk(true);
    setPesan(null);
    setGalat(null);
    try {
      const res = await fetch("/api/admin/kredensial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: baris.nama, value: kosongkan ? "" : nilai }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; aksi?: string; message_id?: string };
      if (!res.ok || !d.ok) throw new Error(d.message_id ?? "Gagal menyimpan.");
      setNilai("");
      setPesan(`Tersimpan — ${d.aksi}. Berlaku sekarang, worker menyusul ≤30 detik.`);
      // Muat ulang penuh supaya lencana sumber dan samaran nilainya ikut
      // segar. Ini halaman operator yang jarang dibuka; kesegaran data lebih
      // berharga daripada menghindari satu muat ulang.
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSibuk(false);
    }
  }

  const lencana = LENCANA[baris.sumber];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{baris.label}</p>
          <p className="font-mono text-[11px] text-zinc-400">{baris.nama}</p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${lencana.kelas}`}>
          {lencana.teks}
        </span>
      </div>

      <p className="mt-1.5 font-mono text-xs text-zinc-500">
        {baris.terisi ? baris.contoh : "— belum diisi —"}
        {baris.updated_by && (
          <span className="ml-2 font-sans text-[11px] text-zinc-400">
            diganti {baris.updated_by} · {baris.updated_at?.slice(0, 16).replace("T", " ")}
          </span>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type={baris.rahasia ? "password" : "text"}
          value={nilai}
          onChange={(e) => setNilai(e.target.value)}
          placeholder={baris.terisi ? "Nilai baru (kosongkan untuk tidak mengubah)" : "Isi nilainya"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs focus:border-amber-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={sibuk || nilai.trim() === ""}
          onClick={() => simpan(false)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          {sibuk ? "Menyimpan…" : "Simpan"}
        </button>
        {baris.sumber === "database" && (
          <button
            type="button"
            disabled={sibuk}
            onClick={() => simpan(true)}
            title="Hapus dari database — nilainya kembali ke .env server"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-600 disabled:opacity-40"
          >
            Kembalikan ke .env
          </button>
        )}
      </div>

      {pesan && <p className="mt-2 text-xs font-semibold text-emerald-700">{pesan}</p>}
      {galat && <p className="mt-2 text-xs font-semibold text-red-600">{galat}</p>}
    </div>
  );
}
