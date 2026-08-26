"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { apiFetch, ApiFail } from "../../_components/api";
import { ONBOARDING_AI_SHOWCASE_CLIPS } from "@/lib/onboarding-showcase";

// Onboarding organisasi.
//
// DIRANCANG ULANG 2026-08-12 setelah Brian menunjuk magnific.com sebagai
// standar. Versi lama adalah formulir max-w-xl di tengah layar terang: di
// monitor 1440px, dua pertiga layar kosong sama sekali. Untuk produk yang
// dijual ke brand, layar pertama yang kosong itu sendiri sudah sebuah
// pernyataan — dan pernyataannya salah.
//
// Yang DIAMBIL dari referensi, bukan disalin: (1) panggung gelap sinematik
// alih-alih formulir putih, (2) tipografi display besar dengan satu
// pertanyaan per layar, (3) yang paling penting — PRODUKNYA DIPERLIHATKAN
// BEKERJA, bukan dijelaskan. Warna tetap amber kita; meniru magenta mereka
// berarti menukar identitas sendiri dengan identitas orang lain.
//
// Panel kanan BUKAN hiasan: ia memperlihatkan render AI milik kami yang sudah
// lolos approval registry. Rekomendasi kategori baru ditampilkan setelah
// onboarding, agar footage teardown pihak lain tidak pernah tampil sebagai
// bukti komersial produk ini.

const BUSINESS_TYPES = [
  "Brand produk sendiri", "Reseller / dropship", "Agensi / jasa konten",
  "Toko offline yang mau online", "UMKM", "Lainnya",
];

// Label untuk manusia + KUNCI INTERNAL untuk mesin.
//
// Dulu yang tersimpan hanya labelnya ("Skincare & kecantikan") — enak dibaca,
// tapi tidak bisa dicocokkan ke template mana pun. Akibatnya brand yang
// menyelesaikan onboarding tapi tidak pernah menjalankan analisa bisnis tidak
// pernah mendapat "Pendekatan konten" sama sekali.
const CATEGORIES: { id: string; label: string }[] = [
  { id: "beauty", label: "Skincare & kecantikan" },
  { id: "fashion", label: "Fashion" },
  { id: "muslim_fashion", label: "Fashion muslim" },
  { id: "food", label: "Makanan & minuman" },
  { id: "kitchen", label: "Peralatan rumah & dapur" },
  { id: "gadget", label: "Elektronik & gadget" },
  { id: "health", label: "Kesehatan & suplemen" },
  { id: "kids", label: "Ibu & anak" },
  { id: "default", label: "Lainnya" },
];

const STEPS = ["Brand", "Website", "Produk", "Siap"];

/** Klip sebelum kategori dipilih: RENDER AI MILIK KAMI SENDIRI.
 *
 *  Bukan preview template. Preview template adalah potongan dari portfolio
 *  yang dibedah — rekaman manusia, sebagian masih membawa watermark TikTok
 *  berikut tulisan larangan penggunaan komersial. Memasangnya di bawah judul
 *  "semua ini video AI, tidak ada yang disyuting" berarti menaruh klaim yang
 *  tidak benar di layar PERTAMA yang dilihat brand — dan menaruhnya di atas
 *  frame yang secara harfiah menuliskan larangan pemakaian komersial.
 *
 *  Klip di bawah ini render milik kami yang lolos registry evidence bersama. */
