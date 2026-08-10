"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeft, Camera, CheckCircle2, Film, ImagePlus, Loader2,
  Megaphone, ShoppingBag, Sparkles, Trash2, Upload,
} from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";
import { rupiah } from "../../_components/format";
import { Stepper } from "../../_components/Stepper";
import { AVATAR_PRESETS, type AvatarGender } from "@/lib/avatar-presets";

type Kind = "affiliate" | "ads" | "tvc";
type Format = "talking_head" | "hands_only";
type Tier = "high_quality" | "super_hq";
type HookLevel = "normal" | "berani" | "gila";

interface ProductPayload {
  product_id: string; name: string; price_idr: number; category: string;
  product_visual_desc: string | null; brand_brief: string | null;
  source_url: string | null; images: string[]; image_urls: string[];
}
interface GeneratedScript { script_id: string; hook_family: string; caption: string }

const STEPS = ["Jenis", "Produk", "Detail", "Konsep", "Review"];
const MAX_PHOTOS = 8;
const TIER_BASE_IDR: Record<Tier, number> = { high_quality: 12_000, super_hq: 80_000 };
const CATEGORIES = ["beauty", "fashion", "food", "gadget", "home", "default"];

function estimateIdr(tier: Tier, durationSec: number, count: number): number {
  return Math.round(TIER_BASE_IDR[tier] * (durationSec / 15)) * count;
}

