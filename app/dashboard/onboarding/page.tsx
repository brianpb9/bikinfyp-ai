"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { apiFetch, ApiFail } from "../../_components/api";

// Onboarding organisasi (referensi Jasper "Tell us about yourself" + SocialBu
// "Step 1 of 5" yang Brian kirim).
//
// Empat langkah, dan SEMUANYA bisa dilewati. Ini bukan formulir pendaftaran —
// brand sudah punya akun saat sampai di sini. Isinya cuma konteks yang membuat
// skrip AI lebih nyambung, jadi memaksanya hanya akan membuat orang mengarang
// jawaban, dan data karangan lebih buruk daripada data kosong.

const BUSINESS_TYPES = [
  "Brand produk sendiri", "Reseller / dropship", "Agensi / jasa konten",
  "Toko offline yang mau online", "UMKM", "Lainnya",
];
const CATEGORIES = [
  "Skincare & kecantikan", "Fashion", "Fashion muslim", "Makanan & minuman",
  "Peralatan rumah & dapur", "Elektronik & gadget", "Kesehatan & suplemen",
  "Ibu & anak", "Lainnya",
];
const STEPS = ["Brand", "Website", "Produk", "Paket"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [pitch, setPitch] = useState("");

  async function finish(skip = false) {
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/dashboard/onboarding", {
        json: skip ? {} : {
          name, business_type: businessType, website_url: websiteUrl,
          category, audience, elevator_pitch: pitch,
        },
      });
      // Muat ulang penuh, bukan router.push: gerbang onboarding ada di layout
      // Server Component, dan navigasi klien akan menyajikannya dari cache
      // dengan keadaan lama — brand langsung dilempar balik ke sini.
      window.location.href = "/dashboard/templates";
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menyimpan.");
      setBusy(false);
    }
  }

  const canNext =
    step === 0 ? Boolean(name.trim() && businessType) :
    step === 2 ? Boolean(category) : true;

  return (
    <div className="mx-auto max-w-xl space-y-8 py-6">
      <div className="text-center">
        <p className="text-xs font-semibold text-zinc-500">Langkah {step + 1} dari {STEPS.length}</p>
        <div className="mx-auto mt-3 flex max-w-xs gap-1.5">
          {STEPS.map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-amber-500" : "bg-zinc-200"}`} />
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-5">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-zinc-900">Kenalan dulu yuk</h1>
            <p className="mt-1 text-sm text-zinc-500">Dipakai AI sebagai konteks. Semuanya bisa diubah nanti.</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-800">Nama brand kamu</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Glow Beauty ID"
              className="mt-1.5 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-800">Jenis bisnisnya</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {BUSINESS_TYPES.map((t) => (
                <button
                  key={t} onClick={() => setBusinessType(t)}
                  className={`rounded-xl border-2 px-3 py-3 text-left text-xs font-semibold transition-colors ${
                    businessType === t ? "border-amber-500 bg-amber-50 text-amber-900" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-zinc-900">Punya website atau toko online?</h1>
            <p className="mt-1 text-sm text-zinc-500">Opsional. Boleh link Shopee, Tokopedia, TikTok Shop, atau website sendiri.</p>
          </div>
          <input
            value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="namabisnis.com"
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400"
          />
          <p className="text-xs leading-5 text-zinc-500">
            Kamu juga bisa menempel link ini nanti di Profil, dan AI akan membaca isinya
            untuk mengisi profil brand otomatis.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-zinc-900">Jualan apa?</h1>
            <p className="mt-1 text-sm text-zinc-500">Menentukan gaya bahasa dan sudut hook yang dipakai AI.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c} onClick={() => setCategory(c)}
                className={`rounded-xl border-2 px-3 py-3 text-left text-xs font-semibold transition-colors ${
                  category === c ? "border-amber-500 bg-amber-50 text-amber-900" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-800">Siapa pembelinya? <span className="font-normal text-zinc-400">(opsional)</span></label>
            <input
              value={audience} onChange={(e) => setAudience(e.target.value)}
              placeholder="Perempuan 20-35, kerja kantoran, kulit berminyak"
              className="mt-1.5 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-800">Satu kalimat tentang brand kamu <span className="font-normal text-zinc-400">(opsional)</span></label>
            <textarea
              value={pitch} onChange={(e) => setPitch(e.target.value)}
              rows={2}
              placeholder="Skincare lokal harga terjangkau untuk kulit tropis."
              className="mt-1.5 w-full resize-none rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400"
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-zinc-900">Siap mulai</h1>
            <p className="mt-1 text-sm text-zinc-500">Saldo kredit organisasi diatur bareng tim kami.</p>
          </div>
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            {[
              "Pilih template, masukkan produk, jadi 2–6 variasi video",
              "Tinjau tiap scene sebelum video digabung",
              "Unduh satuan atau sekaligus dari Library",
            ].map((t) => (
              <p key={t} className="flex items-start gap-2 text-sm text-zinc-700">
                <Check size={15} className="mt-0.5 shrink-0 text-emerald-500" />{t}
              </p>
            ))}
          </div>
          <p className="text-center text-xs text-zinc-500">
            Mau lihat paket dan harganya? Buka <b>Kredit &amp; tagihan</b> kapan saja dari menu Profil.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => (step === 0 ? finish(true) : setStep(step - 1))}
          disabled={busy}
          className="text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-800 disabled:opacity-40"
        >
          {step === 0 ? "Lewati dulu" : "Kembali"}
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canNext}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Lanjut <ArrowRight size={15} />
          </button>
        ) : (
          <button
            onClick={() => finish(false)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Mulai bikin video
          </button>
        )}
      </div>
    </div>
  );
}
