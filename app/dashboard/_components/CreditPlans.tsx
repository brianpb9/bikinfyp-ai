"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { rupiah } from "./format";
import { BTN_PRIMARY } from "@/app/dashboard/_components/buttons";

// Paket — TAMPILAN saja (permintaan Brian: "ini di buat aja dlu UI nya").
// Belum ada Duitku untuk organisasi; kredit org masih diisi manual oleh tim.
// Karena itu tombolnya jujur berbunyi "Ajukan" dan membuka kontak, BUKAN
// "Bayar sekarang" yang akan berbohong soal apa yang terjadi setelah diklik.
//
// HARGA DAN KREDIT TIDAK LAGI ADA DI FILE INI.
//
// Sampai 26 Agu 2026 komponen ini menyimpan salinan harganya sendiri
// (SUBSCRIPTIONS/TOPUPS) SEKALIGUS mengimpor PAKET_TOKEN — jadi katalog
// "satu sumber" itu cuma dipakai untuk mengisi harga_idr saat mengirim, dan
// yang DILIHAT pembeli datang dari array lokal. Dua sumber, dan yang di layar
// bukan yang tercatat. Kini keduanya satu: lib/paket-token.ts.
//
// Yang tersisa di sini murni presentasi: kalimat dan keunggulan. Jumlah video
// pun DIHITUNG dari kredit, bukan diketik — angka "± 25 video" yang lama sudah
// salah sejak COGS nyata terbuka, dan angka salah di kartu harga adalah janji
// yang tidak bisa ditepati.

import { PAKET_TOKEN, type PaketToken } from "@/lib/paket-token";
import { jumlahVideo, kredit as fmtKredit } from "@/lib/harga-kredit";

/** Presentasi per paket. Tidak boleh memuat angka harga. */
const NARASI: Record<string, { blurb: string; perks: string[]; popular?: boolean }> = {
  starter: {
    blurb: "Buat brand yang baru mulai rutin bikin konten.",
    perks: ["Semua format: Affiliate, Ads, TVC", "Review scene sebelum digabung"],
  },
  creator: {
    blurb: "Paling pas untuk brand yang jalan tiap minggu.",
    popular: true,
    perks: ["Avatar kustom (foto sendiri)", "Prioritas antrean render", "Library & unduh massal"],
  },
  studio: {
    blurb: "Untuk tim konten dengan banyak SKU.",
    perks: ["Anggota tim tanpa batas", "Pendampingan skrip & konsep", "Dukungan prioritas"],
  },
  agency: {
    blurb: "Untuk agensi yang menangani banyak brand sekaligus.",
    perks: ["Semua fitur Studio", "Workspace terpisah per klien", "Pendampingan langsung"],
  },
};

