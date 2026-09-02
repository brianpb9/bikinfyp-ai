"use client";

import { useState } from "react";

export interface BarisHarga { jenis: string; label: string; harga_idr: number | null }
export interface BarisPaket {
  id: string; nama: string; keterangan: string; harga_idr: number;
  kuota_standard: number; kuota_premium: number; kuota_ultra: number;
  masa_hari: number; urutan: number; aktif: boolean;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

const KOSONG: BarisPaket = {
  id: "", nama: "", keterangan: "", harga_idr: 0,
  kuota_standard: 0, kuota_premium: 0, kuota_ultra: 0,
  masa_hari: 30, urutan: 0, aktif: true,
};

async function kirim(body: unknown): Promise<void> {
  const res = await fetch("/api/admin/kredit-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message_id?: string };
  if (!res.ok || !d.ok) throw new Error(d.message_id ?? "Gagal menyimpan.");
}

export function PengaturPaket({ hargaAwal, paketAwal }: { hargaAwal: BarisHarga[]; paketAwal: BarisPaket[] }) {
  const [harga, setHarga] = useState(() =>
    Object.fromEntries(hargaAwal.map((h) => [h.jenis, h.harga_idr ? String(h.harga_idr) : ""])),
  );
  const [draf, setDraf] = useState<BarisPaket>(KOSONG);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  async function jalankan(kerja: () => Promise<void>, sukses: string) {
    setSibuk(true); setPesan(null); setGalat(null);
    try {
      await kerja();
      setPesan(sukses);
      // Muat ulang penuh: harga dan paket dipakai layar lain di detik yang
      // sama (checkout membacanya dari server), jadi layar ini tidak boleh
      // menampilkan keadaan yang berbeda dari yang sudah berlaku.
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSibuk(false);
    }
  }

  const isi = (k: keyof BarisPaket) => (v: string) =>
    setDraf((d) => ({ ...d, [k]: k === "nama" || k === "keterangan" || k === "id" ? v : Number(v || 0) }));

  return (
    <>
      <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="font-display text-lg font-bold">Ubah harga satuan</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {hargaAwal.map((h) => (
            <label key={h.jenis} className="block text-sm">
              <span className="font-medium">{h.label}</span>
              <input
                type="number" min={1000} step={500} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                placeholder="mis. 10000"
                value={harga[h.jenis] ?? ""}
                onChange={(e) => setHarga((s) => ({ ...s, [h.jenis]: e.target.value }))}
              />
              <button
                type="button" disabled={sibuk || !harga[h.jenis]}
                className="mt-2 w-full rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
                onClick={() => jalankan(
                  () => kirim({ aksi: "harga", jenis: h.jenis, harga_idr: Number(harga[h.jenis]) }),
                  `Harga ${h.label} disimpan.`,
                )}
              >
                Simpan
              </button>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="font-display text-lg font-bold">Paket langganan</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Mengubah isi paket TIDAK mengubah langganan yang sudah berjalan — kuota disalin saat pembeli membayar.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2">Paket</th><th>Harga</th><th>Standard</th><th>Premium</th><th>Ultra</th>
                <th>Masa</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {paketAwal.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-zinc-500">Belum ada paket. Tambahkan di bawah.</td></tr>
              )}
              {paketAwal.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100">
                  <td className="py-2">
                    <span className="font-bold">{p.nama}</span>
                    <span className="ml-2 text-xs text-zinc-400">{p.id}</span>
                  </td>
                  <td className="tabular-nums">{rupiah(p.harga_idr)}</td>
                  <td className="tabular-nums">{p.kuota_standard}</td>
                  <td className="tabular-nums">{p.kuota_premium}</td>
                  <td className="tabular-nums">{p.kuota_ultra}</td>
                  <td className="tabular-nums">{p.masa_hari} hari</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.aktif ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                      {p.aktif ? "dijual" : "nonaktif"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button type="button" className="text-xs underline" onClick={() => setDraf(p)}>ubah</button>
                    {p.aktif && (
                      <button
                        type="button" disabled={sibuk}
                        className="ml-3 text-xs text-red-600 underline disabled:opacity-40"
                        onClick={() => jalankan(() => kirim({ aksi: "nonaktif", id: p.id }), `Paket ${p.nama} dinonaktifkan.`)}
                      >
                        nonaktifkan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 rounded-xl border border-dashed border-zinc-300 p-4">
          <h3 className="font-bold">{paketAwal.some((p) => p.id === draf.id) ? `Ubah paket ${draf.id}` : "Paket baru"}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Id (huruf kecil, tanpa spasi)
              <input className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={draf.id}
                onChange={(e) => isi("id")(e.target.value)} placeholder="pemula" />
            </label>
            <label className="text-sm">Nama
              <input className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={draf.nama}
                onChange={(e) => isi("nama")(e.target.value)} placeholder="Pemula" />
            </label>
            <label className="text-sm sm:col-span-2">Keterangan
              <input className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={draf.keterangan}
                onChange={(e) => isi("keterangan")(e.target.value)} placeholder="Buat yang baru mulai bikin konten" />
            </label>
            <label className="text-sm">Harga (Rp)
              <input type="number" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={draf.harga_idr || ""} onChange={(e) => isi("harga_idr")(e.target.value)} />
            </label>
            <label className="text-sm">Masa berlaku (hari)
              <input type="number" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={draf.masa_hari} onChange={(e) => isi("masa_hari")(e.target.value)} />
            </label>
            <label className="text-sm">Kuota Standard
              <input type="number" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={draf.kuota_standard} onChange={(e) => isi("kuota_standard")(e.target.value)} />
            </label>
            <label className="text-sm">Kuota Premium
              <input type="number" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={draf.kuota_premium} onChange={(e) => isi("kuota_premium")(e.target.value)} />
            </label>
            <label className="text-sm">Kuota Ultra
              <input type="number" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={draf.kuota_ultra} onChange={(e) => isi("kuota_ultra")(e.target.value)} />
            </label>
            <label className="text-sm">Urutan tampil
              <input type="number" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={draf.urutan} onChange={(e) => isi("urutan")(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button" disabled={sibuk}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              onClick={() => jalankan(() => kirim({ aksi: "paket", paket: draf }), `Paket ${draf.nama || draf.id} disimpan.`)}
            >
              Simpan paket
            </button>
            <button type="button" className="text-sm underline" onClick={() => setDraf(KOSONG)}>kosongkan</button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draf.aktif} onChange={(e) => setDraf((d) => ({ ...d, aktif: e.target.checked }))} />
              dijual
            </label>
          </div>
        </div>

        {pesan && <p className="mt-3 text-sm text-emerald-700">{pesan}</p>}
        {galat && <p className="mt-3 text-sm text-red-600">{galat}</p>}
      </section>
    </>
  );
}
