/**
 * CANARY 12 KLIP — Gate 3 audit kedalaman, diotorisasi Brian 19 Agu 2026.
 *
 * Enam produk dengan sifat yang berbeda-beda, dua klip per produk, melewati
 * rantai produksi PENUH: generateScripts (genre + snapshot) -> planShots ->
 * gerbang pemicu -> assertVisualSpec -> BytePlus -> QC lengkap atas klip nyata.
 *
 * Sifat yang diuji per produk (daftar auditor):
 *   somethinc  SKU panjang + foto = BANNER MARKETING bertek banyak (nyata)
 *   glow       harga + PROMO harga coret (foto nyata)
 *   mosseru    nama produk memuat kata pemicu penyaring ("Shower") (foto nyata)
 *   kopitang   merek pendek + kemasan penuh tulisan (foto sintetis)
 *   arva       kemasan REFLEKTIF chrome + label sangat kecil (foto sintetis)
 *   sabun      produk POLOS tanpa satu pun teks merek (foto sintetis)
 *
 * Tiga foto sintetis DIBUAT Gemini dan dicatat sebagai sintetis di laporan:
 * yang diuji pipeline render+QC-nya, bukan asal fotonya.
 *
 * SATU shot per klip (~5 dtk), bukan video penuh: pertanyaannya per kombinasi
 * (label terbaca? genre benar? gerbang diam di prompt sah?) terjawab dari satu
 * shot, dan 12 video penuh berharga ~3x otorisasi.
 *
 * Jalankan:
 *   RENDER_CONFIRM=YA npx tsx scripts/canary-12.ts
 *   HANYA=somethinc-a,arva-a ... (subset)
 */
import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { periksaPemicu, ringkasPemicu } from "../lib/media/pemicu-filter";
import { assertVisualSpec } from "../lib/providers/types";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { runQc } from "../lib/media/qc";

const FOTO_DIR = path.resolve(process.cwd(), "..", "test_output");
const OUT = path.resolve(process.cwd(), "..", "test_output", "canary_12");

interface Klip {
  id: string;
  produk: ProductInput & { fotoSintetis?: boolean };
  foto: string;
  format: "hands_only" | "talking_head" | "tvc" | "ads";
  contentType: "affiliate" | "ads";
  durationSec: 15 | 30;
  persona: string;
  /** Indeks shot yang dirender — dipilih di mana aturannya paling terlihat. */
  shot: number;
  sifat: string;
}

const P = {
  somethinc: { id: "p-somethinc", name: "SOMETHINC 5% Niacinamide Barrier Serum", price_idr: 115000, category: "beauty", sourceUrl: null } as ProductInput,
  glow: { id: "p-glow", name: "Serum Glow Bright", price_idr: 85000, category: "beauty", sourceUrl: null, promoPriceBeforeIdr: 120000 } as ProductInput,
  mosseru: { id: "p-mosseru", name: "Mosseru Bright Shower Gel", price_idr: 189000, category: "beauty", sourceUrl: null } as ProductInput,
  kopitang: { id: "p-kopitang", name: "KOPI TANG Kopi Susu Gula Aren", price_idr: 45000, category: "food", sourceUrl: null } as ProductInput,
  arva: { id: "p-arva", name: "ARVA Tumbler Chrome", price_idr: 150000, category: "home", sourceUrl: null } as ProductInput,
  sabun: { id: "p-sabun", name: "Sabun Susu Kambing", price_idr: 25000, category: "beauty", sourceUrl: null } as ProductInput,
};

const KLIP: Klip[] = [
  { id: "somethinc-a", produk: P.somethinc, foto: "canary-somethinc.jpg", format: "hands_only", contentType: "affiliate", durationSec: 15, persona: "hijaber", shot: 1, sifat: "SKU panjang, foto banner marketing" },
  { id: "somethinc-b", produk: P.somethinc, foto: "canary-somethinc.jpg", format: "talking_head", contentType: "affiliate", durationSec: 15, persona: "genz", shot: 0, sifat: "SKU panjang, wajah AI" },
  { id: "glow-a", produk: P.glow, foto: "canary-glow.jpg", format: "hands_only", contentType: "affiliate", durationSec: 15, persona: "ibu", shot: 1, sifat: "promo harga coret 120rb->85rb" },
  { id: "glow-b", produk: P.glow, foto: "canary-glow.jpg", format: "hands_only", contentType: "affiliate", durationSec: 30, persona: "hijaber", shot: 2, sifat: "durasi 30 dtk" },
  { id: "mosseru-a", produk: P.mosseru, foto: "produk-polos.jpg", format: "talking_head", contentType: "affiliate", durationSec: 15, persona: "hijaber", shot: 0, sifat: "nama memuat kata pemicu (Shower)" },
  { id: "mosseru-b", produk: P.mosseru, foto: "produk-polos.jpg", format: "ads", contentType: "ads", durationSec: 15, persona: "genz", shot: 0, sifat: "genre Ads, CTA tanpa keranjang" },
  { id: "kopitang-a", produk: P.kopitang, foto: "canary-kopitang.jpg", format: "hands_only", contentType: "affiliate", durationSec: 15, persona: "genz", shot: 1, sifat: "merek pendek, label penuh tulisan" },
  { id: "kopitang-b", produk: P.kopitang, foto: "canary-kopitang.jpg", format: "tvc", contentType: "affiliate", durationSec: 15, persona: "ibu", shot: 2, sifat: "TVC packshot product-only" },
  { id: "arva-a", produk: P.arva, foto: "canary-arva.jpg", format: "tvc", contentType: "affiliate", durationSec: 15, persona: "hijaber", shot: 0, sifat: "kemasan reflektif chrome" },
  { id: "arva-b", produk: P.arva, foto: "canary-arva.jpg", format: "hands_only", contentType: "affiliate", durationSec: 15, persona: "ibu", shot: 0, sifat: "label sangat kecil" },
  { id: "sabun-a", produk: P.sabun, foto: "canary-sabun.jpg", format: "talking_head", contentType: "affiliate", durationSec: 15, persona: "ibu", shot: 0, sifat: "produk polos tanpa teks — QC-10 wajib skip, bukan fail" },
  { id: "sabun-b", produk: P.sabun, foto: "canary-sabun.jpg", format: "hands_only", contentType: "affiliate", durationSec: 30, persona: "hijaber", shot: 1, sifat: "polos + 30 dtk" },
];

