"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail } from "../_components/api";
import { PrimaryButton, ErrorText } from "../_components/ui";
import { track } from "../_components/track";

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Login Google dibatalkan.",
  state_mismatch: "Sesi login-nya kedaluwarsa, coba lagi ya.",
  email_not_verified: "Email Google kamu belum terverifikasi. Pakai email lain atau login pakai OTP.",
};

// S0 — ONBOARDING: nilai produk -> nomor HP -> kode OTP WhatsApp -> beranda.
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthlyVideos, setMonthlyVideos] = useState(10);
  const [tierPrice, setTierPrice] = useState<12000 | 49000>(12000);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    track("landing_view");
  }, []);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("google_error");
    if (!reason) return;
    setStep(2);
    setError(GOOGLE_ERROR_MESSAGES[reason] ?? "Login Google gagal. Coba lagi atau pakai OTP email.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const humanCost = monthlyVideos * 125_000;
  const aiCost = monthlyVideos * tierPrice;
  const saving = humanCost - aiCost;
  const savingPercent = Math.round((saving / humanCost) * 100);

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
      track("signup_success");
      // Datang dari /coba? Langsung ke form produk (data percobaan prefill di S2).
      router.replace(sessionStorage.getItem("racun.try") ? "/bikin/produk" : "/");
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Kode salah. Coba lagi ya.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-gradient-to-b from-amber-50 via-white to-amber-50/40 px-6 pb-8 pt-10">
      {step === 1 && (
        <>
          <div className="flex-1 space-y-9">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
              <span className="font-display text-base font-extrabold text-zinc-900">Bikin<span className="text-amber-500">FYP</span>.AI</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">● Harga transparan</span>
            </div>
            <div className="mx-auto w-48 overflow-hidden rounded-[28px] bg-zinc-900 shadow-2xl shadow-amber-900/10 ring-1 ring-black/5">
              <video src="/demo/contoh-hero.mp4" autoPlay muted loop playsInline className="aspect-[9/16] w-full" />
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
              {/* Magic moment tanpa daftar (2026-08-06): rasakan hasil dulu, daftar belakangan. */}
              <a
                href="/coba"
                onClick={() => track("try_signup_click", { from: "hero" })}
                className="mx-auto flex min-h-[48px] w-fit items-center justify-center rounded-2xl border-2 border-amber-400 bg-white px-6 font-bold text-amber-600 shadow-sm active:bg-amber-50"
              >
                ✍️ Coba lihat skripmu dulu — tanpa daftar
              </a>
            </div>
            <div>
              <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Hasil video AI kami — bukan mockup
              </p>
              <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* Render BytePlus asli (2026-08-06) — video bergerak, bukan still. */}
                {[
                  { src: "/showcase/hijaber.mp4", label: "Hijaber" },
                  { src: "/showcase/genz.mp4", label: "Gen-Z" },
                  { src: "/showcase/ibu.mp4", label: "Ibu" },
                  { src: "/showcase/tangan.mp4", label: "Tanpa wajah" },
                ].map((s, i) => (
                  <div key={i} className="relative shrink-0 overflow-hidden rounded-2xl shadow-md ring-1 ring-black/5">
                    <video src={s.src} autoPlay muted loop playsInline className="h-40 w-[90px] object-cover" />
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "15 detik", label: "video siap posting" },
                { value: "~2–3 menit", label: "waktu render rata-rata staging" },
                { value: "5 gaya", label: "kreator AI aktif" },
                { value: "Rp12.000", label: "harga per video bersuara" },
              ].map((f) => (
                <div
                  key={f.label}
                  className="rounded-2xl border border-amber-100 bg-white px-3 py-3 shadow-sm"
                >
                  <p className="font-display text-lg font-extrabold text-zinc-900">{f.value}</p>
                  <p className="text-[11px] leading-tight text-zinc-500">{f.label}</p>
                </div>
              ))}
            </div>

            <section className="rounded-[28px] bg-zinc-900 p-5 text-white shadow-xl shadow-zinc-900/15">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Kalkulator hemat biaya</p>
              <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight">Berapa video yang kamu butuh tiap bulan?</h2>
              <div className="mt-5 flex items-end justify-between"><span className="text-4xl font-extrabold text-amber-300">{monthlyVideos}</span><span className="mb-1 text-sm text-zinc-300">video / bulan</span></div>
              <input aria-label="Jumlah video per bulan" type="range" min="1" max="100" value={monthlyVideos} onChange={(e) => setMonthlyVideos(Number(e.target.value))} className="mt-3 w-full accent-amber-400" />
              <div className="mt-5 grid grid-cols-3 gap-2">
                {([{ label: "AI Bersuara", price: 12000 }, { label: "Bersuara Pro", price: 49000 }] as const).map((tier) => <button type="button" key={tier.price} onClick={() => setTierPrice(tier.price)} className={`rounded-xl border px-2 py-2 text-left text-[11px] font-bold ${tierPrice === tier.price ? "border-amber-300 bg-amber-400 text-zinc-950" : "border-zinc-700 text-zinc-200"}`}><span className="block leading-tight">{tier.label}</span><span className="mt-1 block text-xs">Rp{tier.price.toLocaleString("id-ID")}</span></button>)}
              </div>
              <div className="mt-5 rounded-2xl bg-white p-4 text-zinc-900"><div className="flex justify-between text-xs text-zinc-500"><span>Jasa UGC manusia*</span><span className="line-through">Rp{humanCost.toLocaleString("id-ID")}</span></div><div className="mt-1 flex justify-between text-xs text-zinc-500"><span>BikinFYP AI</span><span>Rp{aiCost.toLocaleString("id-ID")}</span></div><p className="mt-3 font-display text-2xl font-extrabold text-emerald-600">Hemat Rp{saving.toLocaleString("id-ID")}</p><p className="text-sm font-bold text-emerald-600">{savingPercent}% lebih hemat</p></div>
              <p className="mt-3 text-[10px] leading-relaxed text-zinc-400">*Estimasi Rp100–150 ribu/video dari riset pasar Fastwork; kalkulator memakai titik tengah Rp125 ribu.</p>
            </section>

            <section className="rounded-[26px] border border-zinc-100 bg-white p-5 shadow-sm">
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">Checkout aman lewat</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs font-extrabold text-zinc-600"><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">GoPay</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">OVO</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">DANA</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">QRIS</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">BCA VA</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">VISA</span></div>
              <p className="mt-3 text-center text-[11px] text-zinc-400">Metode ditampilkan oleh Midtrans Snap sesuai kanal merchant yang aktif.</p>
            </section>

            <section><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-600">Jawaban jujur sebelum mulai</p><h2 className="mt-1 font-display text-2xl font-extrabold text-zinc-900">Yang perlu kamu tahu</h2><div className="mt-4 space-y-2">{[
              ["Videonya kelihatan AI? Aman dari TikTok Shop?", "Video diberi label AIGC dan kamu tetap perlu menyalakan label konten AI saat upload. Kami tidak menyembunyikan asal konten—ini membantu kamu mengikuti aturan platform."],
              ["Kalau hasilnya jelek gimana?", "Sistem QC memeriksa wajah yang tidak diinginkan dan konsistensi produk. Jika job gagal QC atau gagal render, kredit di-release otomatis lewat ledger."],
              ["Foto produk aku dipakai bagaimana?", "Foto asli dipakai sebagai referensi visual produk. Pipeline menjaga produk tetap konsisten; bukan meminta AI mengarang ulang detail produkmu."],
              ["Bisa pakai link Tokopedia langsung?", "Tokopedia dapat dibaca best-effort. TikTok Shop dan Shopee yang memblokir pembacaan otomatis akan meminta kamu isi detail produk secara manual."],
              ["Berapa lama sampai jadi?", "Pengukuran staging nyata berada di kisaran 2–3 menit untuk render 15 detik; waktu dapat berubah mengikuti antrean dan provider."],
              ["Ada garansi kalau render gagal?", "Ya. Hold kredit dilepas otomatis ketika job gagal, jadi saldo bisa dipakai lagi untuk mencoba render berikutnya."],
            ].map(([q,a],i)=><div key={q} className="rounded-2xl border border-zinc-200 bg-white"><button type="button" onClick={()=>setOpenFaq(openFaq===i?null:i)} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left text-sm font-bold text-zinc-800"><span>{q}</span><span className="text-amber-500">{openFaq===i?"−":"+"}</span></button>{openFaq===i&&<p className="border-t border-zinc-100 px-4 py-3 text-sm leading-relaxed text-zinc-600">{a}</p>}</div>)}</div></section>
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
              Tanpa password. Kami kirim kode 6 digit ke email kamu. User baru langsung dapat bonus Rp12.000 (1 video gratis).
            </p>
            <a
              href="/api/auth/google"
              className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white text-base font-semibold text-zinc-700 active:bg-zinc-50"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.79h5.4a4.63 4.63 0 0 1-2 3.04v2.5h3.24c1.9-1.75 3-4.32 3-7.33Z" />
                <path fill="#34A853" d="M10 20c2.7 0 4.96-.9 6.62-2.44l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H1.06v2.58A10 10 0 0 0 10 20Z" />
                <path fill="#FBBC05" d="M4.41 11.9a6 6 0 0 1 0-3.8V5.52H1.06a10 10 0 0 0 0 8.96l3.35-2.58Z" />
                <path fill="#EA4335" d="M10 3.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.06 5.52L4.41 8.1C5.2 5.73 7.4 3.98 10 3.98Z" />
              </svg>
              Masuk pakai Google
            </a>
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <div className="h-px flex-1 bg-zinc-200" /> atau <div className="h-px flex-1 bg-zinc-200" />
            </div>
            <form onSubmit={requestOtp} className="space-y-4">
              <input
                type="email"
                inputMode="email"
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                className="min-h-[56px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-lg outline-none focus:border-amber-500"
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
