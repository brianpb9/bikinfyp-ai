"use client";

import { useState } from "react";

/**
 * Isi token dompet organisasi brand, dari UI.
 *
 * ---------------------------------------------------------------------------
 * KENAPA
 * ---------------------------------------------------------------------------
 * Sampai 8 Sep 2026 satu-satunya cara mengisi token brand adalah SSH ke server
 * produksi lalu menjalankan scripts/admin-grant-org-credit.mjs. Alur nyatanya
 * jadi: setujui di UI, lalu buka terminal — dan langkah kedua itu yang paling
 * mudah tertunda. Brand duduk dengan saldo nol sesudah "disetujui".
 *
 * ---------------------------------------------------------------------------
 * KONFIRMASI SEBELUM KIRIM, DAN MENYEBUT ANGKANYA
 * ---------------------------------------------------------------------------
 * credit_ledger APPEND-ONLY: baris yang salah tidak bisa dihapus, hanya
 * dilawan baris baru. Jadi salah ketik satu nol bukan sesuatu yang bisa
 * di-undo — ia jadi bagian permanen dari riwayat keuangan pelanggan.
 * Konfirmasinya menampilkan jumlah yang sudah diformat rupiah, karena "5000000"
 * dan "Rp5.000.000" dibaca sangat berbeda oleh mata yang sedang terburu-buru.
 */
/** Jenis yang dijual. Sama persis dengan retail — itu seluruh maksud
 *  perubahan ini (Brian 9 Sep 2026). */
const JENIS = ["standard", "premium", "ultra"] as const;

/** Jumlah yang paling sering dipakai. Tombol cepat mengurangi pengetikan, dan
 *  mengetik lebih sedikit berarti lebih sedikit peluang salah nol. */
const CEPAT = [5, 10, 20, 50];

export function TombolTokenOrg({ orgId, nama }: { orgId: string; nama: string }) {
  const [buka, setBuka] = useState(false);
  const [jenis, setJenis] = useState<(typeof JENIS)[number]>("standard");
  const [jumlah, setJumlah] = useState("");
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const angka = Number(jumlah.replace(/\D/g, ""));
  const sah = Number.isInteger(angka) && angka > 0;

  async function kirim() {
    setSibuk(true);
    setGalat(null);
    try {
      const res = await fetch("/api/admin/org-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, jenis, jumlah: angka, catatan }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message_id?: string };
        throw new Error(d.message_id ?? `Gagal (HTTP ${res.status})`);
      }
      window.location.reload();
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal");
      setSibuk(false);
      setKonfirmasi(false);
    }
  }

  if (!buka) {
    return (
      <button
        type="button"
        onClick={() => setBuka(true)}
        className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
      >
        + Video
      </button>
    );
  }

  return (
    <div className="w-52 space-y-1.5 rounded-lg border border-zinc-300 bg-white p-2 shadow-sm">
      <p className="text-[11px] font-bold text-zinc-900">Isi jatah video · {nama}</p>

      {/* JENIS dipilih lebih dulu: jumlahnya tidak berarti apa-apa tanpa tahu
          jenis apa. Menaruhnya di bawah membuat admin mengetik angka lalu baru
          sadar ia memilih tier yang salah. */}
      <div className="flex gap-1">
        {JENIS.map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => { setJenis(j); setKonfirmasi(false); }}
            className={`flex-1 rounded px-1 py-1 text-[10px] font-semibold capitalize ${
              jenis === j ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {j}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {CEPAT.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => { setJumlah(String(n)); setKonfirmasi(false); }}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              angka === n ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {n}×
          </button>
        ))}
      </div>

      <input
        inputMode="numeric"
        value={jumlah}
        onChange={(e) => { setJumlah(e.target.value.replace(/\D/g, "")); setKonfirmasi(false); }}
        placeholder="Jumlah video"
        className="w-full rounded border border-zinc-300 px-1.5 py-1 text-[11px]"
      />
      <input
        value={catatan}
        onChange={(e) => setCatatan(e.target.value)}
        placeholder="Catatan (opsional)"
        className="w-full rounded border border-zinc-300 px-1.5 py-1 text-[11px]"
      />

      {galat && <p className="text-[10px] font-semibold text-red-700">{galat}</p>}

      {konfirmasi ? (
        <>
          {/* Jenis DAN jumlah disebut ulang: keduanya salah dengan cara yang
              berbeda, dan kredit_video append-only jadi tidak ada tombol undo. */}
          <p className="text-[11px] leading-snug text-zinc-800">
            Tambah <b>{angka} video {jenis}</b> ke <b>{nama}</b>? Tidak bisa dibatalkan.
          </p>
          <div className="flex gap-1">
            <button
              type="button" disabled={sibuk} onClick={() => void kirim()}
              className="flex-1 rounded bg-zinc-900 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {sibuk ? "…" : "Ya, tambah"}
            </button>
            <button
              type="button" disabled={sibuk} onClick={() => setKonfirmasi(false)}
              className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600"
            >
              Batal
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-1">
          <button
            type="button" disabled={!sah} onClick={() => setKonfirmasi(true)}
            className="flex-1 rounded bg-zinc-900 px-2 py-1 text-[11px] font-bold text-white disabled:bg-zinc-300 disabled:text-zinc-500"
          >
            Lanjut
          </button>
          <button
            type="button" onClick={() => { setBuka(false); setJumlah(""); setGalat(null); }}
            className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600"
          >
            Tutup
          </button>
        </div>
      )}
    </div>
  );
}
