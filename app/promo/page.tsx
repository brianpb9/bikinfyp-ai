"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiFail } from "../_components/api";
import { PrimaryButton, SecondaryButton, ErrorText, WarnCard } from "../_components/ui";
import { rupiah } from "../_components/flow";
import { AVATAR_PRESETS, getAvatarPreset, type AvatarGender } from "@/lib/avatar-presets";
import { JANJI_WAKTU } from "@/lib/janji-waktu";

// r-single-clip (Brian 2026-08-10): konsepnya "1 hook AI + 1 klip real
// disambung" (persis viral-hook-test) — dulu 5, tapi multi-klip nggak
// pernah bagian dari konsep aslinya dan bikin proses lebih berat (nyambung
// ke insiden OOM worker hari ini).
const MAX_CLIPS = 1;

// Survives navigating to /kredit and back (see the mount effect below).
const CONFIG_KEY = "racun.promo.config";

type Phase = "idle" | "uploading" | "processing" | "ready" | "error";

type HookIntensity = 1 | 2 | 3 | 4 | 5;

interface HookMeta {
  id: string;
  title: string;
  intensity: HookIntensity;
  score: number;
  has_person: boolean;
}

// 5 level (Brian 2026-08-10) sesuai sebaran skor asli lib/promo/hook-library.ts.
const INTENSITY_LEVELS: HookIntensity[] = [1, 2, 3, 4, 5];
const INTENSITY_INFO: Record<HookIntensity, { icon: string; label: string; hint: string }> = {
  1: { icon: "✅", label: "Santai", hint: "tenang, paling aman" },
  2: { icon: "😏", label: "Berani", hint: "mulai nendang" },
  3: { icon: "🔥", label: "Nendang", hint: "lebih berani" },
  4: { icon: "⚡", label: "Ekstrem", hint: "makin nyeleneh" },
  5: { icon: "🤪", label: "Gila", hint: "paling nyeleneh, skor tertinggi" },
};
// 0-100% dibagi 5 pita sama lebar (0-20/20-40/40-60/60-80/80-100).
function pctToIntensity(pct: number): HookIntensity {
  return (Math.min(4, Math.floor(pct / 20)) + 1) as HookIntensity;
}

const GENDER_INFO: Record<AvatarGender, { icon: string; label: string }> = {
  female: { icon: "♀", label: "Female" },
  male: { icon: "♂", label: "Male" },
};

