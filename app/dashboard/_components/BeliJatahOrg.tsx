"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Beli JATAH VIDEO untuk organisasi, dari dashboard brand.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MENGGANTIKAN "TOKEN"
 * ---------------------------------------------------------------------------
 * Brian 9 Sep 2026: "untuk level organisasi mekanisme topup quantity per
 * kategori video dapat dilakukan dari dashboard. Saat ini topup-nya masih
 * berupa rupiah."
 *
 * Halaman lama menjual token dengan kurs 1 token = Rp1, sementara dompetnya
 * (migrasi 0041) sudah berisi jatah per jenis. Jadi brand memegang "3 video
 * premium", membeli "Rp500.000 token", dan harus menerjemahkan sendiri di
 * kepala — dua satuan untuk satu barang.
 *
 * ---------------------------------------------------------------------------
 * KENAPA JUMLAHNYA DIKETIK, BUKAN PAKET TETAP
 * ---------------------------------------------------------------------------
 * Brand membeli untuk kampanye: "20 standard buat konten harian, 5 ultra buat
 * hero video". Paket tetap memaksa mereka membeli komposisi yang bukan
 * rencananya, lalu menyisakan jatah jenis yang tidak dipakai — dan sisa yang
 * tidak terpakai adalah keluhan yang paling sering kembali.
 */

interface Jenis {
  id: string;
  nama: string;
  harga_idr: number;
  bisa_ditopup: boolean;
}

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export function BeliJatahOrg({ jenis }: { jenis: Jenis[] }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(false);

  const bisa = jenis.filter((j) => j.bisa_ditopup);
  const items = useMemo(
    () => bisa.map((j) => ({ jenis: j.id, qty: qty[j.id] ?? 0 })).filter((i) => i.qty > 0),
    [bisa, qty],
  );
  const total = useMemo(
    () => items.reduce((n, i) => n + i.qty * (bisa.find((j) => j.id === i.jenis)?.harga_idr ?? 0), 0),
    [items, bisa],
  );

  function ubah(id: string, delta: number) {
    setGalat(null);
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] ?? 0) + delta)) }));
  }

  async function beli() {
    if (items.length === 0) return;
    // Kunci ganda: tombol dinonaktifkan DAN penjaga di sini. Klik ganda pada
    // jaringan lambat pernah melahirkan dua invoice untuk satu niat beli, dan
    // pembeli hanya melihat satu.
    if (kunci.current) return;
    kunci.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      const res = await fetch("/api/kredit-video/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Tidak ada org_id di sini — server menentukannya dari keanggotaan.
        // Kalau klien boleh mengirimnya, siapa pun yang tahu sebuah id
        // organisasi bisa mengarahkan pembelian orang lain ke dompetnya.
        body: JSON.stringify({ mode: "topup", items }),
      });
      const d = (await res.json().catch(() => ({}))) as { message_id?: string; redirect_url?: string };
      if (!res.ok) throw new Error(d.message_id ?? `Gagal (HTTP ${res.status})`);
      if (d.redirect_url) window.location.href = d.redirect_url;
      else throw new Error("Gateway tidak memberi alamat pembayaran.");
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memulai pembayaran.");
      setSibuk(false);
      kunci.current = false;
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-zinc-900">Isi jatah video</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Pilih jumlah per kategori. Jatahnya masuk ke dompet organisasi dan bisa dipakai semua anggota.
        </p>
      </div>

      <div className="space-y-2">
        {bisa.map((j) => {
          const n = qty[j.id] ?? 0;
          return (
            <div key={j.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold capitalize text-zinc-900">{j.nama}</p>
                <p className="text-[11px] text-zinc-500">{rupiah(j.harga_idr)} / video</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button" onClick={() => ubah(j.id, -1)} disabled={n === 0}
                  aria-label={`Kurangi ${j.nama}`}
                  className="h-9 w-9 rounded-lg border border-zinc-300 text-lg leading-none text-zinc-700 disabled:opacity-30"
                >−</button>
                <span className="w-9 text-center text-sm font-bold tabular-nums text-zinc-900">{n}</span>
                <button
                  type="button" onClick={() => ubah(j.id, 1)}
                  aria-label={`Tambah ${j.nama}`}
                  className="h-9 w-9 rounded-lg border border-zinc-300 text-lg leading-none text-zinc-700"
                >+</button>
              </div>
            </div>
          );
        })}
      </div>

      {galat && <p className="text-xs font-semibold text-red-700">{galat}</p>}

      {/* Total disebut SEBELUM tombol, bukan sesudah: yang menekan tombol harus
          sudah tahu angkanya, bukan menemukannya di halaman gateway. */}
      <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2.5">
        <span className="text-xs text-zinc-600">
          {items.length === 0 ? "Belum ada yang dipilih" : `${items.reduce((n, i) => n + i.qty, 0)} video`}
        </span>
        <span className="font-display text-lg font-bold tabular-nums text-zinc-900">{rupiah(total)}</span>
      </div>

      <button
        type="button"
        disabled={sibuk || items.length === 0}
        onClick={() => void beli()}
        className="min-h-[48px] w-full rounded-xl bg-zinc-900 text-sm font-bold text-white disabled:bg-zinc-300 disabled:text-zinc-500"
      >
        {sibuk ? "Menyiapkan pembayaran…" : "Lanjut bayar"}
      </button>
    </section>
  );
}
