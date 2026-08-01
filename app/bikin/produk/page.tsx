"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, WarnCard } from "../../_components/ui";
import { CATEGORY_OPTIONS, loadFlow, saveFlow, rupiah } from "../../_components/flow";

// S2 — INPUT PRODUK (Langkah 1/5)
export default function ProdukPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("beauty");
  const [visualDesc, setVisualDesc] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [extractedPreviews, setExtractedPreviews] = useState<string[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
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
    }
  }, []);

  function pickPhotos(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 5 - photos.length);
    const next = [...photos, ...list].slice(0, 5);
    previewUrls.current.forEach((src) => URL.revokeObjectURL(src));
    previewUrls.current = next.map((file) => URL.createObjectURL(file));
    setPhotos(next);
    setPreviews(previewUrls.current);
  }

  async function extract() {
    setLoading(true);
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
        image_urls?: string[];
        warning?: string;
      }>("/api/products/extract", {
        json: { url: url.trim() },
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
        setExtractedPreviews(res.image_urls ?? []);
        setShowManual(true);
        if (res.warning) setExtractMsg(res.warning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membaca link.");
      setShowManual(true);
    } finally {
      setLoading(false);
    }
  }

  async function submitProduct() {
    if (submitLock.current) return;
    setError(null);
    if (!name.trim()) return setError("Nama produknya belum diisi.");
    const priceIdr = parseInt(price.replace(/[^\d]/g, ""), 10);
    if (!priceIdr || priceIdr <= 0) return setError("Harganya wajib diisi — harga adalah bahan wajib hook videonya.");
    if (!productId && photos.length < 1) return setError("Upload fotonya dulu ya — minimal 1, maksimal 5 foto.");
    // Produk dari ekstraksi tanpa harga: sorot wajib (BR-01.3)
    if (productId && (!price || priceIdr <= 0)) return setError("Harga dari link tidak ketemu — isi manual ya, wajib.");

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
        // Produk dari ekstraksi: simpan edit konfirmasi user (nama/harga/kategori/deskripsi)
        await apiFetch(`/api/products/${id}`, {
          method: "PATCH",
          json: { name: name.trim(), price_idr: priceIdr, category, product_visual_desc: visualDesc.trim() || null },
        });
      }
      saveFlow({
        product: { productId: id, name: name.trim(), priceIdr, category, images: [] },
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
    <main className="pb-8">
      <FlowHeader title="Bikin Video" step={1} />
      <div className="space-y-5 px-4">
        <section className="space-y-2">
          <h2 className="text-lg font-bold">Tempel link produkmu</h2>
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
            disabled={loading || url.trim().length < 8}
            className="min-h-[48px] w-full rounded-2xl border-2 border-zinc-200 font-semibold text-zinc-700 active:bg-zinc-50 disabled:text-zinc-400"
          >
            {loading ? "Sebentar..." : "Ambil Data"}
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
              onChange={(e) => setCategory(e.target.value)}
              className="min-h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 outline-none focus:border-amber-500"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>

            <div>
              <p className="mb-2 text-sm font-semibold text-zinc-700">
                Foto produk ({extractedPreviews.length + photos.length}/5)
                {extractedPreviews.length > 0 && (
                  <span className="ml-1 font-normal text-emerald-600">— dari link ✓</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {extractedPreviews.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`x${i}`} src={src} alt={`foto dari link ${i + 1}`} className="h-20 w-20 rounded-xl object-cover ring-2 ring-emerald-400" loading="lazy" decoding="async" />
                ))}
                {previews.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`foto ${i + 1}`} className="h-20 w-20 rounded-xl object-cover" decoding="async" />
                ))}
                {photos.length < 5 && !productId && (
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
          </section>
        )}

        <ErrorText message={error} />
        <PrimaryButton onClick={submitProduct} disabled={loading || !name.trim() || !price || (!productId && photos.length < 1)}>
          {loading ? "Menyimpan..." : "Lanjut"}
        </PrimaryButton>
      </div>
    </main>
  );
}