export function CreditPlans() {
  const [mode, setMode] = useState<"subscription" | "topup">("subscription");
  const [picked, setPicked] = useState<string | null>(null);
  /**
   * Tombolnya DULU tidak melakukan apa pun — tanpa onClick, tanpa request,
   * tanpa jejak (audit ulang MONEY-UI-01). Brand yang memilih paket jutaan
   * rupiah menekannya, lalu tidak terjadi apa-apa dan tidak ada yang tahu ia
   * pernah menekan. Itu kebocoran di titik monetisasi tertinggi produk ini.
   */
  const [kirim, setKirim] = useState(false);
  const [hasil, setHasil] = useState<{ ok: boolean; pesan: string; whatsapp?: string | null } | null>(null);

  async function ajukan() {
    if (!picked) return;
    // Katalog BERSAMA dengan server (lib/paket-token.ts) — id dan harga di
    // layar dijamin sama dengan yang dicatat rute pengajuan.
    const dipilih = PAKET_TOKEN.find((x) => x.id === picked);
    setKirim(true);
    setHasil(null);
    try {
      const res = await fetch("/api/brands/package-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paket: picked,
          // Harga yang TERLIHAT ikut dikirim untuk dibandingkan server dengan
          // katalognya — selisih berarti layar menampilkan harga basi.
          harga_idr: dipilih?.priceIdr ?? null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message_id ?? "Pengajuan gagal dikirim.");
      setHasil({
        ok: true,
        pesan: `Pengajuan paket ${dipilih?.label ?? picked} sudah kami terima. Tim menghubungi maksimal 1 hari kerja.`,
        whatsapp: body.whatsapp ?? null,
      });
    } catch (err) {
      setHasil({ ok: false, pesan: err instanceof Error ? err.message : "Pengajuan gagal dikirim." });
    } finally {
      setKirim(false);
    }
  }

  const langganan = PAKET_TOKEN.filter((p) => p.jenis === "subscription");
  const topup = PAKET_TOKEN.filter((p) => p.jenis === "topup");

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl border border-zinc-300 bg-white p-1">
        {([["subscription", "Langganan"], ["topup", "Top-up sekali"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => { setMode(id); setPicked(null); }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "subscription" ? (
        <div className="grid gap-4 md:grid-cols-4">
          {langganan.map((plan: PaketToken) => {
            const active = picked === plan.id;
            const narasi = NARASI[plan.id];
            // Jumlah video DIHITUNG, bukan diketik. Bawaannya 8 detik karena
            // itu yang benar-benar dijual — dan karena kredit menyamarkan
            // harga, tapi tidak menyamarkan jumlah video.
            const videoStandar = jumlahVideo(plan.kredit, "standar", 8);
            const videoKunciWajah = jumlahVideo(plan.kredit, "kunciWajah", 8);
            return (
              <button
                key={plan.id}
                onClick={() => setPicked(plan.id)}
                className={`relative flex flex-col rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors ${
                  active ? "border-amber-500" : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                {narasi?.popular && (
                  <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-bold text-zinc-950">
                    <Sparkles size={10} /> Paling dipilih
                  </span>
                )}
                <p className="font-display text-lg font-bold text-zinc-900">{plan.label}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{narasi?.blurb}</p>
                <p className="mt-4 font-display text-2xl font-bold text-zinc-900">
                  {rupiah(plan.priceIdr)}
                  <span className="text-sm font-semibold text-zinc-400"> /bln</span>
                </p>
                <p className="mt-0.5 text-xs font-semibold text-emerald-600">
                  Dapat {fmtKredit(plan.kredit)}
                  {plan.kreditBonus > 0 && (
                    <span className="ml-1 text-zinc-400">(+{fmtKredit(plan.kreditBonus)} bonus)</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  ± {videoStandar} video 8 detik, atau {videoKunciWajah} dengan kunci wajah
                </p>
                <ul className="mt-4 space-y-2">
                  {[...(narasi?.perks ?? [])].map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-xs leading-5 text-zinc-600">
                      <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                      {perk}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          {topup.map((pack: PaketToken) => {
            const active = picked === pack.id;
            const bonusPersen = pack.kreditBonus > 0
              ? `+${Math.round((pack.kreditBonus / (pack.kredit - pack.kreditBonus)) * 100)}%`
              : null;
            return (
              <button
                key={pack.id}
                onClick={() => setPicked(pack.id)}
                className={`relative rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors ${
                  active ? "border-amber-500" : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                {bonusPersen && (
                  <span className="absolute right-4 top-4 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    {bonusPersen}
                  </span>
                )}
                <p className="font-display text-2xl font-bold text-zinc-900">{rupiah(pack.priceIdr)}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-600">Jadi {fmtKredit(pack.kredit)} kredit</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">± {jumlahVideo(pack.kredit, "standar", 8)} video 8 detik</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="max-w-md text-xs leading-5 text-zinc-500">
          Paket early access — angkanya penawaran, dikonfirmasi tim sebelum ditagih. Pembayaran
          mandiri untuk organisasi belum aktif: pilih paketnya, lalu tim kami yang mengisikan
          tokennya dan mengatur penagihan.
        </p>
        <button
          type="button"
          disabled={!picked || kirim}
          onClick={ajukan}
          className={BTN_PRIMARY}
        >
          {kirim ? "Mengirim…" : picked ? "Ajukan paket ini" : "Pilih paket dulu"}
        </button>
      </div>

      {hasil && (
        <div className={`rounded-2xl border p-4 text-sm ${hasil.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          <p className="font-semibold">{hasil.pesan}</p>
          {hasil.ok && hasil.whatsapp && (
            <a
              href={`https://wa.me/${hasil.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank" rel="noreferrer"
              className="mt-1 inline-block font-semibold underline underline-offset-2"
            >
              Butuh lebih cepat? Chat WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  );
}
