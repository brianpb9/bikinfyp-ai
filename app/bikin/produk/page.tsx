"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, WarnCard } from "../../_components/ui";
import { CATEGORY_OPTIONS, loadFlow, saveFlow, rupiah } from "../../_components/flow";
import { guessCategory } from "@/lib/category-guess";

// Harus sinkron dengan MAX_IMAGES di lib/product-images.ts (server, tak bisa
// diimpor langsung ke client component karena pakai node:fs/sharp).
const MAX_PHOTOS = 8;

// S2 — INPUT PRODUK (Langkah 1/5)
export default function ProdukPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("beauty");
  // Kategori sudah ditentukan dari sumber yang lebih tepercaya daripada tebakan
  // nama? (pengunjung memilih sendiri, hasil ekstrak URL, draft tersimpan, atau
  // data percobaan /coba). Kalau ya, penebak tidak boleh ikut campur.
  const [kategoriDitentukan, setKategoriDitentukan] = useState(false);
  const [kategoriDitebak, setKategoriDitebak] = useState(false);
  const [visualDesc, setVisualDesc] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [extractedPreviews, setExtractedPreviews] = useState<string[]>([]);
  // Path relatif foto hasil ekstrak — sejajar dengan extractedPreviews; dibutuhkan
  // untuk menghapus foto tertentu di server (tombol ✕).
  const [extractedRels, setExtractedRels] = useState<string[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  // Add-on Promo & Urgency — semua opsional, "mainan konten" (keputusan 2026-08-06)
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoBefore, setPromoBefore] = useState("");
  const [promoEnds, setPromoEnds] = useState("");
  const [promoStock, setPromoStock] = useState("");
  // Loading DIPISAH (fix 2026-08-06 malam): satu state bersama membuat tombol
  // Lanjut ikut terkunci selama "Ambil Data" berjalan/menggantung — user yang
  // sudah mengisi manual jadi buntu tanpa alasan.
  const [extractLoading, setExtractLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const submitLock = useRef(false);

  useEffect(() => () => {
    previewUrls.current.forEach((src) => URL.revokeObjectURL(src));
  }, []);

  // Pulihkan draft dari sessionStorage
  useEffect(() => {
    const f = loadFlow();
    if (f.product) {
      setProductId(f.product.productId);
      setName(f.product.name);
      setPrice(String(f.product.priceIdr));
      setCategory(f.product.category);
      setKategoriDitentukan(true);
      return;
    }
    // Prefill dari percobaan /coba (magic moment tanpa login) — jangan suruh
    // user mengetik ulang; tinggal upload foto.
    try {
      const trial = JSON.parse(sessionStorage.getItem("racun.try") ?? "null") as
        | { name: string; priceIdr: number; category: string }
        | null;
      if (trial) {
        setShowManual(true);
        setName(trial.name);
        setPrice(String(trial.priceIdr));
        setCategory(trial.category);
        setKategoriDitentukan(true);
        sessionStorage.removeItem("racun.try");
      }
    } catch {
      /* abaikan */
    }
  }, []);

  // Jalur isi-manual (link gagal dibaca, atau user memang mengetik sendiri)
  // meninggalkan kategori di "beauty" untuk semua orang. Gamis pun disusun
  // pakai sudut skincare. Sama seperti di /coba: tebak dari nama produk, pakai
  // kamus yang sama (lib/category-guess.ts), dan mundur begitu ada sumber yang
  // lebih tepercaya.
  useEffect(() => {
    if (kategoriDitentukan) return;
    const tebakan = guessCategory(name);
    if (tebakan === "default" || tebakan === category) return;
    setCategory(tebakan);
    setKategoriDitebak(true);
  }, [name, kategoriDitentukan, category]);

  function removeLocalPhoto(i: number) {
    URL.revokeObjectURL(previewUrls.current[i]);
    previewUrls.current = previewUrls.current.filter((_, j) => j !== i);
    setPhotos((p) => p.filter((_, j) => j !== i));
    setPreviews([...previewUrls.current]);
  }

  async function removeExtractedPhoto(i: number) {
    if (!productId) return;
    const path = extractedRels[i];
    try {
      await apiFetch(`/api/products/${productId}/photos`, { method: "DELETE", json: { path } });
      setExtractedRels((r) => r.filter((_, j) => j !== i));
      setExtractedPreviews((p) => p.filter((_, j) => j !== i));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus foto.");
    }
  }

  function pickPhotos(files: FileList | null) {
    if (!files) return;
    // Jatah MAX_PHOTOS foto TOTAL termasuk foto yang sudah terunduh dari link.
    const room = Math.max(0, MAX_PHOTOS - extractedPreviews.length - photos.length);
    const list = Array.from(files).slice(0, room);
    const next = [...photos, ...list];
    previewUrls.current.forEach((src) => URL.revokeObjectURL(src));
    previewUrls.current = next.map((file) => URL.createObjectURL(file));
    setPhotos(next);
    setPreviews(previewUrls.current);
  }

  async function extract() {
    setExtractLoading(true);
    setError(null);
    setExtractMsg(null);
    try {
      const res = await apiFetch<{
        extracted: boolean;
        message?: string;
        product_id?: string;
        name?: string;
        price_idr?: number | null;
        category?: string;
        product_visual_desc?: string | null;
        promo_price_before_idr?: number | null;
        images?: string[];
        image_urls?: string[];
        warning?: string;
      }>("/api/products/extract", {
        json: { url: url.trim() },
        // Batas sabar client: server maksimal ~8 dtk baca halaman + unduh foto;
        // lebih dari 45 dtk = ada yang macet, lepaskan user ke jalur manual.
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.extracted) {
        setExtractMsg(res.message ?? "Link-nya belum bisa kami baca. Isi manual aja ya, cuma 3 kolom kok.");
        setShowManual(true);
      } else {
        // Form terisi otomatis — user konfirmasi/edit (harga wajib diisi bila kosong)
        setProductId(res.product_id!);
        setName(res.name ?? "");
        setPrice(res.price_idr ? String(res.price_idr) : "");
        setCategory(res.category ?? "default");
        setKategoriDitentukan(true);
        setExtractedPreviews(res.image_urls ?? []);
        setExtractedRels(res.images ?? []);
        if (res.product_visual_desc) setVisualDesc(res.product_visual_desc);
        // Harga coret ketemu di halaman -> prefill promo & buka kartunya.
        if (res.promo_price_before_idr) {
          setPromoBefore(String(res.promo_price_before_idr));
          setPromoOpen(true);
        }
        setShowManual(true);
        if (res.warning) setExtractMsg(res.warning);
        else if (!res.image_urls?.length)
          setExtractMsg("Nama & harga ketemu, tapi fotonya nggak kebaca dari link. Upload foto sendiri ya di bawah.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membaca link.");
      setShowManual(true);
    } finally {
      setExtractLoading(false);
    }
  }

  async function submitProduct() {
    if (submitLock.current) return;
    setError(null);
    if (!name.trim()) return setError("Nama produknya belum diisi.");
    const priceIdr = parseInt(price.replace(/[^\d]/g, ""), 10);
    if (!priceIdr || priceIdr <= 0) return setError("Harganya wajib diisi — harga adalah bahan wajib hook videonya.");
    if (extractedPreviews.length + photos.length < 1) return setError(`Upload fotonya dulu ya — minimal 1, maksimal ${MAX_PHOTOS} foto.`);
    // Produk dari ekstraksi tanpa harga: sorot wajib (BR-01.3)
    if (productId && (!price || priceIdr <= 0)) return setError("Harga dari link tidak ketemu — isi manual ya, wajib.");

    // Promo (opsional): harga normal harus > harga jual, kalau diisi.
    const promoBeforeIdr = promoBefore ? parseInt(promoBefore.replace(/[^\d]/g, ""), 10) : null;
    if (promoBeforeIdr !== null && promoBeforeIdr <= priceIdr)
      return setError("Harga normal (sebelum diskon) harus lebih besar dari harga jual — kalau tidak, diskonnya bohong.");

    submitLock.current = true;
    setLoading(true);
    try {
      let id = productId;
      if (!id) {
        const fd = new FormData();
        fd.set("name", name.trim());
        fd.set("price_idr", String(priceIdr));
        fd.set("category", category);
        if (visualDesc.trim()) fd.set("product_visual_desc", visualDesc.trim());
        if (promoBeforeIdr) fd.set("promo_price_before_idr", String(promoBeforeIdr));
        if (promoEnds) fd.set("promo_ends_at", promoEnds);
        if (promoStock) fd.set("promo_stock_left", promoStock);
        for (const p of photos) fd.append("photos", p);
        const controller = new AbortController();
        // Upload kamera di jaringan lambat boleh berlangsung, tapi jangan biarkan
        // UI menggantung tanpa batas bila koneksi putus di tengah jalan.
        const timeout = window.setTimeout(() => controller.abort(), 90_000);
        let res: { product_id: string; images: string[] };
        try {
          res = await apiFetch<{ product_id: string; images: string[] }>("/api/products", { formData: fd, signal: controller.signal });
        } finally {
          window.clearTimeout(timeout);
        }
        id = res.product_id;
        setProductId(id);
      } else {
        // Produk dari ekstraksi: simpan edit konfirmasi user (nama/harga/kategori/deskripsi/promo)
        await apiFetch(`/api/products/${id}`, {
          method: "PATCH",
          json: {
            name: name.trim(), price_idr: priceIdr, category, product_visual_desc: visualDesc.trim() || null,
            promo_price_before_idr: promoBeforeIdr, promo_ends_at: promoEnds || null, promo_stock_left: promoStock || null,
          },
        });
        // Foto tambahan dari kartu konfirmasi (fix 2026-08-06: dulu jalur ini
        // tidak ada — foto link gagal = user buntu total).
        if (photos.length > 0) {
          const fd = new FormData();
          for (const p of photos) fd.append("photos", p);
          await apiFetch(`/api/products/${id}/photos`, { formData: fd });
        }
      }
      saveFlow({
        product: { productId: id, name: name.trim(), priceIdr, category, images: [], promoPriceBeforeIdr: promoBeforeIdr },
        scripts: undefined,
        selectedScriptId: undefined,
        jobId: undefined,
      });
      router.push("/bikin/gaya");
    } catch (err) {
      const networkFailure = err instanceof TypeError || (err instanceof Error && /failed to fetch/i.test(err.message));
      setError(err instanceof DOMException && err.name === "AbortError"
        ? "Upload belum selesai karena koneksinya terlalu lama. Coba cek internet lalu upload lagi ya."
        : networkFailure
          ? "Upload terputus. Coba cek internet lalu upload lagi ya."
          : err instanceof Error ? err.message : "Gagal menyimpan produk.");
    } finally {
      setLoading(false);
      submitLock.current = false;
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-8">
      <FlowHeader title="Bikin Video" step={1} />
      <div className="space-y-5 px-4">
        <section className="space-y-2">
          {/* "Langkah 1 dari 5" TIDAK diulang di sini — FlowHeader tepat di
              atasnya sudah mencetaknya lengkap dengan titik-titiknya. */}
          <div>
            <h2 className="font-display text-xl font-bold text-zinc-900">Tempel link produkmu</h2>
          </div>
          <input
            type="url"
            placeholder="https://vt.tiktok.com/... atau shopee.co.id/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-h-[56px] w-full rounded-2xl border-2 border-zinc-200 px-4 text-base outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={extract}
            disabled={extractLoading || url.trim().length < 8}
            className="min-h-[48px] w-full rounded-2xl border-2 border-zinc-200 font-semibold text-zinc-700 active:bg-zinc-50 disabled:text-zinc-400"
          >
            {extractLoading ? "Membaca link & fotonya..." : "Ambil Data"}
          </button>
          {extractMsg && <WarnCard>{extractMsg}</WarnCard>}
        </section>

        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <div className="h-px flex-1 bg-zinc-200" /> atau <div className="h-px flex-1 bg-zinc-200" />
        </div>

        {!showManual && !productId && (
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="flex min-h-[48px] w-full items-center justify-center font-semibold text-amber-600"
          >
            Isi manual aja →
          </button>
        )}

        {(showManual || productId) && (
          <section className="space-y-3 rounded-3xl border-2 border-zinc-100 bg-zinc-50 p-4">
            <h3 className="font-bold">{productId ? "Konfirmasi produk" : "Isi manual (3 kolom aja)"}</h3>
            <input
              type="text"
              placeholder="Nama produk (mis. Serum Glow Bright)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Harga (mis. 85000)"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
            />
            {price && <p className="text-sm text-zinc-500">= {rupiah(parseInt(price || "0", 10) || 0)}</p>}
            <input
              type="text"
              placeholder="Deskripsi visual produk (opsional, biar konsisten): mis. botol dropper amber 30ml, label putih tulisan hitam"
              value={visualDesc}
              onChange={(e) => setVisualDesc(e.target.value)}
              maxLength={200}
              className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-sm outline-none focus:border-amber-500"
            />
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setKategoriDitentukan(true); setKategoriDitebak(false); }}
              className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {/* Tebakan yang tidak diberitahukan itu diam-diam mengubah hasil
                orang. Katakan bahwa kita menebak — dan bahwa boleh diganti. */}
            {kategoriDitebak && (
              <p className="-mt-2 text-sm text-zinc-500">
                Kategorinya kami tebak dari nama produk — ganti kalau meleset.
              </p>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold text-zinc-700">
                Foto produk ({extractedPreviews.length + photos.length}/{MAX_PHOTOS})
                {extractedPreviews.length > 0 && (
                  <span className="ml-1 font-normal text-emerald-600">— dari link ✓</span>
                )}
              </p>
              <div className="mb-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-xs leading-5 text-amber-900">
                <p className="font-bold">📸 Foto yang bagus = video yang bagus</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li><b>Foto pertama paling penting</b> — jadi patokan utama AI menggambar produkmu di video.</li>
                  <li>Produk terlihat jelas & memenuhi frame, label menghadap kamera.</li>
                  <li>Latar bersih & cahaya terang (dekat jendela sudah cukup).</li>
                  <li>Hindari kolase, teks/watermark tempelan, atau foto buram.</li>
                  <li>Foto 2–{MAX_PHOTOS} (opsional): sudut lain / detail tekstur / produk dipakai.</li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                {extractedPreviews.map((src, i) => (
                  <div key={`x${i}`} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`foto dari link ${i + 1}`} className="h-20 w-20 rounded-xl object-cover ring-2 ring-emerald-400" loading="lazy" decoding="async" />
                    <button
                      type="button"
                      aria-label={`Buang foto dari link ${i + 1}`}
                      onClick={() => removeExtractedPhoto(i)}
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800/90 text-xs font-bold text-white shadow"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {previews.map((src, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`foto ${i + 1}`} className="h-20 w-20 rounded-xl object-cover" decoding="async" />
                    <button
                      type="button"
                      aria-label={`Buang foto ${i + 1}`}
                      onClick={() => removeLocalPhoto(i)}
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800/90 text-xs font-bold text-white shadow"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {extractedPreviews.length + photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 text-2xl text-zinc-400"
                  >
                    ＋
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => pickPhotos(e.target.files)}
              />
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white">
              <button
                type="button"
                onClick={() => setPromoOpen((o) => !o)}
                className="flex min-h-[48px] w-full items-center justify-between px-4 text-left"
              >
                <span className="text-sm font-bold text-zinc-800">🔥 Promo & Urgency <span className="font-normal text-zinc-400">(opsional)</span></span>
                <span className="text-zinc-400">{promoOpen ? "−" : "+"}</span>
              </button>
              {promoOpen && (
                <div className="space-y-2 border-t border-zinc-100 p-4">
                  <p className="text-xs leading-5 text-zinc-500">
                    Isi kalau produkmu lagi promo beneran — masuk ke skrip, caption, dan badge harga coret di
                    video. Kosongkan yang tidak ada; urgency palsu malah bikin nggak dipercaya.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Harga normal sebelum diskon (mis. 120000)"
                    value={promoBefore}
                    onChange={(e) => setPromoBefore(e.target.value.replace(/[^\d]/g, ""))}
                    className="min-h-[48px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-sm outline-none focus:border-amber-500"
                  />
                  {promoBefore && price && parseInt(promoBefore, 10) > parseInt(price, 10) && (
                    <p className="text-sm font-semibold text-emerald-700">
                      = diskon {Math.round((1 - parseInt(price, 10) / parseInt(promoBefore, 10)) * 100)}% ({rupiah(parseInt(promoBefore, 10))} → {rupiah(parseInt(price, 10))})
                    </p>
                  )}
                  <label className="block text-xs font-semibold text-zinc-600">
                    Promo berakhir kapan? <span className="font-normal text-zinc-400">(lewat tanggal ini, bagian promo otomatis hilang)</span>
                    <input
                      type="date"
                      value={promoEnds}
                      onChange={(e) => setPromoEnds(e.target.value)}
                      className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-sm outline-none focus:border-amber-500"
                    />
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Stok tersisa (opsional, mis. 12)"
                    value={promoStock}
                    onChange={(e) => setPromoStock(e.target.value.replace(/[^\d]/g, ""))}
                    className="min-h-[48px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-sm outline-none focus:border-amber-500"
                  />
                </div>
              )}
            </div>
          </section>
        )}

        <ErrorText message={error} />
        <PrimaryButton onClick={submitProduct} disabled={loading || !name.trim() || !price || extractedPreviews.length + photos.length < 1}>
          {loading ? "Menyimpan..." : "Lanjut"}
        </PrimaryButton>
      </div>
    </main>
  );
}
