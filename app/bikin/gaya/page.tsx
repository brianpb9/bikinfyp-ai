"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail, pesanUntukPengguna} from "../../_components/api";
import { TungguNaskah } from "../../_components/TungguNaskah";
import { AVATAR_PRESETS, getAvatarPreset, type AvatarGender } from "../../../lib/avatar-presets";
import { FlowHeader, PrimaryButton, ErrorText, SecondaryButton } from "../../_components/ui";
import { loadFlow, saveFlow, rupiah, type FlowScript, type VideoFormat } from "../../_components/flow";
import { track } from "../../_components/track";
import templateTerbukti from "../../../lib/config/template-terbukti.json";
import { HOOK_LEVELS, type HookLevel } from "@/lib/config/hooks";
import type { QualityTier } from "@/lib/providers/types";
import { setaraBaru } from "@/lib/kualitas-video";

// Preset-first (2026-08-06, riset teardown kompetitor): user memilih HASIL yang
// kelihatan, bukan label abstrak — kartu format menampilkan contoh render nyata
// (video loop / still), fallback ikon untuk format yang belum punya sample.
const FORMATS: {
  id: VideoFormat; label: string; icon: string; hint: string; needsAudio: boolean;
  previewVideo?: string; previewImage?: string;
}[] = [
  // Persona-first (keputusan Brian 2026-08-06): Wajah AI default & pertama.
  { id: "talking_head", label: "Wajah AI", icon: "/icons/ui/format-wajah.png", hint: "presenter AI ngomong", needsAudio: true, previewVideo: "/previews/format-wajah.mp4" },
  // 2026-08-07: "Tangan saja" -> "Tangan + VO" (bersuara, narasi voiceover).
  // VO+Foto DIBUANG — kebijakan TikTok tidak lagi mengizinkan format slideshow
  // foto+VO (keputusan Brian 2026-08-07).
  { id: "hands_only", label: "Tangan + VO", icon: "/icons/ui/format-tangan.png", hint: "tanpa wajah, narasi suara AI", needsAudio: true, previewVideo: "/previews/format-tangan.mp4" },
];

const REGISTERS = [
  { id: "bunda", label: "Bunda", hint: "sapaan: bun — hangat, pelan" },
  { id: "bestie", label: "Bestie", hint: "sapaan: say — energik, gemas" },
  { id: "genz", label: "Gen-Z", hint: "sapaan: cuy — gue/lo, blak-blakan" },
  { id: "netral", label: "Netral", hint: "sapaan: kak — ramah, aman" },
];

type Tier = QualityTier;

// Level hook sebagai SLIDER 0-100% (permintaan Brian 2026-08-06, gaya
// "Weirdness"-slider).
//
// TIPENYA DIIMPOR, tidak lagi dideklarasikan ulang di sini. Halaman ini dulu
// punya `type HookLevel = "normal" | "berani" | "gila"` sendiri, dan salinan
// itu diam-diam melenceng saat levelnya jadi lima (keputusan Brian
// 2026-08-11): slider 100 posisi ternyata cuma menghasilkan TIGA hasil
// berbeda, padahal mesin skripnya sudah mendukung kelimanya. Mengimpor dari
// lib/config/hooks.ts membuat pergeseran seperti itu ketahuan saat typecheck.
//
// Copy JUJUR: data kami mendukung hook pertanyaan/payoff cepat; ujung "Gila"
// adalah eksperimen (pembuka visual nyeleneh), BUKAN janji lebih FYP.
function hookLevelFromPct(pct: number): HookLevel {
  // Lima pita sama lebar di sepanjang slider.
  const i = Math.min(HOOK_LEVELS.length - 1, Math.floor((pct / 100) * HOOK_LEVELS.length));
  return HOOK_LEVELS[i];
}
const HOOK_LEVEL_INFO: Record<HookLevel, { icon: string; label: string; hint: string }> = {
  normal: { icon: "✅", label: "Normal", hint: "pola paling terbukti di data" },
  agak_berani: { icon: "🙂", label: "Agak berani", hint: "campur pola agresif sedikit" },
  berani: { icon: "🔥", label: "Berani", hint: "hook lebih nendang" },
  agak_gila: { icon: "😜", label: "Agak gila", hint: "pembuka visual lembut · eksperimen" },
  gila: { icon: "🤪", label: "Gila", hint: "pembuka nyeleneh · eksperimen" },
};