// Video Promosi (non-ecommerce): upload klip talking-head sendiri (1 klip,
// ada suara) — AI nambahin 1 segmen hook + VO di depan, lalu digabung jadi
// satu video siap posting. Untuk promosi app/jasa yang tidak punya produk
// fisik untuk dipegang di kamera (beda dari alur Video Jualan Produk).
export default function PromoPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const [priceIdr, setPriceIdr] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<{ score: number; checks: { id: string; label: string; passed: boolean }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  // --- Toggle hook normal <-> crazy + avatar (Brian 2026-08-10) ---
  const [hooks, setHooks] = useState<HookMeta[]>([]);
  // Slider 0-100% (Brian 2026-08-10: "pake toggle... miripin ini" — pola
  // slider Level hook di app/bikin/gaya), 5 bucket sama lebar dipetakan ke 5
  // level di hook-library.ts. Default 50% = tengah = level 3.
  const [pct, setPct] = useState(50);
  const intensity = pctToIntensity(pct);
  const [hookId, setHookId] = useState<string | null>(null);
  const [avatarKind, setAvatarKind] = useState<"preset" | "custom">("preset");
  const [avatarGender, setAvatarGender] = useState<AvatarGender>("female");
  const [avatarPresetId, setAvatarPresetId] = useState(() => AVATAR_PRESETS.find((avatar) => avatar.gender === "female")?.id ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarDescribing, setAvatarDescribing] = useState(false);
  const [avatarDescription, setAvatarDescription] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  // Persist config across a page navigation-and-back (2026-08-11: Brian hit
  // "Kredit tidak cukup" mid-flow, went to /kredit to top up, came back to a
  // fully-reset form — silently submitted a DIFFERENT hook than the one he'd
  // deliberately picked, because the level-5 auto-select defaults to the
  // first entry in that level, not whatever he'd tapped before). Same
  // sessionStorage pattern as app/_components/flow.ts's e-commerce flow.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CONFIG_KEY) ?? "null");
      if (saved) {
        if (typeof saved.pct === "number") setPct(saved.pct);
        if (typeof saved.hookId === "string") setHookId(saved.hookId);
        if (saved.avatarKind === "preset" || saved.avatarKind === "custom") setAvatarKind(saved.avatarKind);
        if (saved.avatarGender === "female" || saved.avatarGender === "male") setAvatarGender(saved.avatarGender);
        if (typeof saved.avatarPresetId === "string") setAvatarPresetId(saved.avatarPresetId);
        if (typeof saved.avatarDescription === "string") setAvatarDescription(saved.avatarDescription);
      }
    } catch {
      /* corrupt/old sessionStorage payload — start fresh */
    }
    apiFetch<{ promo_price_idr: number }>("/api/meta").then((m) => setPriceIdr(m.promo_price_idr)).catch(() => {});
    apiFetch<{ hooks: HookMeta[] }>("/api/promo/hooks").then((m) => setHooks(m.hooks)).catch(() => {});
  }, []);

  useEffect(() => {
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify({ pct, hookId, avatarKind, avatarGender, avatarPresetId, avatarDescription }));
  }, [pct, hookId, avatarKind, avatarGender, avatarPresetId, avatarDescription]);

  const hooksForIntensity = hooks.filter((h) => h.intensity === intensity);
  useEffect(() => {
    if (hooksForIntensity.length && !hooksForIntensity.some((h) => h.id === hookId)) {
      setHookId(hooksForIntensity[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intensity, hooks]);

  const presetsForGender = AVATAR_PRESETS.filter((a) => a.gender === avatarGender);
  useEffect(() => {
    if (presetsForGender.length && !presetsForGender.some((a) => a.id === avatarPresetId)) {
      setAvatarPresetId(presetsForGender[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarGender]);

  const selectedHook = hooks.find((h) => h.id === hookId) ?? null;
  const needsAvatar = selectedHook?.has_person ?? true;

  async function pickAvatarPhoto(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setAvatarDescription(null);
    setAvatarError(null);
    setAvatarDescribing(true);
    try {
      const fd = new FormData();
      fd.set("photo", file);
      const res = await apiFetch<{ description: string }>("/api/promo/avatar/describe", { formData: fd });
      setAvatarDescription(res.description);
    } catch (err) {
      setAvatarError(err instanceof ApiFail ? err.message : "Gagal membaca foto avatar.");
    } finally {
      setAvatarDescribing(false);
    }
  }

  const avatarReady = avatarKind === "preset" || (avatarKind === "custom" && !!avatarDescription);
  const configReady = !!hookId && (!needsAvatar || avatarReady);

  function stopPoll() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_CLIPS);
    setFiles(next);
  }

  function removeFile(i: number) {
    setFiles(files.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (files.length < 1 || !hookId) return;
    setError(null);
    setNoCredits(false);
    setVideoUrl(null);
    setPhase("uploading");
    try {
      const uploadedClipUrls: string[] = [];
      for (const [i, file] of files.entries()) {
        setStatusText(`Upload klip ${i + 1}/${files.length}...`);
        const fd = new FormData();
        fd.set("clip", file);
        const up = await apiFetch<{ uploaded_clip_url: string }>("/api/promo/upload", { formData: fd });
        uploadedClipUrls.push(up.uploaded_clip_url);
      }
      setPhase("processing");
      setStatusText(`Bikin video — nambah hook AI + suara, lalu gabung (sekitar ${JANJI_WAKTU.sisaKlip})...`);
      const avatar = needsAvatar
        ? avatarKind === "preset"
          ? { kind: "preset", preset_id: avatarPresetId, register: getAvatarPreset(avatarPresetId)?.register }
          : { kind: "custom", description: avatarDescription }
        : undefined;
      const job = await apiFetch<{ id: string }>("/api/promo/jobs", { json: { uploaded_clip_urls: uploadedClipUrls, hook_id: hookId, avatar } });
      stopPoll();
      pollRef.current = window.setInterval(() => poll(job.id), 3000);
    } catch (err) {
      if (err instanceof ApiFail && err.code === "INSUFFICIENT_CREDITS") setNoCredits(true);
      setError(err instanceof ApiFail ? err.message : "Gagal upload/bikin video.");
      setPhase("error");
    }
  }

  async function poll(id: string) {
    try {
      const job = await apiFetch<{ state: string; error_message: string | null; output_url: string | null; virality_checklist: { score: number; checks: { id: string; label: string; passed: boolean }[] } | null }>(`/api/promo/jobs/${id}`);
      if (job.state === "READY") {
        setVideoUrl(job.output_url);
        setChecklist(job.virality_checklist);
        setPhase("ready");
        stopPoll();
      } else if (job.state === "FAILED") {
        setError(job.error_message ?? "Video gagal dibuat. Coba lagi ya.");
        setPhase("error");
        stopPoll();
      }
    } catch {
      /* poll error sementara — coba lagi di interval berikutnya */
    }
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <main className="min-h-dvh space-y-7 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <Link href="/bikin/jenis" className="flex min-h-[44px] items-center text-base font-semibold text-zinc-700">
          ← AI UGC Ads
        </Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">App / Jasa · Tanpa Produk Fisik</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Bikin AI UGC Ads</h1>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Upload 1 rekaman kamu sendiri (talking-head, ada suara) — AI tambahin hook pembuka + suara di depan, lalu gabung jadi satu video.
        </p>
      </div>

      {phase !== "ready" && (
        <>
          <section className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Seberapa nyeleneh</p>
              <h2 className="font-display text-xl font-bold">Level hook</h2>
            </div>
            <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-zinc-800">
                  <span aria-hidden="true">{INTENSITY_INFO[intensity].icon}</span> {INTENSITY_INFO[intensity].label}
                  <span className="ml-1 font-normal text-zinc-500">· {INTENSITY_INFO[intensity].hint}</span>
                </p>
                <p className="font-display text-sm font-bold text-amber-600">{pct}%</p>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={pct}
                disabled={busy}
                onChange={(e) => setPct(Number(e.target.value))}
                aria-label="Level hook: 0 santai sampai 100 gila"
                className="mt-3 h-2 w-full cursor-pointer accent-amber-500 disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-[10px] font-semibold text-zinc-400">
                {INTENSITY_LEVELS.map((lvl) => (
                  <span key={lvl} className={intensity === lvl ? "text-amber-600" : undefined}>
                    {INTENSITY_INFO[lvl].icon} {INTENSITY_INFO[lvl].label}
                  </span>
                ))}
              </div>
            </div>
            {hooksForIntensity.length > 1 && (
              <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {hooksForIntensity.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setHookId(h.id)}
                    aria-pressed={hookId === h.id}
                    className={`shrink-0 snap-start rounded-xl border-2 px-3 py-2 text-left text-xs font-semibold shadow-sm disabled:opacity-50 ${
                      hookId === h.id ? "border-amber-500 bg-amber-50 text-amber-800" : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    {h.title}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Siapa yang tampil</p>
              <h2 className="font-display text-xl font-bold">Avatar</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setAvatarKind("preset")}
                className={`rounded-2xl border-2 p-3 text-center text-sm font-bold shadow-sm disabled:opacity-50 ${
                  avatarKind === "preset" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-zinc-200 bg-white text-zinc-700"
                }`}
              >
                Pilih avatar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAvatarKind("custom")}
                className={`rounded-2xl border-2 p-3 text-center text-sm font-bold shadow-sm disabled:opacity-50 ${
                  avatarKind === "custom" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-zinc-200 bg-white text-zinc-700"
                }`}
              >
                Upload foto sendiri
              </button>
            </div>

            {avatarKind === "preset" && (
              <>
                {/* Toggle gender (2026-08-10, permintaan Brian) — dipilih
                    dulu sebelum daftar avatar. */}
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(GENDER_INFO) as AvatarGender[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      disabled={busy}
                      onClick={() => setAvatarGender(g)}
                      aria-pressed={avatarGender === g}
                      className={`rounded-2xl border-2 py-2 text-center text-sm font-bold shadow-sm disabled:opacity-50 ${
                        avatarGender === g ? "border-amber-500 bg-amber-50 text-amber-800" : "border-zinc-200 bg-white text-zinc-700"
                      }`}
                    >
                      {GENDER_INFO[g].icon} {GENDER_INFO[g].label}
                    </button>
                  ))}
                </div>
                <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {presetsForGender.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={busy}
                      onClick={() => setAvatarPresetId(a.id)}
                      aria-pressed={avatarPresetId === a.id}
                      className={`w-20 shrink-0 snap-start overflow-hidden rounded-2xl border-2 text-center shadow-sm disabled:opacity-50 ${
                        avatarPresetId === a.id ? "border-amber-500 ring-2 ring-amber-200" : "border-zinc-200"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.img} alt={a.name} className="aspect-[3/4] w-full object-cover" loading="lazy" decoding="async" />
                      <span className="block truncate bg-white px-1 py-1.5 text-[10px] font-semibold text-zinc-600">{a.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {avatarKind === "custom" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => avatarFileRef.current?.click()}
                  disabled={busy || avatarDescribing}
                  className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3 text-amber-700 disabled:opacity-50"
                >
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt="Foto avatar" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <span className="text-2xl" aria-hidden="true">📷</span>
                  )}
                  <span className="text-sm font-semibold">
                    {avatarDescribing ? "Membaca foto..." : avatarFile ? "Ganti foto" : "Upload foto kamu"}
                  </span>
                </button>
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => { pickAvatarPhoto(e.target.files); e.target.value = ""; }}
                />
                <ErrorText message={avatarError} />
                {avatarDescription && (
                  <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    AI akan bikin presenter terinspirasi dari foto ini (bukan wajah persis sama — kebijakan
                    keamanan konten AI): {avatarDescription}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-2xl border-2 border-zinc-100 bg-white p-3 shadow-sm">
                    <span className="truncate text-sm font-medium text-zinc-700">{i + 1}. {f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      disabled={busy}
                      className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 disabled:opacity-40"
                      aria-label={`Hapus klip ${i + 1}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {files.length < MAX_CLIPS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex min-h-[64px] w-full flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/60 text-amber-700 disabled:opacity-50"
              >
                <span className="text-2xl" aria-hidden="true">＋</span>
                <span className="text-sm font-semibold">Tambah klip ({files.length}/{MAX_CLIPS})</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
          </section>

          <WarnCard>Tiap klip wajib ada suara (talking-head), maksimal 60 detik.</WarnCard>

          {statusText && phase !== "idle" && (
            <p className="text-sm text-zinc-600">{statusText}</p>
          )}
          <ErrorText message={error} />
          {noCredits && (
            <SecondaryButton href="/kredit?return_to=%2Fpromo">Top-up dulu di sini →</SecondaryButton>
          )}

          <PrimaryButton onClick={submit} disabled={files.length < 1 || !configReady || busy} big>
            {busy ? "Sebentar..." : `Bikin Video${priceIdr ? ` · ${rupiah(priceIdr)}` : ""}`}
          </PrimaryButton>
        </>
      )}

      {phase === "ready" && videoUrl && (
        <>
          <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] bg-zinc-900 shadow-xl shadow-amber-900/10 ring-1 ring-black/5">
            <video src={videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full" />
          </div>

          {checklist && (
            <section className="space-y-2 rounded-2xl border-2 border-zinc-100 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Cek Kelayakan Posting (v1, kasar)</p>
              <ul className="space-y-1.5">
                {checklist.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    <span className={c.passed ? "text-emerald-600" : "text-red-500"}>{c.passed ? "✓" : "✕"}</span>
                    <span className={c.passed ? "text-zinc-700" : "text-red-700"}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <WarnCard>
            <p className="font-bold">⚠ Sebelum posting:</p>
            <p>nyalakan tanda &ldquo;konten AI&rdquo; di TikTok ya, biar akun kamu aman.</p>
          </WarnCard>
          <a
            href={videoUrl}
            download="bikinfyp-promosi.mp4"
            className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-lg font-bold text-white shadow-md shadow-amber-500/20 active:from-amber-500 active:to-amber-600"
          >
            Unduh Videonya
          </a>
          <button
            type="button"
            onClick={() => { setFiles([]); setVideoUrl(null); setPhase("idle"); setStatusText(""); }}
            className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-zinc-200 bg-white font-semibold text-zinc-700 active:bg-zinc-50"
          >
            Bikin video lain
          </button>
        </>
      )}
    </main>
  );
}
