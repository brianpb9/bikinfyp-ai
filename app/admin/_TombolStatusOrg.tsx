"use client";

import { useState } from "react";

/**
 * Tombol setujui / tangguhkan organisasi brand di daftar pengguna admin.
 *
 * Brian memilih ruang lingkup admin "label + filter saja", dan ini satu-satunya
 * tambahan di luar itu — tapi ia diperlukan oleh keputusannya yang lain:
 * pendaftaran brand butuh persetujuan, dan persetujuan butuh sesuatu untuk
 * ditekan. Tanpa ini, satu-satunya cara menyetujui brand adalah membuka psql.
 */
export function TombolStatusOrg({ orgId, status }: { orgId: string; status: string }) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function ubah(baru: "active" | "suspended") {
    setSibuk(true);
    setGalat(null);
    try {
      const res = await fetch("/api/admin/org-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, status: baru }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message_id?: string };
        throw new Error(d.message_id ?? `Gagal (HTTP ${res.status})`);
      }
      // Muat ulang supaya seluruh daftar dan hitungannya ikut benar. Mengubah
      // satu baris di layar tanpa memuat ulang membuat angka "N brand" di atas
      // menjadi bohong sampai halaman dibuka lagi.
      window.location.reload();
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal");
      setSibuk(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      {status === "pending" && (
        <button
          type="button"
          disabled={sibuk}
          onClick={() => ubah("active")}
          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {sibuk ? "…" : "Setujui"}
        </button>
      )}
      {status === "active" && (
        <button
          type="button"
          disabled={sibuk}
          onClick={() => ubah("suspended")}
          className="rounded border border-zinc-300 px-2 py-1 text-[11px] font-bold text-zinc-600 disabled:opacity-50"
        >
          {sibuk ? "…" : "Tangguhkan"}
        </button>
      )}
      {status === "suspended" && (
        <button
          type="button"
          disabled={sibuk}
          onClick={() => ubah("active")}
          className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-bold text-emerald-700 disabled:opacity-50"
        >
          {sibuk ? "…" : "Aktifkan"}
        </button>
      )}
      {galat && <span className="text-[11px] text-red-600">{galat}</span>}
    </span>
  );
}