// Journey produksi video brand (M8, F-ENT-01) — menggantikan halaman bulk
// lama yang menumpuk semuanya di 2 layar. Bentuknya wizard bertahap ala
// Blaze: satu keputusan per layar, breadcrumb selalu terlihat.
//
// Perubahan model yang mendasar (arahan Brian 2026-08-11): brand TIDAK
// memasukkan banyak link produk. Mereka fokus SATU produk unggulan, melengkapi
// foto referensi + detail sebanyak mungkin, lalu minta 2-6 VARIASI video dari
// produk yang sama. Makin lengkap input, makin bagus hasil render.
export default function CampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>("affiliate");
  const [urlInput, setUrlInput] = useState("");
  const [product, setProduct] = useState<ProductPayload | null>(null);

  const [format, setFormat] = useState<Format>("hands_only");
  const [tier, setTier] = useState<Tier>("high_quality");
  const [durationSec, setDurationSec] = useState<15 | 30 | 45>(15);
  const [hookLevel, setHookLevel] = useState<HookLevel>("normal");
  const [avatarGender, setAvatarGender] = useState<AvatarGender>("female");
  const [creatorCategory, setCreatorCategory] = useState("hijaber");
  const [customAvatarDesc, setCustomAvatarDesc] = useState<string | null>(null);

  const [count, setCount] = useState(3);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const photoInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  function go(next: number) { setError(null); setNotice(null); setStep(next); }

  // --- Langkah 2: link -> tarik data ---
  async function handleExtract(useManual: boolean) {
    setLoading(true); setError(null); setNotice(null);
    try {
      const payload = useManual ? { name: "Produk baru", price_idr: 0 } : { url: urlInput.trim() };
      const res = await apiFetch<{ extracted: boolean; message?: string } & Partial<ProductPayload>>(
        "/api/dashboard/campaign/product", { json: payload }
      );
      if (!res.extracted) {
        // Link gagal dibaca BUKAN jalan buntu — brand lanjut isi manual.
        setNotice(res.message ?? "Link-nya belum bisa kami baca. Isi manual aja ya.");
        return;
      }
      setProduct(res as ProductPayload);
      go(2);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menarik data produk.");
    } finally { setLoading(false); }
  }

  // --- Langkah 3: foto + detail ---
  async function handleUploadPhotos(files: FileList) {
    if (!product) return;
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      Array.from(files).slice(0, MAX_PHOTOS).forEach((f) => fd.append("photos", f));
      const res = await fetch(`/api/products/${product.product_id}/photos`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFail(data.code ?? "ERROR", data.message_id ?? "Upload foto gagal.", false);
      setProduct({ ...product, images: data.images, image_urls: data.image_urls });
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Upload foto gagal.");
    } finally { setLoading(false); }
  }

  async function handleDeletePhoto(rel: string) {
    if (!product) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/products/${product.product_id}/photos`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: rel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFail(data.code ?? "ERROR", data.message_id ?? "Hapus foto gagal.", false);
      setProduct({ ...product, images: data.images, image_urls: data.image_urls });
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Hapus foto gagal.");
    } finally { setLoading(false); }
  }

  async function handleSaveDetail() {
    if (!product) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ProductPayload>("/api/dashboard/campaign/product", {
        method: "PATCH",
        json: {
          product_id: product.product_id, name: product.name, price_idr: product.price_idr,
          category: product.category, product_visual_desc: product.product_visual_desc ?? "",
          brand_brief: product.brand_brief ?? "",
        },
      });
      setProduct(res);
      go(3);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menyimpan detail.");
    } finally { setLoading(false); }
  }

  // --- Langkah 4: avatar sendiri ---
  async function handleAvatarPhoto(file: File) {
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/promo/avatar/describe", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFail(data.code ?? "ERROR", data.message_id ?? "Gagal membaca foto avatar.", false);
      setCustomAvatarDesc(data.description as string);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal membaca foto avatar.");
    } finally { setLoading(false); }
  }

  // --- Langkah 5: generate + konfirmasi ---
  async function handleGenerate() {
    if (!product) return;
    setLoading(true); setError(null); setNotice(null);
    try {
      const res = await apiFetch<{ requested: number; scripts: GeneratedScript[] }>(
        "/api/dashboard/campaign/generate",
        { json: { product_id: product.product_id, count, tier, duration_sec: durationSec, hook_level: hookLevel } }
      );
      setScripts(res.scripts);
      setExcluded(new Set());
      if (res.scripts.length < res.requested) {
        // Jujur: jangan diam-diam mengurangi jumlah video yang diminta.
        setNotice(`AI cuma sanggup bikin ${res.scripts.length} variasi lolos validasi dari ${res.requested} yang diminta.`);
      }
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal bikin skrip.");
    } finally { setLoading(false); }
  }

  async function handleConfirm() {
    if (!product) return;
    const chosen = scripts.filter((s) => !excluded.has(s.script_id));
    if (chosen.length === 0) { setError("Pilih minimal 1 video."); return; }
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<{ run_id: string }>("/api/dashboard/campaign/confirm", {
        json: {
          product_id: product.product_id, script_ids: chosen.map((s) => s.script_id),
          format, creator_category: creatorCategory, avatar_custom_desc: customAvatarDesc,
        },
      });
      router.push(`/dashboard/campaign/${res.run_id}`);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal mulai render.");
      setLoading(false);
    }
  }

  const avatars = AVATAR_PRESETS.filter((a) => a.gender === avatarGender);
  const selectedCount = scripts.filter((s) => !excluded.has(s.script_id)).length;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Stepper steps={STEPS} current={step} onJump={(i) => go(i)} />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{notice}
        </div>
      )}

      {/* ---------- 1. JENIS ---------- */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Mau bikin video apa?</h1>
            <p className="mt-1 text-sm text-zinc-500">Pilih satu — langkah berikutnya menyesuaikan.</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {([
              { id: "affiliate" as const, icon: ShoppingBag, title: "AI UGC Affiliate", desc: "Jualan produk fisik ke TikTok Shop. AI yang peragakan produkmu — cukup foto.", ready: true },
              { id: "ads" as const, icon: Megaphone, title: "AI UGC Ads", desc: "Promosi app, jasa, atau toko. Rekamanmu sendiri + hook AI pembuka.", ready: false },
              { id: "tvc" as const, icon: Film, title: "AI TVC", desc: "Iklan brand sinematik: hook 3 detik, bukti produk, hero shot, packshot.", ready: false },
            ]).map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => k.ready && setKind(k.id)}
                  disabled={!k.ready}
                  className={`rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    active ? "border-amber-500" : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <Icon size={22} className={active ? "text-amber-600" : "text-zinc-400"} />
                  <p className="mt-3 flex items-center gap-2 font-display text-base font-bold text-zinc-900">
                    {k.title}
                    {!k.ready && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">Segera</span>}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">{k.desc}</p>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button onClick={() => go(1)} className="rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
              Lanjut
            </button>
          </div>
        </div>
      )}

      {/* ---------- 2. PRODUK ---------- */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Produk mana yang mau diiklankan?</h1>
            <p className="mt-1 text-sm text-zinc-500">Tempel link produknya — kami tarik nama, harga, dan fotonya otomatis.</p>
          </div>
          <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://www.tokopedia.com/toko/produk"
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 font-mono text-sm text-zinc-900 transition-colors focus:border-amber-500 focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleExtract(false)}
                disabled={loading || !urlInput.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {loading ? "Menarik data..." : "Tarik data produk"}
              </button>
              <button
                onClick={() => handleExtract(true)}
                disabled={loading}
                className="text-sm font-semibold text-zinc-500 hover:text-amber-600 disabled:opacity-50"
              >
                atau isi manual
              </button>
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => go(0)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
          </div>
        </div>
      )}

      {/* ---------- 3. DETAIL ---------- */}
      {step === 2 && product && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Lengkapi foto &amp; detail</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Makin lengkap, makin bagus hasilnya. Foto dari berbagai sudut membuat AI menggambar produkmu jauh lebih akurat.
            </p>
          </div>

          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">Foto referensi ({product.images.length}/{MAX_PHOTOS})</p>
              <button
                onClick={() => photoInput.current?.click()}
                disabled={loading || product.images.length >= MAX_PHOTOS}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
              >
                <ImagePlus size={14} /> Tambah foto
              </button>
              <input
                ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
                onChange={(e) => e.target.files && handleUploadPhotos(e.target.files)}
              />
            </div>
            {product.image_urls.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-8 text-center">
                <Camera size={22} className="text-zinc-300" />
                <p className="text-sm text-zinc-500">Belum ada foto. Minimal 1 foto wajib buat render.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-4 gap-3">
                {product.image_urls.map((url, i) => (
                  <li key={product.images[i]} className="group relative overflow-hidden rounded-xl border border-zinc-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="aspect-square w-full object-cover" />
                    <button
                      onClick={() => handleDeletePhoto(product.images[i])}
                      disabled={loading}
                      title="Hapus foto"
                      className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 p-1.5 text-zinc-600 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid grid-cols-2 gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Nama produk</span>
              <input
                value={product.name}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Harga (Rp)</span>
              <input
                type="number" min={0} value={product.price_idr}
                onChange={(e) => setProduct({ ...product, price_idr: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Kategori</span>
              <select
                value={CATEGORIES.includes(product.category) ? product.category : "default"}
                onChange={(e) => setProduct({ ...product, category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c === "default" ? "lainnya" : c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Deskripsi visual produk</span>
              <input
                value={product.product_visual_desc ?? ""}
                onChange={(e) => setProduct({ ...product, product_visual_desc: e.target.value })}
                placeholder="botol kaca bening, tutup pump hitam, label putih"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="col-span-2 block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Arahan khusus dari brand (opsional)</span>
              <textarea
                value={product.brand_brief ?? ""}
                onChange={(e) => setProduct({ ...product, brand_brief: e.target.value })}
                rows={3}
                placeholder="Tekankan bahan organik. Jangan sebut diskon. Nuansa pagi hari, hangat."
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-zinc-500">Arahan ini ikut dikirim ke AI di setiap shot.</span>
            </label>
          </section>

          <div className="flex justify-between">
            <button onClick={() => go(1)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            <button
              onClick={handleSaveDetail}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {loading && <Loader2 size={16} className="animate-spin" />} Lanjut
            </button>
          </div>
        </div>
      )}

      {/* ---------- 4. KONSEP ---------- */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Konsep videonya</h1>
            <p className="mt-1 text-sm text-zinc-500">Berlaku untuk semua variasi video di kampanye ini.</p>
          </div>

          <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Format</p>
              <div className="flex gap-2">
                {([{ id: "talking_head" as const, label: "Wajah AI" }, { id: "hands_only" as const, label: "Tangan + VO" }]).map((f) => (
                  <button key={f.id}
                    onClick={() => { setFormat(f.id); if (f.id === "talking_head") setDurationSec(15); }}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${format === f.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                  >{f.label}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Durasi</p>
              <div className="flex gap-2">
                {([15, 30, 45] as const).map((d) => {
                  const disabled = format === "talking_head" && d !== 15;
                  return (
                    <button key={d} onClick={() => !disabled && setDurationSec(d)} disabled={disabled}
                      title={disabled ? "Wajah AI cuma tersedia 15 detik" : undefined}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${durationSec === d ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                    >{d} dtk</button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Tier kualitas</p>
              <div className="flex gap-2">
                {([{ id: "high_quality" as const, label: "AI Bersuara" }, { id: "super_hq" as const, label: "AI Bersuara Pro" }]).map((t) => (
                  <button key={t.id} onClick={() => setTier(t.id)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${tier === t.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                  >{t.label}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Level hook</p>
              <div className="flex gap-2">
                {([
                  { id: "normal" as const, label: "Normal", hint: "pola paling terbukti" },
                  { id: "berani" as const, label: "Berani", hint: "hook lebih nendang" },
                  { id: "gila" as const, label: "Gila", hint: "pembuka nyeleneh" },
                ]).map((h) => (
                  <button key={h.id} onClick={() => setHookLevel(h.id)} title={h.hint}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${hookLevel === h.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                  >{h.label}</button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Avatar</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => avatarInput.current?.click()}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                  >
                    <Upload size={13} /> Pakai foto sendiri
                  </button>
                  <input
                    ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
                    onChange={(e) => e.target.files?.[0] && handleAvatarPhoto(e.target.files[0])}
                  />
                  <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5">
                    {(["female", "male"] as const).map((g) => (
                      <button key={g} onClick={() => setAvatarGender(g)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${avatarGender === g ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}
                      >{g === "female" ? "Female" : "Male"}</button>
                    ))}
                  </div>
                </div>
              </div>

              {customAvatarDesc && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Avatar dari fotomu terbaca:</p>
                  <p className="mt-1 leading-5">{customAvatarDesc}</p>
                  <p className="mt-2 leading-5 text-amber-800">
                    Hasilnya akan <b>terinspirasi</b> dari foto ini, bukan wajah yang persis sama — penyedia AI video menolak
                    foto wajah asli sebagai referensi. Suara tetap mengikuti avatar preset yang kamu pilih di bawah.
                  </p>
                  <button onClick={() => setCustomAvatarDesc(null)} className="mt-2 font-semibold underline">Hapus, pakai preset saja</button>
                </div>
              )}

              <div className="grid grid-cols-6 gap-2">
                {avatars.map((a) => (
                  <button key={a.id} onClick={() => setCreatorCategory(a.id)} title={a.name}
                    className={`overflow-hidden rounded-xl border-2 transition-colors ${creatorCategory === a.id ? "border-amber-500" : "border-transparent hover:border-zinc-200"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.img} alt={a.name} className="aspect-square w-full object-cover" />
                    <p className="truncate px-1 py-1 text-[10px] font-medium text-zinc-600">{a.name}</p>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="flex justify-between">
            <button onClick={() => go(2)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            <button onClick={() => go(4)} className="rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
              Lanjut
            </button>
          </div>
        </div>
      )}

      {/* ---------- 5. REVIEW ---------- */}
      {step === 4 && product && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Berapa video yang mau dibuat?</h1>
            <p className="mt-1 text-sm text-zinc-500">Satu produk, beberapa variasi — tiap video pakai sudut hook yang berbeda.</p>
          </div>

          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <button key={n} onClick={() => setCount(n)}
                  className={`h-11 w-11 rounded-lg border text-sm font-bold transition-colors ${count === n ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                >{n}</button>
              ))}
            </div>
            <p className="text-sm text-zinc-600">
              Estimasi <b>{rupiah(estimateIdr(tier, durationSec, count))}</b> untuk {count} video ({durationSec} dtk, {tier === "super_hq" ? "AI Bersuara Pro" : "AI Bersuara"}).
              Harga pasti dihitung ulang server saat render.
            </p>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Membuat skrip..." : scripts.length ? "Buat ulang skrip" : "Buat skrip"}
            </button>
          </section>

          {scripts.length > 0 && (
            <section className="space-y-3">
              <p className="text-sm font-bold text-zinc-900">{scripts.length} skrip siap — pilih yang mau dirender</p>
              <ul className="space-y-2">
                {scripts.map((s) => {
                  const checked = !excluded.has(s.script_id);
                  return (
                    <li key={s.script_id}
                      className={`flex items-start gap-3 rounded-xl border bg-white p-4 shadow-sm transition-colors ${checked ? "border-amber-300" : "border-zinc-200 opacity-60"}`}
                    >
                      <input type="checkbox" checked={checked} className="mt-1 h-4 w-4 accent-amber-500"
                        onChange={(e) => {
                          const next = new Set(excluded);
                          if (e.target.checked) next.delete(s.script_id); else next.add(s.script_id);
                          setExcluded(next);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
                          <CheckCircle2 size={13} className="text-emerald-500" /> hook {s.hook_family}
                        </p>
                        <p className="mt-1 text-sm text-zinc-700">{s.caption}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="flex justify-between">
            <button onClick={() => go(3)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Memulai render..." : `Setujui ${selectedCount} & Mulai Render`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
