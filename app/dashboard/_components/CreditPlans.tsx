"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { rupiah, tokens } from "./format";
import { BTN_PRIMARY } from "@/app/dashboard/_components/buttons";
import { PAKET_TOKEN } from "@/lib/paket-token";

// Paket token — TAMPILAN saja (permintaan Brian: "ini di buat aja dlu UI nya").
// Belum ada Midtrans untuk organisasi; token org masih diisi manual oleh tim.
// Karena itu tombolnya jujur berbunyi "Ajukan" dan membuka kontak, BUKAN
// "Bayar sekarang" yang akan berbohong soal apa yang terjadi setelah diklik.
// Harga di bawah adalah ANGKA RANCANGAN yang belum Brian kunci (dia bilang
// "harga bisa kita bahas nanti") — dipisah ke konstanta ini supaya sekali
// ubah, bukan berserakan di markup.

interface Plan {
  id: string; name: string; priceIdr: number; tokenIdr: number;
  blurb: string; perks: string[]; popular?: boolean;
}

const SUBSCRIPTIONS: Plan[] = [
  {
    id: "starter", name: "Starter", priceIdr: 490_000, tokenIdr: 600_000,
    blurb: "Buat brand yang baru mulai rutin bikin konten.",
    perks: ["± 25 video 15 detik / bulan", "Semua format: Affiliate, Ads, TVC", "Review scene sebelum digabung"],
  },
  {
    id: "growth", name: "Growth", priceIdr: 1_900_000, tokenIdr: 2_500_000, popular: true,
    blurb: "Paling pas untuk brand yang jalan tiap minggu.",
    perks: ["± 100 video 15 detik / bulan", "Avatar kustom (foto sendiri)", "Prioritas antrean render", "Library & unduh massal"],
  },
  {
    id: "scale", name: "Scale", priceIdr: 4_900_000, tokenIdr: 7_000_000,
    blurb: "Untuk agensi dan brand dengan banyak SKU.",
    perks: ["± 290 video 15 detik / bulan", "Anggota tim tanpa batas", "Pendampingan skrip & konsep", "Dukungan prioritas"],
  },
];

const TOPUPS = [
  { id: "t1", priceIdr: 250_000, tokenIdr: 250_000, bonus: null },
  { id: "t2", priceIdr: 500_000, tokenIdr: 550_000, bonus: "+10%" },
  { id: "t3", priceIdr: 1_000_000, tokenIdr: 1_150_000, bonus: "+15%" },
  { id: "t4", priceIdr: 2_500_000, tokenIdr: 3_000_000, bonus: "+20%" },
] as const;

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
        <div className="grid gap-4 md:grid-cols-3">
          {SUBSCRIPTIONS.map((plan) => {
            const active = picked === plan.id;
            return (
              <button
                key={plan.id}
                onClick={() => setPicked(plan.id)}
                className={`relative flex flex-col rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors ${
                  active ? "border-amber-500" : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-bold text-zinc-950">
                    <Sparkles size={10} /> Paling dipilih
                  </span>
                )}
                <p className="font-display text-lg font-bold text-zinc-900">{plan.name}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{plan.blurb}</p>
                <p className="mt-4 font-display text-2xl font-bold text-zinc-900">
                  {rupiah(plan.priceIdr)}
                  <span className="text-sm font-semibold text-zinc-400"> /bln</span>
                </p>
                <p className="mt-0.5 text-xs font-semibold text-emerald-600">
                  Dapat {tokens(plan.tokenIdr)}
                </p>
                <ul className="mt-4 space-y-2">
                  {plan.perks.map((perk) => (
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
          {TOPUPS.map((pack) => {
            const active = picked === pack.id;
            return (
              <button
                key={pack.id}
                onClick={() => setPicked(pack.id)}
                className={`relative rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors ${
                  active ? "border-amber-500" : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                {pack.bonus && (
                  <span className="absolute right-4 top-4 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    {pack.bonus}
                  </span>
                )}
                <p className="font-display text-2xl font-bold text-zinc-900">{rupiah(pack.priceIdr)}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-600">Jadi {tokens(pack.tokenIdr)}</p>
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
