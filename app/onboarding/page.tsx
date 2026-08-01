"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail } from "../_components/api";
import { PrimaryButton, ErrorText } from "../_components/ui";

// S0 — ONBOARDING: nilai produk -> nomor HP -> kode OTP WhatsApp -> beranda.
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ dev_hint?: string; message?: string }>("/api/auth/request-otp", {
        json: { email: email.trim() },
      });
      setDevHint(res.dev_hint ?? null);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal kirim kode. Coba lagi ya.");
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/verify-otp", { json: { email: email.trim(), code: code.trim() } });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Kode salah. Coba lagi ya.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-gradient-to-b from-amber-50 to-white px-6 pb-8 pt-16">
      {step === 1 && (
        <>
          <div className="flex-1 space-y-7">
            <div className="mx-auto w-48 overflow-hidden rounded-[28px] bg-zinc-900 shadow-2xl shadow-amber-900/10 ring-1 ring-black/5">
              <video src="/demo/contoh-senyap-teks.mp4" autoPlay muted loop playsInline className="aspect-[9/16] w-full" />
            </div>
            <div className="space-y-3">
              <h1 className="text-center font-display text-[2.3rem] font-extrabold leading-[1.08] tracking-tight text-zinc-900">
                Bikin video jualan
                <br />
                <span className="text-amber-500">tanpa syuting.</span>
              </h1>
              <p className="text-center text-lg text-zinc-600">
                15 detik, siap posting ke TikTok Shop. Cukup foto produk — sisanya kami yang kerjakan.
              </p>
            </div>
            <div>
              <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Hasil video AI kami — bukan mockup
              </p>
              <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[
                  { src: "/showcase/gen-z.webp", label: "Gen-Z" },
                  { src: "/showcase/hijaber.webp", label: "Hijaber" },
                  { src: "/showcase/genz-2.webp", label: "Gen-Z" },
                  { src: "/showcase/lokal.webp", label: "Lokal" },
                ].map((s, i) => (
                  <div key={i} className="relative shrink-0 overflow-hidden rounded-2xl shadow-md ring-1 ring-black/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.src} alt={`Contoh video kategori ${s.label}`} className="h-40 w-[90px] object-cover" loading="lazy" />
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: "⚡", label: "15 detik jadi" },
                { icon: "💸", label: "Mulai Rp5rb" },
                { icon: "🎭", label: "5 gaya kreator" },
              ].map((f) => (
                <div
                  key={f.label}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-amber-100 bg-white/70 px-2 py-3 text-center shadow-sm"
                >
                  <span className="text-xl">{f.icon}</span>
                  <span className="text-xs font-semibold leading-tight text-zinc-700">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
          <PrimaryButton big onClick={() => setStep(2)}>
            Coba Gratis
          </PrimaryButton>
          <button type="button" onClick={() => setStep(2)} className="mt-3 min-h-[44px] w-full text-center text-sm text-zinc-500">
            Sudah punya akun? Masuk
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="flex-1 space-y-6 pt-8">
            <h1 className="text-2xl font-bold text-zinc-900">Masuk pakai email</h1>
            <p className="text-zinc-600">
              Tanpa password. Kami kirim kode 6 digit ke email kamu. User baru langsung dapat bonus Rp5.000.
            </p>
            <form onSubmit={requestOtp} className="space-y-4">
              <input
                type="email"
                inputMode="email"
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                className="min-h-[56px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-lg outline-none focus:border-amber-500"
                autoFocus
              />
              <ErrorText message={error} />
              <PrimaryButton type="submit" disabled={loading || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
                {loading ? "Mengirim kode..." : "Kirim Kode OTP"}
              </PrimaryButton>
            </form>
          </div>
          <button type="button" onClick={() => setStep(1)} className="min-h-[44px] w-full text-center text-sm text-zinc-500">
            ← Kembali
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <div className="flex-1 space-y-6 pt-8">
            <h1 className="text-2xl font-bold text-zinc-900">Masukkan kode OTP</h1>
            <p className="text-zinc-600">
              Kode 6 digit sudah dikirim ke email <b>{email}</b>. Berlaku 5 menit.
              Cek folder spam kalau belum masuk.
            </p>
            {devHint && (
              <p className="rounded-2xl bg-zinc-100 p-3 text-sm text-zinc-600">🛠 {devHint}</p>
            )}
            <form onSubmit={verify} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                placeholder="••••••"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="min-h-[64px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-center text-3xl font-bold tracking-[0.5em] outline-none focus:border-amber-500"
                autoFocus
              />
              <ErrorText message={error} />
              <PrimaryButton type="submit" disabled={loading || code.length !== 6}>
                {loading ? "Memeriksa..." : "Masuk & Mulai"}
              </PrimaryButton>
            </form>
            <button
              type="button"
              onClick={() => requestOtp()}
              disabled={loading}
              className="min-h-[48px] w-full text-center font-semibold text-amber-600 disabled:text-zinc-400"
            >
              Kirim ulang kode
            </button>
          </div>
          <button type="button" onClick={() => setStep(2)} className="min-h-[44px] w-full text-center text-sm text-zinc-500">
            ← Ganti email
          </button>
        </>
      )}
    </div>
  );
}