const GENDER_INFO: Record<AvatarGender, { icon: string; label: string }> = {
  female: { icon: "♀", label: "Female" },
  male: { icon: "♂", label: "Male" },
};
interface TierMeta {
  id: string;
  name: string;
  note: string;
  tag: string | null;
  price_idr: number;
}

// S3 — PILIH GAYA (Langkah 2/5) — tier harga AKTIF (keputusan final 3-tier)
export default function GayaPage() {
  const router = useRouter();
  // Bawaan Premium: susunan yang sekarang ditawarkan /api/meta. Tier lama
  // tetap sah kalau datang dari alur tersimpan, tapi bukan lagi titik awal.
  const [tier, setTier] = useState<Tier>("premium");
  const [tiers, setTiers] = useState<TierMeta[]>([]);
  // SISA JATAH per jenis. Tanpa ini, pemilih kualitas menawarkan tier yang
  // jatahnya sudah habis dan orang baru ditolak di langkah TERAKHIR — sesudah
  // menulis naskah, memilih avatar, dan menekan Bikin. Kegagalan yang bisa
  // diramalkan sejak layar ini dibuka.
  const [sisa, setSisa] = useState<Record<string, { total: number }> | null>(null);
  const [format, setFormat] = useState<VideoFormat>("talking_head");
  const [durationSec, setDurationSec] = useState<15 | 30 | 45>(15);
  const [hookPct, setHookPct] = useState(15);
  const hookLevel = hookLevelFromPct(hookPct);
  // Template Terbukti: preset dari pola video pemenang GMV (korelasional).
  const [templateId, setTemplateId] = useState<string | null>(null);

  function applyTemplate(id: string) {
    if (templateId === id) {
      setTemplateId(null); // tap ulang = lepas template
      return;
    }
    const t = templateTerbukti.templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setFormat(t.preset.format as VideoFormat);
    // Preset ditulis dengan nama tier lama. Dipetakan ke padanannya supaya
    // kartu yang tersorot benar-benar ada di daftar yang sedang ditawarkan —
    // kalau tidak, memilih template membuat SEMUA kartu tampak tidak terpilih.
    setTier(setaraBaru(t.preset.qualityTier as Tier));
    setDurationSec(t.preset.format === "talking_head" ? 15 : (t.preset.durationSec as 15 | 30 | 45));
  }
  const restoredFlow = loadFlow();
  const restoredAvatar = getAvatarPreset(restoredFlow.avatarId);
  const initialAvatar = restoredAvatar ?? AVATAR_PRESETS.find((avatar) => avatar.gender === "female")!;
  const validRegisters = new Set(["bunda", "bestie", "genz", "netral"]);
  const [register, setRegister] = useState<string>(validRegisters.has(restoredFlow.register ?? "") ? restoredFlow.register! : initialAvatar.register);
  const [avatarGender, setAvatarGender] = useState<AvatarGender>(initialAvatar.gender);
  const [creatorCategory, setCreatorCategory] = useState(initialAvatar.voice);
  // Roster HDRV sebelumnya hanya tersedia di dashboard brand;
  // retail terkunci di enam preset kategori lama. Tidak ada alasan produk
  // untuk beda itu — penjual perorangan justru yang paling butuh wajah
  // yang tidak pasaran.
  const [avatarId, setAvatarId] = useState<string>(initialAvatar.id);
  // Kunci SINKRON, bukan setLoading. setLoading adalah state React yang
  // diterapkan asinkron, jadi tiga ketukan cepat sempat lolos semuanya sebelum
  // render pertama selesai — terukur audit QA 16 Agu 2026: triple-tap
  // menghasilkan tiga permintaan dan sembilan skrip. Kredit memang ter-dedupe
  // belakangan, tapi compute dan catatan audit tetap terbuang. useRef berubah
  // seketika, jadi ketukan kedua sudah melihat kuncinya terpasang.
  const kunciKirim = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);

  useEffect(() => {
    if (!loadFlow().product) router.replace("/bikin/produk");
    apiFetch<{ tiers: TierMeta[] }>("/api/meta").then((m) => setTiers(m.tiers)).catch(() => {});
    apiFetch<{ sisa: Record<string, { total: number }> }>("/api/kredit-video")
      .then((d) => setSisa(d.sisa))
      .catch(() => setSisa(null));
    track("gaya_view");
  }, [router]);

  useEffect(() => {
    // WAJAH IKUT DILEPAS SAAT GENDER BERGANTI.
    //
    // Tanpa baris ini, memilih Arka lalu menggeser tab ke "Perempuan" hanya
    // mengganti SUARANYA: avatarId masih Arka, jadi deskripsi wajah laki-laki
    // dikirim bersama suara perempuan. Persis cacat yang sudah ditutup di
    // jalur klik langsung (16 Agu), cuma lewat pintu lain — dan pintu itu
    // masih terbuka sampai audit putaran ketiga menemukannya.
    //
    if (avatarId && getAvatarPreset(avatarId)?.gender !== avatarGender) {
      const next = AVATAR_PRESETS.find((avatar) => avatar.gender === avatarGender);
      if (next) {
        setAvatarId(next.id);
        setCreatorCategory(next.voice);
        setRegister(next.register);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarGender]);

  // Pilih otomatis tier yang MASIH punya jatah, sekali saja saat sisa datang.
  // Pendaftar baru cuma punya jatah Standard; membiarkan Premium terpilih
  // berarti tombol Bikin-nya pasti gagal.
  const sudahPilihOtomatis = useRef(false);
  useEffect(() => {
    if (!sisa || sudahPilihOtomatis.current || !tiers.length) return;
    if ((sisa[tier]?.total ?? 0) > 0) { sudahPilihOtomatis.current = true; return; }
    const punya = tiers.find((t) => (sisa[t.id]?.total ?? 0) > 0);
    if (punya) setTier(punya.id as Tier);
    sudahPilihOtomatis.current = true;
  }, [sisa, tiers, tier]);

  const selectedTier = tiers.find((t) => t.id === tier);
  const selectedAvatar = getAvatarPreset(avatarId);

  function selectFormat(id: VideoFormat) {
    setFormat(id); // semua format kini bersuara (tier senyap dihapus 2026-08-06)
    // Wajah AI dibatasi 15 dtk (2026-08-07): >15 dtk = multi-shot = wajah bisa
    // berganti antar potongan (BytePlus menolak referensi wajah, tak bisa dikunci).
    if (id === "talking_head") setDurationSec(15);
  }

  async function generate() {
    const product = loadFlow().product;
    if (!product) return router.replace("/bikin/produk");
    if (!selectedAvatar) { setError("Pilih avatar presenter dulu ya."); return; }
    if (kunciKirim.current) return;
    kunciKirim.current = true;
    setLoading(true);
    setError(null);
    setNoCredits(false);
    try {
      const res = await apiFetch<{ scripts: FlowScript[] }>("/api/scripts/generate", {
        json: {
          product_id: product.productId,
          register,
          emotion: "senang",
          format,
          quality_tier: tier,
          duration_s: durationSec,
          hook_level: hookLevel,
          ...(templateId
            ? { hook_families: templateTerbukti.templates.find((t) => t.id === templateId)?.preset.hookFamilies }
            : {}),
        },
      });
      saveFlow({ register, qualityTier: tier, format, durationSec, hookLevel, creatorCategory, avatarId, avatarDesc: getAvatarPreset(avatarId)?.castLock, scripts: res.scripts, selectedScriptId: undefined });
      router.push("/bikin/skrip");
    } catch (err) {
      if (err instanceof ApiFail && err.code === "INSUFFICIENT_CREDITS") {
        setNoCredits(true);
        saveFlow({ returnTo: "/bikin/gaya" });
      }
      setError(pesanUntukPengguna(err, "Gagal bikin skrip. Coba lagi ya."));
    } finally {
      kunciKirim.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-10">
      {/* Sampai 3 Sep 2026 satu-satunya tanda bahwa naskah sedang ditulis adalah
          tulisan di tombol. Pada koneksi lambat itu tak bisa dibedakan dari
          aplikasi menggantung — dan gerbang viral membuat penantian terburuk
          jadi tiga kali lipat. Lihat catatan di TungguNaskah.tsx. */}
      <TungguNaskah terlihat={loading} />
      <FlowHeader title="Gaya Video" step={2} />
      <div className="space-y-7 px-4">
        <section className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pola dari {templateTerbukti.total_winners} video pemenang</p>
            <h2 className="font-display text-xl font-bold">🏆 Template Terbukti</h2>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {templateTerbukti.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={templateId === t.id}
                onClick={() => applyTemplate(t.id)}
                className={`w-44 shrink-0 rounded-2xl border-2 p-3 text-left shadow-sm transition-transform active:scale-[0.98] ${
                  templateId === t.id ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                }`}
              >
                <p className="text-sm font-bold leading-tight">{t.name}</p>
                <p className="mt-1 text-[11px] leading-4 text-zinc-500">{t.desc}</p>
                <p className="mt-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  {t.count} dari {templateTerbukti.total_winners} video pemenang
                </p>
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-4 text-zinc-400">
            {templateTerbukti.disclaimer} Pilih template = format, durasi & gaya hook ikut diatur otomatis (masih bisa kamu ubah).
          </p>
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Langkah pengaturan</p><h2 className="font-display text-xl font-bold">Format video</h2></div>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={format === f.id}
                onClick={() => selectFormat(f.id)}
                className={`overflow-hidden rounded-2xl border-2 text-center shadow-sm transition-transform active:scale-[0.98] ${
                  format === f.id ? "border-amber-500 bg-amber-50" : "border-zinc-200 bg-white"
                }`}
              >
                {f.previewVideo ? (
                  <video src={f.previewVideo} autoPlay muted loop playsInline className="aspect-[9/16] w-full object-cover" />
                ) : f.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.previewImage} alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center bg-zinc-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.icon} alt="" className="h-10 w-10" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-sm font-bold">{f.label}</p>
                  <p className="text-xs text-zinc-500">{f.hint}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Seberapa berani</p><h2 className="font-display text-xl font-bold">Level hook</h2></div>
          <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-zinc-800">
                <span aria-hidden="true">{HOOK_LEVEL_INFO[hookLevel].icon}</span> {HOOK_LEVEL_INFO[hookLevel].label}
                <span className="ml-1 font-normal text-zinc-500">· {HOOK_LEVEL_INFO[hookLevel].hint}</span>
              </p>
              <p className="font-display text-sm font-bold text-amber-600">{hookPct}%</p>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={hookPct}
              onChange={(e) => setHookPct(Number(e.target.value))}
              aria-label="Level hook: 0 aman sampai 100 gila"
              className="mt-3 h-2 w-full cursor-pointer accent-amber-500"
            />
            <div className="mt-1 flex justify-between text-[10px] font-semibold text-zinc-400">
              <span>Aman & terbukti</span>
              <span>Berani</span>
              <span>Gila 🤪</span>
            </div>
          </div>
          {hookLevel === "gila" && (
            <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Level Gila = pembuka visual super energik. Ini eksperimen — di data kami hook pertanyaan
              yang paling sering menang, jadi cek Skor FYP tiap versi sebelum pilih ya.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih paket</p><h2 className="font-display text-xl font-bold">Kualitas video</h2></div>
          {(tiers.length ? tiers : [{ id: "premium", name: "Premium", note: "Gambar rapi, wajah stabil, suara AI", tag: null, price_idr: 12000 }])
            .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTier(t.id as Tier)}
              // Tier tanpa jatah TIDAK dimatikan, hanya diredupkan dan diberi
              // jalan keluar. Mematikannya menyembunyikan pilihan yang memang
              // ada — orang berhak melihat Ultra dan memutuskan membelinya.
              className={`relative w-full rounded-2xl border-2 p-4 text-left ${
                tier === t.id ? "border-amber-500 bg-amber-50 shadow-sm" : "border-zinc-200 bg-white shadow-sm"
              } ${sisa && (sisa[t.id]?.total ?? 0) === 0 ? "opacity-60" : ""}`}
            >
              {t.tag && (
                <span className="absolute -top-3 right-4 rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold text-white">
                  {t.tag}
                </span>
              )}
              <span className="flex items-center justify-between">
                <span className="font-bold">{t.name}</span>
                <span className="font-bold text-amber-700">{rupiah(Math.round(t.price_idr * (durationSec / 15)))}/video</span>
              </span>
              <span className="text-sm text-zinc-500">{t.note}</span>
              {sisa && (
                <span className="mt-1 block text-xs font-semibold">
                  {(sisa[t.id]?.total ?? 0) > 0 ? (
                    <span className="text-emerald-700">Sisa jatahmu: {sisa[t.id].total} video</span>
                  ) : (
                    <span className="text-amber-700">Jatahmu habis — beli dulu di halaman Kredit</span>
                  )}
                </span>
              )}
            </button>
          ))}
        </section>

        {/* AVATAR — fitur utama, bukan opsional (ala "Choose your avatar"
            kompetitor; permintaan Brian 2026-08-07). Potret = still nyata dari
            render lab terkurasi. */}
        <section className="space-y-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih presenter AI-mu</p><h2 className="font-display text-xl font-bold">Avatar</h2></div>
          {/* Toggle gender (2026-08-10, permintaan Brian) — dipilih dulu
              sebelum daftar avatar, filter kategori yang sudah ada. */}
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(GENDER_INFO) as AvatarGender[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setAvatarGender(g)}
                aria-pressed={avatarGender === g}
                className={`rounded-2xl border-2 py-2.5 text-center text-sm font-bold shadow-sm ${
                  avatarGender === g ? "border-amber-500 bg-amber-50 text-amber-800" : "border-zinc-200 bg-white text-zinc-700"
                }`}
              >
                {GENDER_INFO[g].icon} {GENDER_INFO[g].label}
              </button>
            ))}
          </div>
          {/* Slider horizontal (Brian 2026-08-07): potret seragam setengah badan,
              geser ke kanan — bukan grid bertumpuk. -mx-4 px-4 = kartu tepi
              menempel rapi ke tepi layar saat digeser. */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Satu-satunya roster picker: influencer HDRV kanonik. */}
            {AVATAR_PRESETS.filter((a) => a.gender === avatarGender).map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={avatarId === a.id}
                aria-label={`Avatar ${a.name} — ${a.note}`}
                // Voice preset IKUT dipasang, bukan kategorinya dikosongkan.
                // Mengosongkannya membuat worker jatuh ke default "hijaber",
                // jadi avatar laki-laki (Arka, Bima, Jason) tampil berwajah
                // pria dengan suara perempuan hijaber — cacat yang saya buat
                // sendiri waktu membuka avatar premium untuk retail.
                onClick={() => { setAvatarId(a.id); setCreatorCategory(a.voice); setRegister(a.register); }}
                className={`w-32 shrink-0 snap-start overflow-hidden rounded-2xl border-2 text-left shadow-sm ${
                  avatarId === a.id ? "border-amber-500 ring-2 ring-amber-200" : "border-zinc-200"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.img} alt={a.name} className="aspect-[3/4] w-full object-cover" loading="lazy" decoding="async" />
                <span className="block p-2">
                  <span className="block truncate text-sm font-bold">{a.name}</span>
                  <span className="block truncate text-[10px] leading-tight text-zinc-500">{a.note}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <details className="group rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-3 p-4 marker:content-none">
            <span>
              <span className="block text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Opsional</span>
              <span className="font-display text-lg font-bold">Sesuaikan gaya kreator</span>
              <span className="block text-sm text-zinc-500">{selectedAvatar ? `Avatar ${selectedAvatar.name}` : "Pilih avatar"}{` · ${REGISTERS.find((r) => r.id === register)?.label ?? "suara"}`}</span>
            </span>
            <span aria-hidden="true" className="text-xl text-amber-700 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="space-y-6 border-t border-zinc-100 p-4 pt-5">
            {/* Semua tier kini bersuara (2026-08-06) — pilihan suara selalu tampil. */}
            {(
              <section className="space-y-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih karakter</p><h2 className="font-display text-xl font-bold">Suara & panggilan</h2></div>
                {REGISTERS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRegister(r.id)}
                className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 text-left ${
                  register === r.id ? "border-amber-500 bg-amber-50 shadow-sm" : "border-zinc-200 bg-white shadow-sm"
                }`}
              >
                <span className={`h-4 w-4 rounded-full border-2 ${register === r.id ? "border-amber-500 bg-amber-500" : "border-zinc-300"}`} />
                <span>
                  <span className="block font-bold">{r.label}</span>
                  <span className="block text-xs text-zinc-500">{r.hint}</span>
                </span>
              </button>
                ))}
              </section>
            )}

            <section className="space-y-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Panjang video</p><h2 className="font-display text-xl font-bold">Durasi</h2></div>
              <div className="flex gap-2">
                {([15, 30, 45] as const).map((d) => {
                  const locked = format === "talking_head" && d > 15;
                  return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={durationSec === d}
                    disabled={locked}
                    onClick={() => setDurationSec(d)}
                    className={`rounded-2xl border-2 px-5 py-3 font-bold shadow-sm ${
                      durationSec === d ? "border-amber-500 bg-amber-50" : locked ? "border-zinc-100 bg-zinc-50 text-zinc-400" : "border-zinc-200 bg-white"
                    }`}
                  >
                    {d} dtk
                  </button>
                  );
                })}
              </div>
              {format === "talking_head" && (
                <p className="text-xs text-zinc-500">
                  Wajah AI saat ini 15 detik — menjaga presenter tetap satu orang yang sama dari awal sampai akhir. Durasi panjang segera.
                </p>
              )}
              {durationSec > 15 && (
                <p className="text-xs text-zinc-500">
                  Video {durationSec} detik ~{Math.round(durationSec / 15)}x harga 15 detik (lebih banyak AI video-gen).
                </p>
              )}
            </section>
          </div>
        </details>

        <ErrorText message={error} />
        {noCredits && (
          <div className="space-y-2">
            <SecondaryButton href="/kredit?return_to=%2Fbikin%2Fgaya">Top-up dulu di sini →</SecondaryButton>
          </div>
        )}
        <PrimaryButton onClick={generate} disabled={loading || !selectedAvatar}>
          {loading ? "Lagi nulis skrip..." : `Bikinkan Skripnya${selectedTier ? ` · ${rupiah(Math.round(selectedTier.price_idr * (durationSec / 15)))}` : ""}`}
        </PrimaryButton>
      </div>
    </main>
  );
}
