"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeft, Camera, CheckCircle2, Film, ImagePlus, Loader2,
  Megaphone, Plus, ShieldAlert, ShoppingBag, Sparkles, Trash2,
} from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";
import { rupiah } from "../../_components/format";
import { Stepper } from "../../_components/Stepper";
import { AVATAR_PRESETS, getAvatarPreset, type AvatarGender } from "@/lib/avatar-presets";
import { tierMasihDijual } from "@/lib/paket-kredit";
import { getTemplate, type CampaignTemplate } from "@/lib/templates";
import { stylesForFormat, GAYA_BAWAAN } from "@/lib/media/recording-styles";
import { pickTemplate } from "@/lib/auto-pick";
import { TEMPLATE_COPY_CAPACITY } from "@/lib/script-engine/template-copy";
import { runSequentially } from "@/lib/sequential-queue";

type Kind = "affiliate" | "ads" | "tvc";
type Format = "talking_head" | "hands_only" | "tvc" | "ads";
type Tier = "silent_caption" | "high_quality" | "super_hq";
import type { HookLevel } from "@/lib/config/hooks";
import { HOOK_LEVELS } from "@/lib/config/hooks";
import { BTN_PRIMARY } from "@/app/dashboard/_components/buttons";

interface ProductPayload {
  product_id: string; name: string; price_idr: number; category: string;
  product_visual_desc: string | null; brand_brief: string | null;
  promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null;
  source_url: string | null; images: string[]; image_urls: string[];
}
interface GeneratedScript {
  script_id: string;
  hook_family: string;
  caption: string;
  /** Baris yang BENAR-BENAR diucapkan. Layar ini dulu cuma menampilkan
   *  caption — dan caption bukan naskah: brand menyetujui render tanpa pernah
   *  melihat kalimat yang akan diucapkan talent. */
  segments?: { role: string; text: string }[];
  script_source?: "llm" | "template" | "degraded";
  standar_garis?: string;
  standar_nilai?: number;
}

/** Naskah yang diucapkan, satu baris per segmen. */
function BarisNaskah({ s }: { s: GeneratedScript }) {
  if (!s.segments?.length) return <p className="mt-1 text-sm text-zinc-700">{s.caption}</p>;
  return (
    <div className="mt-1 space-y-1">
      {s.segments.map((seg, i) => (
        <p key={i} className="text-sm text-zinc-700">
          <span className="mr-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">{seg.role}</span>
          {seg.text}
        </p>
      ))}
      <p className="pt-1 text-xs text-zinc-500">Caption: {s.caption}</p>
      {(s.standar_garis || (s.script_source && s.script_source !== "llm")) && (
        <p className="pt-1 text-xs font-semibold text-zinc-500">
          {s.standar_garis ? `Standar 10/10: ${s.standar_garis}${typeof s.standar_nilai === "number" ? ` · nilai ${s.standar_nilai}/10` : ""}` : ""}
          {s.script_source && s.script_source !== "llm"
            ? `${s.standar_garis ? " · " : ""}${s.script_source === "template" ? "naskah cadangan (template)" : "belum memenuhi standar"}`
            : ""}
        </p>
      )}
    </div>
  );
}

// Avatar jadi langkah sendiri (permintaan Brian 2026-08-12). Dulu terselip di
// dalam Konsep, di bawah slider hook — pilihan sepenting "siapa yang muncul di
// video" tidak boleh jadi sisipan di layar yang sudah padat.
const STEPS = ["Jenis", "Produk", "Detail", "Avatar", "Konsep", "Review"];
const MAX_PHOTOS = 8;
// Harga dasar per tier — HARUS cocok dengan config.tiers di server, karena
// angka di layar ini yang dibaca brand sebelum menekan Bikin. Server tetap
// menghitung ulang saat render; ini estimasi, bukan otoritas.
const TIER_BASE_IDR: Record<Tier, number> = { silent_caption: 5_000, high_quality: 12_000, super_hq: 80_000 };
// Kategori produk. Tiga terakhir TIDAK punya barang fisik dan itulah yang
// mematikan pemeriksaan identitas produk (isServiceLike di lib/config/hooks.ts)
// — tanpa opsi ini di layar, iklan jasa tidak akan pernah bisa dipilih dan
// seluruh jalurnya jadi kode mati.
// Tier yang MASIH DIJUAL, disaring dari daftar pensiun bersama.
//
// Dashboard sempat menawarkan silent_caption dengan alasan "ia tier produksi
// yang dipakai retail tiap hari" — dan alasan itu sudah tidak benar sejak
// retail memensiunkannya. Akibatnya Enterprise menjual Standard Rp5.000
// sementara retail menyatakannya tidak tersedia: dua permukaan, dua kebenaran
// (temuan audit QA putaran kedua, 16 Agu 2026).
//
// Disaring, bukan dihapus dari TIER_META/TIER_BASE_IDR — job lama yang sudah
// terlanjur memakai tier ini tetap perlu label dan harganya untuk ditampilkan
// di riwayat.
const SEMUA_TIER = [
  { id: "silent_caption" as const, label: "Standard" },
  { id: "high_quality" as const, label: "Quality" },
  { id: "super_hq" as const, label: "High Quality" },
];
const TIER_OPTIONS = SEMUA_TIER.filter((t) => tierMasihDijual(t.id));
const TIER_META: Record<string, { resolution: string; note: string }> = {
  silent_caption: { resolution: "480p", note: "teks di layar, tanpa suara" },
  high_quality: { resolution: "720p", note: "suara AI" },
  super_hq: { resolution: "1080p", note: "suara AI + gerak bibir" },
};
// Tiap rasio membawa BENTUK kotaknya sendiri. Angka "9:16" tidak berarti apa-apa
// buat kebanyakan penjual; bentuknya langsung terbaca tanpa perlu dipikir.
//
// Sisi terpanjang disamakan (22px) supaya yang membedakan bentuknya, bukan
// ukurannya — kalau tiap kotak dibuat seluas mungkin, yang persegi terlihat
// paling besar dan seolah paling penting.
const RATIOS = [
  { id: "9:16", label: "9:16", w: 12, h: 22, untuk: "TikTok, Reels, Shorts" },
  { id: "1:1", label: "1:1", w: 18, h: 18, untuk: "Feed Instagram" },
  { id: "16:9", label: "16:9", w: 22, h: 12, untuk: "YouTube, layar lebar" },
];