const HANYA = process.env.HANYA?.split(",").map((x) => x.trim()).filter(Boolean);
const DAFTAR = HANYA ? KLIP.filter((k) => HANYA.includes(k.id)) : KLIP;

async function satu(k: Klip): Promise<Record<string, unknown>> {
  console.log(`\n=== ${k.id} · ${k.sifat} ===`);
  const foto = path.join(FOTO_DIR, k.foto);

  const [skrip] = await generateScripts({
    product: k.produk, register: k.persona === "genz" ? "genz" : k.persona === "bunda" ? "bunda" : "bestie",
    qualityTier: "high_quality", durationSec: k.durationSec, count: 1, hookLevel: "berani",
    contentType: k.contentType, format: k.format,
  });
  console.log(`  naskah: ${skrip.script_source}${skrip.standarGaris ? ` · ${skrip.standarGaris}` : ""}`);
  for (const s of skrip.segments) console.log(`    [${s.role}] ${s.text}`);
  if (skrip.script_source === "degraded") {
    return { id: k.id, sifat: k.sifat, status: "batal-naskah", errors: skrip.validation.errors };
  }

  const spec = planShots({
    jobId: k.id, durationSec: k.durationSec, segments: skrip.segments,
    category: getCreatorCategory(k.persona)!, productName: k.produk.name,
    productCategory: k.produk.category, imageRefPath: foto,
    qualityTier: "high_quality", format: k.format, hookLevel: "berani",
  });
  const negasi = spec.shots.flatMap((sh) => periksaPemicu(sh.prompt, { namaProduk: k.produk.name }))
    .filter((x) => x.jenis === "negasi-orang");
  if (negasi.length) return { id: k.id, sifat: k.sifat, status: "batal-gerbang", pemicu: ringkasPemicu(negasi) };
  assertVisualSpec(spec);

  const idx = Math.min(k.shot, spec.shots.length - 1);
  const dir = path.join(OUT, k.id);
  fs.mkdirSync(dir, { recursive: true });
  const mulai = Date.now();
  let berkas: string; let biaya = 0;
  try {
    const aset = await byteplusVideo.generate({ ...spec, shots: [{ ...spec.shots[idx], index: 0 }] }, dir);
    berkas = aset[0].filePath;
    biaya = aset.reduce((n, a) => n + a.costIdr, 0);
    console.log(`  render OK ${Math.round((Date.now() - mulai) / 1000)} dtk, Rp${biaya.toLocaleString("id-ID")}`);
  } catch (err) {
    return { id: k.id, sifat: k.sifat, status: "gagal-render", sebab: String(err instanceof Error ? err.message : err) };
  }

  let qc: Awaited<ReturnType<typeof runQc>> | null = null;
  try {
    qc = await runQc({
      filePath: berkas, targetDurationSec: 5,
      finalTexts: skrip.segments.map((s) => s.text),
      hookFamily: skrip.hook_family, register: skrip.register,
      productName: k.produk.name, priceIdr: k.produk.price_idr,
      renderParams: { watermark: false }, format: k.format,
      productCategory: k.produk.category, refImagePath: foto,
    });
    for (const c of qc.checks) console.log(`  ${c.code} ${c.status.toUpperCase()} — ${(c.detail ?? "").slice(0, 110)}`);
  } catch (err) {
    console.error(`  QC gagal jalan: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    id: k.id, sifat: k.sifat, status: "ok", berkas, biaya,
    format: k.format, contentType: k.contentType, durationSec: k.durationSec,
    fotoSintetis: ["canary-kopitang.jpg", "canary-arva.jpg", "canary-sabun.jpg"].includes(k.foto),
    script_source: skrip.script_source, standar: skrip.standarGaris ?? null,
    segments: skrip.segments.map((s) => ({ role: s.role, text: s.text })),
    qc: qc?.checks.map((c) => ({ code: c.code, status: c.status, detail: c.detail })) ?? null,
    qcPassed: qc?.passed ?? null,
  };
}

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error(`Ditolak: ${DAFTAR.length} klip = uang sungguhan. Ulangi dengan RENDER_CONFIRM=YA.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const laporan: Record<string, unknown>[] = [];
  let total = 0;
  for (const k of DAFTAR) {
    try {
      const r = await satu(k);
      laporan.push(r);
      total += Number(r.biaya ?? 0);
    } catch (err) {
      // Satu klip gagal tidak menghentikan sisanya — biaya yang sudah keluar
      // untuk klip sebelumnya jadi sia-sia kalau begitu.
      console.error(`  GAGAL total ${k.id}: ${err instanceof Error ? err.message : String(err)}`);
      laporan.push({ id: k.id, sifat: k.sifat, status: "error", sebab: String(err) });
    }
    fs.writeFileSync(path.join(OUT, "laporan.json"), JSON.stringify({ total, laporan }, null, 2));
  }
  const ok = laporan.filter((r) => r.status === "ok").length;
  console.log(`\nSELESAI: ${ok}/${DAFTAR.length} klip, total Rp${total.toLocaleString("id-ID")}`);
  console.log(`Laporan: ${path.join(OUT, "laporan.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
