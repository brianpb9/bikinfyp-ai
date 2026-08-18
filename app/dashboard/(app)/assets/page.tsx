"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Images, Loader2, Search, Upload } from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";

/**
 * ASSETS — semua foto yang pernah diunggah organisasi ini.
 *
 * Sumbernya products.images (lihat app/api/dashboard/assets/route.ts): tidak
 * ada tabel baru, jadi tidak ada janji yang belum bisa ditepati. Yang BELUM
 * ada dan sengaja tidak dipura-purakan: unggah langsung dari halaman ini,
 * dedupe sha256, dan badge kelayakan referensi dari QC-F1.
 */
interface Asset {
  key: string;
  url: string;
  name: string;
  created_at: string;
  used_by: { id: string; nama: string }[];
}
interface AssetsResponse {
  assets: Asset[];
  counts: { assets: number; products: number };
}

export default function AssetsPage() {
  const [data, setData] = useState<AssetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let batal = false;
    apiFetch<AssetsResponse>("/api/dashboard/assets")
      .then((d) => { if (!batal) setData(d); })
      .catch((e) => { if (!batal) setError(e instanceof ApiFail ? e.message : "Gagal memuat aset."); });
    return () => { batal = true; };
  }, []);

  const terlihat = (data?.assets ?? []).filter((a) => {
    if (!q.trim()) return true;
    const teks = `${a.name} ${a.used_by.map((p) => p.nama).join(" ")}`.toLowerCase();
    return teks.includes(q.trim().toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-900">Assets</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Semua foto yang pernah diunggah organisasi ini, lintas produk.
          </p>
        </div>
        {data && (
          <p className="text-sm text-zinc-500">
            {data.counts.assets} aset dari {data.counts.products} produk
          </p>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nama berkas atau produk"
          className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-amber-500"
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {!data && !error && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={15} className="animate-spin" /> Memuat aset…
        </p>
      )}

      {data && terlihat.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <Images size={28} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-sm font-semibold text-zinc-700">
            {data.assets.length === 0 ? "Belum ada foto yang diunggah" : "Tidak ada yang cocok"}
          </p>
          {data.assets.length === 0 && (
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
              Foto yang kamu unggah saat membuat video akan muncul di sini, dan bisa dipakai lagi
              untuk produk berikutnya.
            </p>
          )}
          <Link href="/dashboard/campaign" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:text-amber-800">
            <Upload size={14} /> Unggah lewat Bikin Video
          </Link>
        </div>
      )}

      {data && terlihat.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {terlihat.map((a) => (
            <li key={a.key} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="aspect-square w-full bg-zinc-50 object-contain" loading="lazy" />
              <div className="p-3">
                <p className="truncate text-xs font-semibold text-zinc-700" title={a.name}>{a.name}</p>
                <p className="mt-1 truncate text-[11px] text-zinc-500" title={a.used_by.map((p) => p.nama).join(", ")}>
                  {a.used_by.length === 1 ? a.used_by[0].nama : `dipakai di ${a.used_by.length} produk`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Dikatakan apa adanya, bukan dijanjikan diam-diam. */}
      <p className="rounded-xl bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-500">
        Halaman ini membaca foto dari produk yang sudah ada. Unggah langsung dari sini, penandaan
        aset yang layak jadi referensi, dan penggabungan berkas kembar belum aktif.
      </p>
    </div>
  );
}