const CATEGORIES = ["beauty", "fashion", "muslim_fashion", "food", "gadget", "home", "jasa", "app", "toko", "default"];
const CATEGORY_LABEL: Record<string, string> = {
  beauty: "Kecantikan", fashion: "Fashion", muslim_fashion: "Fashion muslim",
  food: "Makanan & minuman", gadget: "Elektronik", home: "Rumah & dapur",
  jasa: "Jasa (tanpa barang fisik)", app: "Aplikasi", toko: "Toko / tempat usaha",
  default: "Lainnya",
};

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
// Tiga label untuk lima posisi. Nama di bawah slider hanya menandai ujung dan
// tengah; keterangan di bawahnya yang menyebutkan level persisnya, supaya
// posisi 2 dan 4 tetap bisa dipahami tanpa menambah tulisan di slider.
const HOOK_LABEL: Record<HookLevel, string> = {
  normal: "Normal", agak_berani: "Agak berani", berani: "Berani",
  agak_gila: "Agak gila", gila: "Gila",
};
// JUJUR SOAL EVIDENSI: data kami TIDAK menunjukkan makin gila makin menang
// (lihat catatan di lib/config/hooks.ts). Karena itu keterangan di bawah
// menjelaskan PERBEDAAN SUDUT, bukan menjanjikan hasil lebih bagus.
const HOOK_HINT: Record<HookLevel, string> = {
  normal: "Pola paling terbukti untuk kategori produkmu.",
  agak_berani: "Campuran: video pertama aman, sisanya mulai menantang.",
  berani: "Semua varian pakai sudut menantang — kaget harga, peringatan, FOMO.",
  agak_gila: "Sama seperti Berani, plus produk langsung masuk cepat di detik pertama.",
  gila: "Pembuka nyeleneh dengan gerakan kamera dramatis. Bukan berarti lebih FYP.",
};

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
  // Gaya rekam (sumbu "bagaimana direkam"). "standar" = framing bawaan format,
  // persis perilaku sebelum fitur ini ada.
  const [recordStyle, setRecordStyle] = useState<string>(GAYA_BAWAAN);
  const [tier, setTier] = useState<Tier>("high_quality");
  const [durationSec, setDurationSec] = useState<15 | 30 | 45>(15);
  const [ratio, setRatio] = useState("9:16");
  const [multiShot, setMultiShot] = useState(false);
  const [claims, setClaims] = useState<string[]>([]);
  const [noModel, setNoModel] = useState(false);
  const [shotCount, setShotCount] = useState(3);
  const [hookLevel, setHookLevel] = useState<HookLevel>("normal");
  const [avatarGender, setAvatarGender] = useState<AvatarGender>("female");
  // ID INFLUENCER (lib/avatar-presets.ts), bukan kategori kreator. Kategori
  // dipinjam dari preset.voice saat dikirim ke server — dua hal berbeda sejak
  // pustaka avatar HDRV masuk 2026-08-13.
  const [avatarId, setAvatarId] = useState(AVATAR_PRESETS[0]?.id ?? "");
  const [avatarNeedsReselection, setAvatarNeedsReselection] = useState(false);
  const [customAvatarDesc, setCustomAvatarDesc] = useState<string | null>(null);

  const [count, setCount] = useState(3);
  // Template terpilih (?template=). Hanya MENGISI AWAL — semua nilainya tetap
  // terlihat dan bisa diubah di langkah Konsep, jadi tidak ada yang berubah
  // diam-diam. hookFamilies-nya ikut dikirim ke /generate supaya varian
  // pertama benar-benar membawa sudut khas template itu.
  const [template, setTemplate] = useState<CampaignTemplate | null>(null);
  const maxVideoCount = template ? TEMPLATE_COPY_CAPACITY : 6;
  useEffect(() => {
    if (template && count > TEMPLATE_COPY_CAPACITY) setCount(TEMPLATE_COPY_CAPACITY);
  }, [template, count]);
  // Mode cepat ("Bikinin aja"): kita yang memilih template dari kategori dan
  // harga, lalu melompat langsung ke Review. TAMBAHAN, bukan pengganti —
  // alasannya ditampilkan dan templatenya tetap bisa diganti.
  const [modeCepat, setModeCepat] = useState(false);
  const [alasanPilih, setAlasanPilih] = useState<string | null>(null);
  // Template milik brand (?orgtpl=). Diambil dari API karena isinya data
  // organisasi, bukan konstanta kode seperti template bawaan.
  const [savedName, setSavedName] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  useEffect(() => {
    const orgTplId = new URLSearchParams(window.location.search).get("orgtpl");
    if (!orgTplId) return;
    (async () => {
      try {
        const res = await apiFetch<{ templates: Array<Record<string, unknown>> }>("/api/dashboard/templates");
        const t = res.templates.find((x) => x.id === orgTplId);
        if (!t) return;
        setKind(String(t.kind) as Kind);
        setFormat(String(t.format) as Format);
        setTier(String(t.quality_tier) as Tier);
        setDurationSec(Number(t.duration_sec) as 15 | 30 | 45);
        setHookLevel(String(t.hook_level) as HookLevel);
        setCount(Number(t.variant_count));
        const savedAvatar = getAvatarPreset(String(t.creator_category ?? ""));
        if (savedAvatar) {
          setAvatarId(savedAvatar.id);
          setAvatarGender(savedAvatar.gender);
          setAvatarNeedsReselection(false);
        } else if (t.avatar_gender) {
          setAvatarGender(String(t.avatar_gender) as AvatarGender);
          setAvatarId("");
          setAvatarNeedsReselection(true);
        }
        setNotice(savedAvatar
          ? `Pakai template kamu: ${String(t.name)}`
          : `Template lama “${String(t.name)}” belum menyimpan identitas influencer. Pilih avatarnya lagi.`);
        setStep(1); setMaxStep((m) => Math.max(m, 1));
      } catch { /* biarkan wizard kosong; brand tetap bisa mengatur manual */ }
    })();
  }, []);

  async function saveAsTemplate() {
    if (!getAvatarPreset(avatarId)) { setError("Pilih avatar dulu sebelum menyimpan template."); return; }
    setSavingTpl(true); setError(null);
    try {
      await apiFetch("/api/dashboard/templates", { json: {
        name: savedName, kind, format, quality_tier: tier, duration_sec: durationSec,
        hook_level: hookLevel, variant_count: count,
        // Column name is legacy, but templates store the canonical avatar ID;
        // voice is derived from that avatar when a job is confirmed.
        creator_category: avatarId, avatar_gender: avatarGender,
        hook_family: template?.hookFamily ?? null,
      } });
      setSavedName("");
      setNotice("Template disimpan. Ada di halaman Templates, bagian \"Template kamu\".");
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menyimpan template.");
    } finally {
      setSavingTpl(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Mode cepat: brand tidak memilih jenis maupun template — kita yang pilih
    // setelah dia memasukkan produknya. Lihat catatan di lib/auto-pick.ts.
    if (params.get("auto") === "1") { setModeCepat(true); setStep(1); setMaxStep(1); return; }
    const t = getTemplate(params.get("template"));
    if (!t) return;
    terapkanTemplate(t);
    setStep(1); setMaxStep(1);
  }, []);

  function terapkanTemplate(t: CampaignTemplate) {
    setTemplate(t);
    setKind(t.kind as Kind);
    setFormat(t.format as Format);
    setTier(t.tier as Tier);
    setDurationSec(t.durationSec);
    setHookLevel(t.hookLevel as HookLevel);
    setCount(Math.min(t.count, TEMPLATE_COPY_CAPACITY));
    // Rasio ikut template kalau template memang menentukannya. Dua template
    // TVC ditulis dan dirender 16:9 — brand melihat pratinjau landscape di
    // galeri, jadi hasilnya harus landscape juga, bukan potret 9:16.
    if (t.ratio) setRatio(t.ratio);
    // Jumlah adegan ikut template. Angka ini SUDAH disesuaikan dengan batas
    // mesin kami (minimum 4 detik per adegan), bukan disalin mentah dari video
    // sumbernya — enam dari 12 video itu berpotongan 1,7-2,5 detik per shot,
    // ritme yang memang belum bisa kami hasilkan.
    if (t.shotCount && t.shotCount >= 2) { setMultiShot(true); setShotCount(t.shotCount); }
  }

  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const photoInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [photoDragActive, setPhotoDragActive] = useState(false);

  // Langkah terjauh yang pernah dicapai — dipakai Stepper untuk menentukan
  // mana yang boleh diklik. Disimpan terpisah dari `step` karena `step` turun
  // saat mundur, sedangkan izin melompat tidak boleh ikut hilang.
  const [maxStep, setMaxStep] = useState(0);
  function go(next: number) {
    setError(null); setNotice(null); setStep(next);
    setMaxStep((m) => Math.max(m, next));
  }

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
  async function uploadPhotosQueued(base: ProductPayload, files: File[]): Promise<ProductPayload> {
    // The server intentionally accepts one file per request so a multi-photo
    // drop cannot multiply multipart buffering. UX stays multi-file; this is
    // simply a bounded queue behind the dropzone.
    return runSequentially(base, files, async (latest, file) => {
      const fd = new FormData();
      fd.set("photos", file);
      const res = await fetch(`/api/dashboard/campaign/product/${base.product_id}/photos`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFail(data.code ?? "ERROR", data.message_id ?? "Upload foto gagal.", false);
      return { ...latest, images: data.images, image_urls: data.image_urls };
    }, (latest) => setProduct(latest));
  }

  /** Mulai dari FOTO, bukan dari link (permintaan Brian 2026-08-12).
   *
   *  Banyak brand TikTok Shop tidak punya halaman produk yang bisa dibaca —
   *  Shopee dan TikTok Shop memblokir pembacaan otomatis, dan produk baru
   *  sering belum tayang di mana pun. Sebelum ini satu-satunya jalan adalah
   *  "atau isi manual", tulisan kecil abu-abu di sebelah tombol utama, lalu
   *  fotonya baru bisa diunggah satu layar kemudian. Padahal foto produk itu
   *  bahan WAJIB untuk render — menyembunyikannya di langkah berikutnya
   *  membuat jalur yang paling sering dipakai terasa seperti jalur cadangan.
   *
   *  product_id dipakai LANGSUNG dari respons, bukan dari state `product`:
   *  setProduct baru berlaku pada render berikutnya, jadi membaca state di
   *  sini akan mengunggah foto ke produk yang salah (atau ke null). */
  async function handleMulaiDariFoto(files: FileList) {
    if (files.length === 0) return;
    setLoading(true); setError(null); setNotice(null);
    try {
      const dibuat = await apiFetch<{ extracted: boolean; message?: string } & Partial<ProductPayload>>(
        "/api/dashboard/campaign/product", { json: { name: "Produk baru", price_idr: 0 } }
      );
      if (!dibuat.extracted) { setNotice(dibuat.message ?? "Gagal menyiapkan produk."); return; }
      const produk = dibuat as ProductPayload;
      // Make the newly created product reachable before the first upload; a
      // later file failure must not strand the product or earlier successes.
      setProduct(produk);
      go(2);
      const latest = await uploadPhotosQueued(produk, Array.from(files).slice(0, MAX_PHOTOS));
      setProduct(latest);
      setNotice("Fotonya sudah masuk. Tinggal isi nama dan harganya.");
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal memulai dari foto.");
    } finally { setLoading(false); }
  }

  async function handleUploadPhotos(files: FileList | File[]) {
    if (!product) return;
    const accepted = new Set(["image/png", "image/jpeg", "image/webp"]);
    const incoming = Array.from(files);
    const valid = incoming.filter((file) => accepted.has(file.type));
    const room = Math.max(0, MAX_PHOTOS - product.images.length);
    if (!valid.length) { setError("Pakai foto PNG, JPG, atau WebP ya."); return; }
    if (!room) { setError(`Foto sudah penuh (${MAX_PHOTOS}/${MAX_PHOTOS}). Hapus satu dulu untuk mengganti.`); return; }
    const upload = valid.slice(0, room);
    if (valid.length !== incoming.length) setNotice("File selain PNG, JPG, atau WebP tidak ikut diunggah.");
    if (valid.length > room) setNotice(`Hanya ${room} foto yang masuk karena batasnya ${MAX_PHOTOS}.`);
    setLoading(true); setError(null);
    try {
      setProduct(await uploadPhotosQueued(product, upload));
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Upload foto gagal.");
    } finally { setLoading(false); }
  }

  async function handleDeletePhoto(rel: string) {
    if (!product) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/dashboard/campaign/product/${product.product_id}/photos`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: rel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFail(data.code ?? "ERROR", data.message_id ?? "Hapus foto gagal.", false);
      setProduct({ ...product, images: data.images, image_urls: data.image_urls });
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Hapus foto gagal.");
    } finally { setLoading(false); }
  }

  // Nama + harga + minimal satu foto DIPERIKSA DI SINI, di langkah yang
  // memuat kolomnya.
  //
  // Sebelum ini wizard membiarkan brand maju dua langkah dengan harga kosong,
  // lalu baru gagal jauh di belakang saat pembuatan skrip — pesannya pun
  // muncul di layar Review, bukan di sebelah kolom yang salah. Ditemukan saat
  // menyusuri satu rantai penuh 2026-08-11: produk tersimpan "Produk baru"
  // harga 0, wizard lolos ke Konsep dan Review, lalu 400 "Isi harga produknya
  // dulu". Kesalahan sejauh itu dari tempat asalnya mahal untuk dipahami.
  function detailBelumLengkap(): string | null {
    if (!product) return null;
    if (!product.name.trim() || product.name.trim() === "Produk baru") return "Isi nama produknya dulu.";
    if (!Number.isFinite(product.price_idr) || product.price_idr <= 0) {
      return "Isi harga produknya dulu — harga dipakai di skrip dan overlay video.";
    }
    if (product.images.length === 0) return "Tambah minimal satu foto produk dulu.";
    return null;
  }

  async function handleSaveDetail() {
    if (!product) return;
    const kurang = detailBelumLengkap();
    if (kurang) { setError(kurang); return; }
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ProductPayload>("/api/dashboard/campaign/product", {
        method: "PATCH",
        json: {
          product_id: product.product_id, name: product.name, price_idr: product.price_idr,
          category: product.category, product_visual_desc: product.product_visual_desc ?? "",
          brand_brief: product.brand_brief ?? "",
          promo_price_before_idr: product.promo_price_before_idr ?? null,
          promo_ends_at: product.promo_ends_at ?? null,
          promo_stock_left: product.promo_stock_left ?? null,
          claims: claims.map((c) => c.trim()).filter(Boolean),
        },
      });
      setProduct(res);
      if (modeCepat) {
        const pilihan = pickTemplate({ category: res.category, priceIdr: res.price_idr });
        terapkanTemplate(pilihan.template);
        setAlasanPilih(pilihan.alasan);
        go(5); // langsung ke Review — langkah Konsep dilewati, bukan dihapus
        return;
      }
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
    if (avatarNeedsReselection || !getAvatarPreset(avatarId)) { setError("Pilih ulang avatar untuk template lama ini dulu ya."); return; }
    setLoading(true); setError(null); setNotice(null);
    try {
      const res = await apiFetch<{ requested: number; scripts: GeneratedScript[] }>(
        "/api/dashboard/campaign/generate",
        { json: {
          product_id: product.product_id, count, tier, duration_sec: durationSec, hook_level: hookLevel,
          avatar_id: avatarId,
          register: getAvatarPreset(avatarId)?.register ?? "netral",
          // Template = tiru konten itu persis, jadi hook-nya DIKUNCI (bukan
          // cuma disarankan) dan pembagian detiknya ikut dari shot list
          // aslinya. Tanpa keduanya, memilih satu template tetap menghasilkan
          // tiga skrip dengan keluarga hook berbeda dan pembagian waktu yang
          // seragam untuk semua template.
          ...(template?.hookFamily
            ? { hook_families: [template.hookFamily], lock_hook_family: true }
            : {}),
          // Id template ikut supaya mesin bisa mengambil VARIASI KALIMAT
          // (lib/script-engine/template-copy.ts) — hook tetap dikunci, yang
          // berbeda cuma cara mengatakannya. Keputusan Brian 2026-08-12.
          ...(template?.id ? { template_id: template.id } : {}),
          ...(template?.beats ? { beats: template.beats } : {}),
          ...(template?.wordBudget ? { word_budget: template.wordBudget } : {}),
        } }
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
          format,
          // Kategori kreator dipinjam dari preset — itu yang membawa suara,
          // register, dan gaya pembawaan yang sudah teruji.
          creator_category: getAvatarPreset(avatarId)?.voice ?? "lokal",
          avatar_id: avatarId,
          // Wajah: foto unggahan brand menang atas deskripsi influencer.
          // Kalau tidak ada unggahan, deskripsi influencerlah yang dikirim —
          // tanpa ini semua influencer yang berbagi suara akan tampil sama.
          avatar_custom_desc: customAvatarDesc ?? getAvatarPreset(avatarId)?.castLock ?? null,
          // null = biarkan mesin menurunkan jumlah adegan seperti sebelumnya.
          shot_count: multiShot ? shotCount : null, ratio, no_model: noModel,
          tvc_route: template?.tvcRoute ?? null,
          // Id template ikut dikirim supaya perencana shot memakai struktur
          // template itu, bukan beat generik. Tanpa ini, memilih "Bedah Fitur"
          // atau "Klaim + Bahan Aktif" menghasilkan susunan shot yang sama.
          template_id: template?.id ?? null,
          record_style: recordStyle,
        },
      });
      router.push(`/dashboard/campaign/${res.run_id}`);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal mulai render.");
      setLoading(false);
    }
  }

  const avatars = AVATAR_PRESETS.filter((a) => a.gender === avatarGender);
  useEffect(() => {
    if (avatarNeedsReselection) return;
    if (!AVATAR_PRESETS.some((avatar) => avatar.id === avatarId && avatar.gender === avatarGender)) {
      setAvatarId(AVATAR_PRESETS.find((avatar) => avatar.gender === avatarGender)?.id ?? "");
    }
  }, [avatarGender, avatarId, avatarNeedsReselection]);
  const selectedCount = scripts.filter((s) => !excluded.has(s.script_id)).length;
  // Seragam = semua varian punya caption yang sama persis. Diperiksa dari
  // HASILNYA, bukan dari "apakah template dipakai": kalau nanti variasi
  // kalimat per template ditulis, layar pilihan muncul lagi dengan
  // sendirinya tanpa ada yang perlu mengingat untuk menyalakannya.
  const skripSeragam =
    scripts.length > 1 && scripts.every((s) => s.caption === scripts[0].caption);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Stepper steps={STEPS} current={step} maxReached={maxStep} onJump={(i) => go(i)} />
      </div>

      {/* Template aktif ditampilkan terang-terangan. Kalau pengaturan terisi
          sendiri tanpa penjelasan, brand akan mengira sistemnya ngawur. */}
      {/* Alasan pemilihan otomatis. Ditampilkan karena penggunanya brand yang
          PAHAM konten — mereka berhak tidak setuju, dan tidak bisa tidak setuju
          dengan keputusan yang tidak dijelaskan. Tombol di bawahnya membuka
          seluruh pengaturan, jadi mode cepat tidak pernah jadi jalan buntu. */}
      {modeCepat && alasanPilih && template && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="text-sm text-sky-900">
            Kami pilihkan <b>{template.name}</b> — {alasanPilih}
          </p>
          <button
            onClick={() => { setModeCepat(false); setAlasanPilih(null); go(4); }}
            className="mt-1.5 text-xs font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900"
          >
            Bukan ini — atur sendiri
          </button>
        </div>
      )}

      {template && !modeCepat && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-amber-900">
              Pakai template <b>{template.name}</b> — {template.when}
            </p>
            {/* Rambu ini menempel sampai langkah Review. Template klaim hasil
                (before/after, day 1 vs day 7, perbandingan dua lengan) tidak
                boleh dihasilkan penuh oleh AI — larangan itu datang dari
                dokumen bedahnya sendiri, dan alasannya kuat: bukti sintetis
                soal efek produk di kulit orang adalah bukti palsu. Kami tetap
                membiarkan brand memakai kerangkanya, tapi tidak pura-pura
                bahwa adegan buktinya bisa kami buatkan. */}
            {template.caution && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold leading-4 text-red-700">
                <ShieldAlert size={13} className="mt-px shrink-0" />
                {template.caution.note}
              </p>
            )}
          </div>
          <button
            onClick={() => setTemplate(null)}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800"
          >
            Lepas template
          </button>
        </div>
      )}

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
              { id: "affiliate" as const, icon: ShoppingBag, title: "AI UGC Affiliate", desc: "Jualan produk fisik ke TikTok Shop. AI yang peragakan produkmu — cukup foto.", ready: true, preview: "/previews/format-tangan.mp4" },
              { id: "ads" as const, icon: Megaphone, title: "AI UGC Ads", desc: "Buat app, jasa, atau toko — yang tidak punya barang fisik. Presenter AI yang bicara.", ready: true, preview: "/previews/format-ads.mp4" },
              // Preview TVC: potongan TVC "The Drop" yang benar-benar diproduksi
              // (Brian, 2026-08-11) — klip yang sama dengan template TVC di
              // galeri, jadi apa yang dilihat di sini persis yang dia dapat.
              // Landscape 16:9 asli; kotaknya ikut, bukan dipaksa 9:16.
              { id: "tvc" as const, icon: Film, title: "AI TVC", desc: "Sinematik, kamera terkontrol, pencahayaan ditata, ditutup hero shot produk.", ready: true, preview: "/previews/tvc-the-drop.mp4" },
            ]).map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => {
                    if (!k.ready) return;
                    setKind(k.id);
                    // TVC punya peta beat sendiri (15/30 dtk) dan selalu
                    // dipimpin presenter — jadi format & durasi diselaraskan
                    // di sini, bukan dibiarkan menghasilkan kombinasi yang
                    // nanti ditolak server.
                    // Jenis mengunci format: TVC dan Iklan Jasa masing-masing
                    // punya framing & kebijakan QC sendiri, jadi membiarkan
                    // user memilih "Tangan + VO" di sini hanya menghasilkan
                    // kombinasi yang ditolak server beberapa langkah kemudian.
                    if (k.id === "tvc") { setFormat("tvc"); if (durationSec === 45) setDurationSec(30); }
                    else if (k.id === "ads") { setFormat("ads"); if (durationSec === 45) setDurationSec(30); }
                    else if (format === "tvc" || format === "ads") setFormat("hands_only");
                  }}
                  disabled={!k.ready}
                  // flex-col + justify-start WAJIB: browser memusatkan isi
                  // <button> secara vertikal, dan begitu kartu-kartu ini
                  // diregangkan sama tinggi oleh grid, kartu yang isinya lebih
                  // pendek (klip landscape) melayang di tengah dengan celah
                  // besar di atasnya.
                  className={`flex flex-col items-stretch justify-start rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    active ? "border-amber-500" : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  {/* Contoh hasil nyata, bukan ilustrasi — user memilih HASIL
                      yang kelihatan, bukan label abstrak (pola yang sama
                      dipakai halaman jenis di retail). */}
                  {/* Rasio DIKUNCI 9:16 di sini, berbeda dari galeri template.
                      Alasannya bukan teknis tapi tata letak: ketiga kartu ini
                      berdiri sejajar dalam satu baris, dan begitu satu kotak
                      landscape sementara dua lainnya potret, barisnya langsung
                      terlihat timpang. Klip TVC yang landscape dipotong tengah
                      (object-cover) — di galeri template, yang kartunya berdiri
                      sendiri-sendiri, rasio aslinya tetap dipertahankan. */}
                  <div className="relative mb-3 aspect-[9/16] max-h-72 w-full overflow-hidden rounded-xl bg-zinc-900">
                    {k.preview ? (
                      <video
                        src={k.preview}
                        autoPlay muted loop playsInline
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
                        <Film size={26} />
                        <span className="text-[11px] font-medium">Contoh menyusul</span>
                      </div>
                    )}
                  </div>
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
            <button onClick={() => go(1)} className={BTN_PRIMARY}>
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
            <p className="mt-1 text-sm text-zinc-500">Upload foto produknya, atau tempel link kalau produkmu sudah tayang.</p>
          </div>

          {/* FOTO DULU, LINK BELAKANGAN (permintaan Brian 2026-08-12).
              Urutannya sengaja dibalik: Shopee dan TikTok Shop memblokir
              pembacaan otomatis, dan produk baru sering belum tayang di mana
              pun — jadi jalur foto adalah jalur yang paling sering dipakai,
              bukan cadangan. Menaruhnya di bawah link membuat yang umum
              terasa seperti kegagalan. */}
          <label
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 bg-white px-6 py-10 text-center transition-colors hover:border-amber-400 hover:bg-amber-50/40 ${loading ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
              onChange={(e) => e.target.files && handleMulaiDariFoto(e.target.files)}
            />
            {loading ? <Loader2 size={24} className="animate-spin text-amber-500" /> : <ImagePlus size={24} className="text-zinc-400" />}
            <span className="text-sm font-bold text-zinc-800">Upload foto produk</span>
            <span className="text-xs text-zinc-500">PNG atau JPG, maksimal {MAX_PHOTOS} foto. Nama dan harga diisi di langkah berikutnya.</span>
          </label>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-200" />
            <span className="text-xs font-medium text-zinc-400">atau tempel link produk</span>
            <div className="h-px flex-1 bg-zinc-200" />
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
                className={BTN_PRIMARY}
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

          <section
            onDragEnter={(event) => { event.preventDefault(); if (!loading) setPhotoDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPhotoDragActive(false); }}
            onDrop={(event) => { event.preventDefault(); setPhotoDragActive(false); if (!loading) void handleUploadPhotos(event.dataTransfer.files); }}
            className={`space-y-3 rounded-2xl border-2 bg-white p-6 shadow-sm transition-colors ${photoDragActive ? "border-amber-500 bg-amber-50/60" : "border-zinc-200"}`}
            data-testid="product-photo-dropzone"
          >
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
                onChange={(event) => { if (event.target.files) void handleUploadPhotos(event.target.files); event.target.value = ""; }}
              />
            </div>
            <p className={`text-xs ${photoDragActive ? "font-semibold text-amber-700" : "text-zinc-500"}`}>
              {photoDragActive ? "Lepaskan foto di sini" : "Tarik & lepas beberapa foto ke kotak ini, atau pilih Tambah foto."}
            </p>
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
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
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
            {/* Klaim: teks yang muncul di layar saat video berjalan.
                Dipisah dari skrip DENGAN SENGAJA — validator melarang AI
                mengarang klaim dan angka, sedangkan ini ditulis brand dan
                brand yang bertanggung jawab atas kebenarannya. */}
            {/* col-span-2: blok ini berada di dalam grid dua kolom. Tanpa
                rentang penuh ia menempati kolom kiri saja dan menyisakan
                lubang kosong sebesar setengah kartu di sebelahnya — persis
                seperti blok Urgensi di bawahnya yang memang sudah melebar. */}
            <div className="col-span-2 rounded-xl border border-zinc-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Klaim di layar (opsional)</p>
              <p className="mt-1 text-xs text-zinc-500">
                Maksimal 3, muncul bergantian di tengah video. Contoh: &ldquo;Tahan 12 jam&rdquo;, &ldquo;BPOM terdaftar&rdquo;.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <input
                    key={i}
                    value={claims[i] ?? ""}
                    onChange={(e) => {
                      const next = [...claims];
                      next[i] = e.target.value.slice(0, 34);
                      setClaims(next);
                    }}
                    maxLength={34}
                    placeholder={i === 0 ? "Tahan 12 jam" : `Klaim ${i + 1}`}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-amber-400"
                  />
                ))}
              </div>
            </div>

            {/* Urgensi & kelangkaan — angka di sini boleh muncul di caption
                dan overlay, tapi tidak pernah dikarang di skrip. Promo yang
                sudah lewat tanggalnya otomatis di-drop saat render. */}
            <div className="col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Urgensi &amp; kelangkaan (opsional)</p>
              <p className="mt-1 text-xs text-zinc-500">Isi kalau memang benar. Diskon yang tidak nyata bikin brand kehilangan kepercayaan.</p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs text-zinc-500">Harga normal (coret)</span>
                  <input
                    type="number" min={0} value={product.promo_price_before_idr ?? ""}
                    onChange={(e) => setProduct({ ...product, promo_price_before_idr: e.target.value ? Number(e.target.value) : null })}
                    placeholder="mis. 249000"
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Promo berakhir</span>
                  <input
                    type="date" value={product.promo_ends_at ? product.promo_ends_at.slice(0, 10) : ""}
                    onChange={(e) => setProduct({ ...product, promo_ends_at: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Stok tersisa</span>
                  <input
                    type="number" min={0} value={product.promo_stock_left ?? ""}
                    onChange={(e) => setProduct({ ...product, promo_stock_left: e.target.value ? Number(e.target.value) : null })}
                    placeholder="mis. 12"
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              </div>
              {product.promo_price_before_idr !== null && product.promo_price_before_idr <= product.price_idr && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Harga normal harus lebih besar dari harga jual — kalau tidak, angka ini diabaikan.
                </p>
              )}
            </div>
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

          <div className="flex items-center justify-between gap-4">
            <button onClick={() => go(1)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            {/* Alasan tombol mati ditulis TERBACA, bukan cuma di tooltip.
                Tombol nonaktif tanpa keterangan sama membingungkannya dengan
                error yang muncul dua langkah kemudian. */}
            {detailBelumLengkap() && (
              <p className="flex-1 text-right text-xs font-medium text-amber-700">{detailBelumLengkap()}</p>
            )}
            <button
              onClick={handleSaveDetail}
              disabled={loading || detailBelumLengkap() !== null}
              title={detailBelumLengkap() ?? undefined}
              className={BTN_PRIMARY}
            >
              {loading && <Loader2 size={16} className="animate-spin" />} Lanjut
            </button>
          </div>
        </div>
      )}


      {/* ---------- 3. AVATAR ----------
          Langkah sendiri sejak 2026-08-12 (permintaan Brian). Dulu terselip di
          dalam Konsep, di bawah slider hook: pilihan sepenting "siapa yang
          muncul di video" jadi sisipan di layar yang sudah padat, dan brand
          sering melewatkannya lalu kaget melihat wajah default. */}
      {step === 3 && product && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Siapa yang membawakan?</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Pilih dari kreator AI kami, atau pakai foto sendiri. Berlaku untuk semua variasi video di kampanye ini.
            </p>
          </div>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div>
            {/* Toggle gender dibesarkan & disejajarkan dengan kontrol lain
                (sebelumnya kecil di pojok, tidak kelihatan). Upload foto
                sendiri jadi ubin "+" PERTAMA di grid, bukan tombol terpisah
                di atasnya — tempatnya di antara pilihan avatar, karena itu
                memang salah satu pilihan avatar. */}
            {/* Judulnya berubah saat Tanpa model menyala. Membiarkannya
                tetap "Avatar" membuat brand mengira orang yang dipilih akan
                muncul di layar — padahal yang dipakai cuma suaranya, dan
                kekeliruan itu baru ketahuan setelah videonya jadi. */}
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
              {noModel ? "Suara (avatar tidak tampil di layar)" : "Avatar"}
            </p>
            <div className="mb-3 flex gap-2">
              {(["female", "male"] as const).map((g) => (
                <button key={g} onClick={() => setAvatarGender(g)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${avatarGender === g ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                >{g === "female" ? "Perempuan" : "Laki-laki"}</button>
              ))}
            </div>
            <input
              ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => e.target.files?.[0] && handleAvatarPhoto(e.target.files[0])}
            />

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
              <button
                onClick={() => avatarInput.current?.click()}
                disabled={loading}
                title="Pakai foto sendiri"
                className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors disabled:opacity-50 ${customAvatarDesc ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-400 hover:border-amber-400 hover:text-amber-600"}`}
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : <Plus size={22} />}
                <span className="px-1 text-[10px] font-semibold leading-tight">Foto sendiri</span>
              </button>
              {avatars.map((a) => (
                <button key={a.id} onClick={() => { setAvatarId(a.id); setAvatarNeedsReselection(false); }} title={a.name}
                  className={`overflow-hidden rounded-xl border-2 transition-colors ${avatarId === a.id ? "border-amber-500" : "border-transparent hover:border-zinc-200"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.img} alt={a.name} className="aspect-square w-full object-cover" />
                  <p className="truncate px-1 py-1 text-[10px] font-medium text-zinc-600">{a.name}</p>
                </button>
              ))}
            </div>
            {avatarNeedsReselection && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                Template lama ini belum menyimpan identitas influencer. Pilih satu avatar untuk melanjutkan.
              </p>
            )}
          </div>
          </section>

          <div className="flex items-center gap-3">
            <button onClick={() => go(2)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            <div className="flex-1" />
            <button onClick={() => go(4)} disabled={avatarNeedsReselection || !getAvatarPreset(avatarId)} className={`${BTN_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50`}>Lanjut</button>
          </div>
        </div>
      )}

      {/* ---------- 4. KONSEP ---------- */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Konsep videonya</h1>
            <p className="mt-1 text-sm text-zinc-500">Berlaku untuk semua variasi video di kampanye ini.</p>
          </div>

          <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Format</p>
              <div className="flex gap-2">
                {(kind === "tvc"
                  // "presenter" itu bahasa UGC dan bertentangan dengan kartu
                  // Jenis yang menjanjikan iklan TV sinematik. TVC di sini
                  // memang iklan TV: kamera terkontrol, ditutup hero shot.
                  ? [{ id: "tvc" as const, label: "TVC (sinematik + hero shot)" }]
                  : [{ id: "talking_head" as const, label: "Wajah AI" }, { id: "hands_only" as const, label: "Tangan + VO" }]
                ).map((f) => (
                  <button key={f.id}
                    onClick={() => { setFormat(f.id); setRecordStyle(GAYA_BAWAAN); if (f.id === "talking_head") setDurationSec(15); }}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${format === f.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                  >{f.label}</button>
                ))}
              </div>
            </div>

            {/* GAYA REKAM — sumbu "bagaimana direkam", terpisah dari "apa yang
                dijual" (ide dari UGC Factory Higgsfield). Hanya untuk format
                yang punya pilihan: TVC punya style-lock sendiri, jadi tidak
                pernah muncul di sini.

                Daftarnya SELALU lewat stylesForFormat — menawarkan gaya yang
                tidak cocok formatnya bukan menambah pilihan, tapi menyiapkan
                render rusak yang tetap dibayar penuh. */}
            {format !== "tvc" && stylesForFormat(format).length > 1 && (
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Gaya rekam</p>
                  <p className="text-[11px] text-zinc-400">Berlaku untuk semua variasi</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {stylesForFormat(format, product?.category).map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setRecordStyle(g.id)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        recordStyle === g.id
                          ? "border-amber-500 bg-amber-50"
                          : "border-zinc-200 bg-white hover:border-zinc-300"
                      }`}
                    >
                      <p className={`text-sm font-semibold ${recordStyle === g.id ? "text-amber-800" : "text-zinc-800"}`}>
                        {g.label}
                      </p>
                      {/* Deskripsi menjelaskan APA YANG TERLIHAT, bukan kapan
                          dipakai — "kamera depan dipegang sepanjang lengan"
                          bisa dibayangkan seketika, "cocok untuk brand yang
                          ingin terlihat dekat" tidak. */}
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{g.lihat}</p>
                    </button>
                  ))}
                </div>
                {/* Kejujuran bukti: fragmen prompt tiap gaya disusun mengikuti
                    pola framing yang sudah terbukti, tapi belum satu pun diuji
                    lewat render sungguhan. Brand berhak tahu mana yang teruji. */}
                {recordStyle !== GAYA_BAWAAN && (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Gaya selain Standar masih baru — hasilnya belum sebanyak Standar diuji. Kamu tetap
                    meninjau tiap scene sebelum video digabung.
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Durasi</p>
              <div className="flex gap-2">
                {([15, 30, 45] as const).map((d) => {
                  const disabled =
                    (format === "talking_head" && d !== 15) || (format === "tvc" && d === 45);
                  return (
                    <button key={d} onClick={() => !disabled && setDurationSec(d)} disabled={disabled}
                      title={disabled ? (format === "tvc" ? "TVC tersedia 15 atau 30 detik" : "Wajah AI cuma tersedia 15 detik") : undefined}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${durationSec === d ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                    >{d} dtk</button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Quality</p>
                {/* Resolusi TIDAK bisa dipilih terpisah: harga tiap tier
                    dihitung dari resolusinya, jadi memisahkan keduanya akan
                    membuat tagihan tidak cocok dengan yang dirender. Karena
                    itu ditampilkan sebagai keterangan, bukan tombol. */}
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600">
                  {TIER_META[tier].resolution}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {TIER_OPTIONS.map((t) => (
                  <button key={t.id} onClick={() => setTier(t.id)}
                    className={`rounded-lg border px-4 py-2 text-left text-sm font-medium transition-colors ${tier === t.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                  >
                    {t.label}
                    <span className="mt-0.5 block text-[10px] font-normal opacity-70">{TIER_META[t.id].note}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* TVC tanpa model — dari template Brian: 4 dari 6 modulnya memang
                tidak ada orangnya. Hanya muncul untuk TVC; format lain
                dibangun di sekitar presenter. */}
            {kind === "tvc" && (
              <div>
                <button
                  onClick={() => setNoModel(!noModel)}
                  className="flex w-full items-center justify-between rounded-xl border border-zinc-300 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
                >
                  <span>
                    <span className="block text-sm font-semibold text-zinc-800">Tanpa model</span>
                    <span className="block text-xs text-zinc-500">Produk saja: makro, tekstur, packshot. Tidak ada orang di layar.</span>
                  </span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${noModel ? "bg-amber-500" : "bg-zinc-300"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${noModel ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                  </span>
                </button>
                {noModel && (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Suaranya tetap dari avatar yang dipilih — yang dimatikan cuma kehadirannya di layar.
                  </p>
                )}
              </div>
            )}

            {/* Rasio aspek */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Rasio</p>
              <div className="flex gap-2">
                {RATIOS.map((r) => {
                  const dipilih = ratio === r.id;
                  return (
                    <button key={r.id} onClick={() => setRatio(r.id)}
                      aria-pressed={dipilih}
                      // Label lengkap untuk pembaca layar: bentuk kotaknya tidak
                      // terbaca sama sekali oleh mereka.
                      aria-label={`Rasio ${r.label} — ${r.untuk}`}
                      title={r.untuk}
                      className={`flex min-w-[76px] flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${dipilih ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                    >
                      {/* Kotak berbentuk rasionya. Tinggi baris dikunci 22px supaya
                          tombol tidak naik-turun waktu rasio berganti. */}
                      <span className="flex h-[22px] items-center justify-center" aria-hidden="true">
                        <span
                          style={{ width: r.w, height: r.h }}
                          className={`block rounded-[3px] border-2 ${dipilih ? "border-amber-500 bg-amber-100" : "border-zinc-400 bg-white"}`}
                        />
                      </span>
                      <span>{r.label}</span>
                    </button>
                  );
                })}
              </div>
              {ratio !== "9:16" && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Baru 9:16 yang sudah kami render sungguhan. {ratio} didukung API-nya tapi belum diuji —
                  kalau gagal, tokenmu dikembalikan otomatis.
                </p>
              )}
            </div>

            {/* Multi-shot */}
            <div>
              <button
                onClick={() => setMultiShot(!multiShot)}
                className="flex w-full items-center justify-between rounded-xl border border-zinc-300 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
              >
                <span>
                  <span className="block text-sm font-semibold text-zinc-800">Multi-shot</span>
                  <span className="block text-xs text-zinc-500">Pecah videonya jadi beberapa adegan, bukan satu ambilan.</span>
                </span>
                <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${multiShot ? "bg-amber-500" : "bg-zinc-300"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${multiShot ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                </span>
              </button>
              {multiShot && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-2">
                    {[2, 3, 4, 5, 6].map((n) => {
                      // Batas keras provider: minimal 4 detik per adegan. 6
                      // adegan dalam 15 detik akan dipanjangkan paksa dan
                      // durasinya meleset, jadi pilihan yang mustahil dimatikan
                      // di sini — bukan dibiarkan gagal saat render.
                      const bisa = n <= Math.floor(durationSec / 4);
                      return (
                        <button key={n} onClick={() => bisa && setShotCount(n)} disabled={!bisa}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${shotCount === n && bisa ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                        >{n} adegan</button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Maksimal {Math.floor(durationSec / 4)} adegan untuk {durationSec} detik — tiap adegan minimal 4 detik.
                  </p>
                </div>
              )}
            </div>

            {/* Level hook: LIMA posisi, TIGA label (keputusan Brian 2026-08-11:
                "yang di tampilkan di toggle itu 3 tulisan aja, orang paham
                kok"). Posisi 2 dan 4 sengaja tanpa nama — keduanya titik
                tengah nyata, bukan pengisi: level 2 mencampur keluarga hook
                kategori dengan yang agresif, level 4 menambah pembuka visual
                lembut sebelum yang penuh di level 5. */}
            <div className={kind === "tvc" || kind === "ads" ? "hidden" : undefined}>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Level hook</p>
                <p className="text-xs font-semibold text-amber-600">{HOOK_LABEL[hookLevel]}</p>
              </div>
              <input
                type="range" min={1} max={5} step={1}
                value={HOOK_LEVELS.indexOf(hookLevel) + 1}
                onChange={(e) => setHookLevel(HOOK_LEVELS[Number(e.target.value) - 1])}
                className="w-full accent-amber-500"
                aria-label="Level hook"
              />
              <div className="mt-1 flex justify-between text-[11px] font-medium text-zinc-400">
                <span>Normal</span><span>Berani</span><span>Gila</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{HOOK_HINT[hookLevel]}</p>
            </div>
          </section>

          {/* Simpan konfigurasi ini jadi template milik brand (masukan tester).
              Diletakkan DI SINI, bukan di akhir alur: pada titik ini semua
              pilihan konsep sudah dibuat, dan setelah render dimulai brand
              sudah beralih memikirkan hasilnya, bukan pengaturannya. */}
          <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-800">Simpan pengaturan ini jadi template</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Lain kali tinggal pilih templatenya dan masukkan produk baru.
              </p>
            </div>
            <input
              value={savedName}
              onChange={(e) => setSavedName(e.target.value)}
              placeholder="Nama template"
              className="w-48 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-amber-400"
            />
            <button
              onClick={saveAsTemplate}
              disabled={!savedName.trim() || savingTpl}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
            >
              {savingTpl ? "Menyimpan..." : "Simpan"}
            </button>
          </section>

          <div className="flex justify-between">
            <button onClick={() => go(3)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            <button onClick={() => go(5)} className={BTN_PRIMARY}>
              Lanjut
            </button>
          </div>
        </div>
      )}

      {/* ---------- 5. REVIEW ---------- */}
      {step === 5 && product && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Berapa video yang mau dibuat?</h1>
            <p className="mt-1 text-sm text-zinc-500">Satu produk, beberapa variasi — tiap video pakai sudut hook yang berbeda.</p>
          </div>

          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex gap-2">
              {Array.from({ length: maxVideoCount - 1 }, (_, index) => index + 2).map((n) => (
                <button key={n} onClick={() => setCount(n)}
                  className={`h-11 w-11 rounded-lg border text-sm font-bold transition-colors ${count === n ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                >{n}</button>
              ))}
            </div>
            {template && (
              <p className="text-xs font-medium text-amber-700">
                Template ini punya maksimal {TEMPLATE_COPY_CAPACITY} naskah unik. Lepas template untuk membuat sampai 6 video.
              </p>
            )}
            <p className="text-sm text-zinc-600">
              Estimasi <b>{rupiah(estimateIdr(tier, durationSec, count))}</b> untuk {count} video ({durationSec} dtk, {tier === "super_hq" ? "AI Bersuara Pro" : "AI Bersuara"}).
              Harga pasti dihitung ulang server saat render.
            </p>
            <p className="text-sm text-zinc-500">
              Waktu render: sekitar <b>3–8 menit per video</b> (bisa sampai 45 menit kalau antrean AI padat).
              Video dibuat berbarengan, jadi {count} video tidak berarti {count}× lama. Kamu akan diminta
              meninjau tiap adegan dulu sebelum digabung.
            </p>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={BTN_PRIMARY}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Membuat skrip..." : scripts.length ? "Buat ulang skrip" : "Buat skrip"}
            </button>
          </section>

          {/* TEMPLATE TIDAK MENAWARKAN PILIHAN SKRIP.
              Template mengunci keluarga hook-nya, dan mesin menghasilkan satu
              teks tetap per keluarga — jadi semua variannya keluar sama persis
              kata per kata. Menampilkan "2 skrip siap, pilih yang mau
              dirender" untuk dua teks identik adalah pilihan palsu: brand
              membandingkan dua hal yang tidak berbeda.
              Skripnya tetap N baris di belakang layar supaya N video tetap
              terbentuk; yang berubah cuma layarnya berhenti berpura-pura. */}
          {scripts.length > 0 && skripSeragam && (
            <section className="space-y-3">
              <p className="text-sm font-bold text-zinc-900">Skrip template siap</p>
              <div className="rounded-xl border border-amber-300 bg-white p-4 shadow-sm">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
                  <CheckCircle2 size={13} className="text-emerald-500" /> hook {scripts[0].hook_family} · dikunci template
                </p>
                <BarisNaskah s={scripts[0]} />
                <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                  Dirender jadi <b>{scripts.length} video</b> dari skrip yang sama. Visualnya tetap
                  berbeda karena tiap video digambar ulang sendiri-sendiri.
                </p>
              </div>
            </section>
          )}

          {scripts.length > 0 && !skripSeragam && (
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
                        <BarisNaskah s={s} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="flex justify-between">
            <button onClick={() => go(4)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">
              <ArrowLeft size={15} /> Kembali
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || selectedCount === 0}
              className={BTN_PRIMARY}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {/* "Setujui" menyiratkan memilih. Kalau tidak ada yang bisa
                  dipilih, yang jujur adalah menyebut apa yang akan terjadi. */}
              {loading
                ? "Memulai render..."
                : skripSeragam
                  ? `Render ${scripts.length} video`
                  : `Setujui ${selectedCount} & Mulai Render`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