const CONTOH_AWAL = ONBOARDING_AI_SHOWCASE_CLIPS
  .filter((clip) => ["/showcase/persona/unboxing.mp4", "/showcase/persona/close-up.mp4", "/showcase/tangan.mp4"].includes(clip.src))
  .map((clip) => ({
    src: clip.src,
    nama: clip.label,
    ket: clip.src === "/showcase/tangan.mp4"
      ? "Cukup tangan dan produk — pilihan aman untuk brand yang menjaga citra."
      : "Kreator AI memperagakan produk, tanpa syuting dan tanpa talent.",
  }));

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [pitch, setPitch] = useState("");

  const sorotan = CONTOH_AWAL;

  async function finish(skip = false) {
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/dashboard/onboarding", {
        json: skip ? {} : {
          name, business_type: businessType, website_url: websiteUrl,
          category: CATEGORIES.find((c) => c.id === category)?.label ?? "",
          product_category: category,
          audience, elevator_pitch: pitch,
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

  const judul = ["Kenalan dulu", "Punya website atau toko online?", "Jualan apa?", "Semua siap"][step];
  const subjudul = [
    "Dipakai AI sebagai konteks saat menulis skrip. Semuanya bisa diubah nanti.",
    "Opsional. Boleh link Shopee, Tokopedia, TikTok Shop, atau website sendiri.",
    "Menentukan template, gaya bahasa, dan sudut hook yang dipakai AI.",
    "Token organisasi diatur bareng tim kami.",
  ][step];

  return (
    <div className="fixed inset-0 grid grid-cols-1 bg-zinc-950 lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)]">
      {/* ---------- KIRI: pertanyaan ---------- */}
      <div className="flex min-h-0 flex-col overflow-y-auto px-8 py-10 sm:px-14 lg:px-16">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
          <p className="font-display text-sm font-extrabold text-white">
            BikinFYP <span className="text-amber-400">AI</span>
          </p>

          <div className="mt-10 flex items-center gap-3">
            <div className="flex flex-1 gap-1.5">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-[3px] flex-1 rounded-full transition-colors duration-500 ${
                    i <= step ? "bg-amber-400" : "bg-white/12"
                  }`}
                />
              ))}
            </div>
            <p className="shrink-0 text-xs font-semibold tabular-nums text-white/40">
              {step + 1}/{STEPS.length}
            </p>
          </div>

          <h1 className="mt-8 font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-white">
            {judul}
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/50">{subjudul}</p>

          {error && (
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
            </div>
          )}

          <div className="mt-8 flex-1 space-y-6">
            {step === 0 && (
              <>
                <Kolom label="Nama brand kamu">
                  <input
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Glow Beauty ID"
                    autoFocus
                    className={INPUT}
                  />
                </Kolom>
                <Kolom label="Jenis bisnisnya">
                  <div className="grid grid-cols-2 gap-2">
                    {BUSINESS_TYPES.map((t) => (
                      <Pilihan key={t} aktif={businessType === t} onClick={() => setBusinessType(t)}>{t}</Pilihan>
                    ))}
                  </div>
                </Kolom>
              </>
            )}

            {step === 1 && (
              <>
                <input
                  value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="namabisnis.com"
                  autoFocus
                  className={INPUT}
                />
                <p className="text-sm leading-relaxed text-white/40">
                  Nanti di Profil, AI bisa membaca isi website ini dan menyusun profil brand plus
                  pendekatan kontennya otomatis — termasuk klaim mana yang aman dipakai di iklan.
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((c) => (
                    <Pilihan key={c.id} aktif={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Pilihan>
                  ))}
                </div>
                <Kolom label="Siapa pembelinya?" opsional>
                  <input
                    value={audience} onChange={(e) => setAudience(e.target.value)}
                    placeholder="Perempuan 20-35, kerja kantoran, kulit berminyak"
                    className={INPUT}
                  />
                </Kolom>
                <Kolom label="Satu kalimat tentang brand kamu" opsional>
                  <textarea
                    value={pitch} onChange={(e) => setPitch(e.target.value)} rows={2}
                    placeholder="Skincare lokal harga terjangkau untuk kulit tropis."
                    className={`${INPUT} resize-none`}
                  />
                </Kolom>
              </>
            )}

            {step === 3 && (
              <div className="space-y-3">
                {[
                  "Pilih template, masukkan produk, jadi 2–6 variasi video",
                  "Tinjau tiap scene sebelum video digabung",
                  "Unduh satuan atau sekaligus dari Library",
                ].map((t) => (
                  <p key={t} className="flex items-start gap-3 text-[15px] text-white/70">
                    <Check size={16} className="mt-1 shrink-0 text-amber-400" />{t}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="mt-10 flex items-center justify-between gap-4">
            <button
              onClick={() => (step === 0 ? finish(true) : setStep(step - 1))}
              disabled={busy}
              className="text-sm font-semibold text-white/40 transition-colors hover:text-white/70 disabled:opacity-40"
            >
              {step === 0 ? "Lewati dulu" : "Kembali"}
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                className={TOMBOL}
              >
                Lanjut <ArrowRight size={16} />
              </button>
            ) : (
              <button onClick={() => finish(false)} disabled={busy} className={TOMBOL}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Mulai bikin video
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---------- KANAN: produknya, bukan hiasan ----------
          Disembunyikan di bawah lg: di layar sempit, formulir yang harus
          diisi kalah penting dari apa pun yang cuma menemani. */}
      <aside className="relative hidden overflow-hidden bg-zinc-900 lg:block">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_0%,rgba(245,158,11,0.16),transparent_60%)]" />

        <div className="relative flex h-full flex-col justify-center px-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
            Dibikin dengan mesin ini
          </p>
          <h2 className="mt-2 max-w-md font-display text-2xl font-bold leading-snug text-white">
            Semua ini video AI — tidak ada yang disyuting
          </h2>

          <div className="mt-8 flex gap-5">
            {sorotan.map((t, i) => (
              <figure
                key={t.src}
                // Ditinggikan berselang-seling supaya tidak terbaca sebagai tabel.
                className={`min-w-0 flex-1 ${i === 1 ? "lg:-translate-y-6" : ""} transition-transform duration-500`}
              >
                <div className="overflow-hidden rounded-2xl bg-zinc-800 shadow-2xl shadow-black/50 ring-1 ring-white/10">
                  <video
                    key={t.src}
                    src={t.src}
                    autoPlay muted loop playsInline
                    className="aspect-[9/16] w-full object-cover"
                  />
                </div>
                <figcaption className="mt-3">
                  <p className="truncate text-sm font-semibold text-white">{t.nama}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-white/40">{t.ket}</p>
                </figcaption>
              </figure>
            ))}
          </div>

          <p className="mt-9 max-w-md text-sm leading-relaxed text-white/40">
            {category
              ? "Kategori produkmu sudah dipilih. Klip di atas tetap contoh render AI milik kami; rekomendasi template akan muncul setelah onboarding selesai."
              : "Pilih kategori di langkah ketiga untuk menyiapkan rekomendasi template setelah onboarding."}
          </p>
        </div>
      </aside>
    </div>
  );
}

const INPUT =
  "w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-[15px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-amber-400/70 focus:bg-white/[0.07]";

const TOMBOL =
  "inline-flex items-center gap-2 rounded-xl bg-amber-400 px-7 py-3.5 text-sm font-bold text-zinc-950 transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30";

function Kolom({ label, opsional, children }: { label: string; opsional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-semibold text-white/80">
        {label}{opsional && <span className="ml-1.5 font-normal text-white/30">opsional</span>}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Pilihan({ aktif, onClick, children }: { aktif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-4 py-3.5 text-left text-[13px] font-semibold transition-all ${
        aktif
          ? "border-amber-400 bg-amber-400/10 text-amber-200"
          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white/90"
      }`}
    >
      {children}
    </button>
  );
}
