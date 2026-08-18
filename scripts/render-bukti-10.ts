/**
 * BUKTI RENDER 10/10 — tiga klip, satu per gerbang yang berubah 18 Agu 2026.
 *
 * Reviewer menandai satu baris NOT SCORABLE: "tidak ada video nyata pasca-51c
 * yang diperiksa". Baris itu tidak bisa naik tanpa uang, jadi Brian yang
 * mengotorisasi jumlahnya. TIGA klip, bukan sepuluh: yang perlu dijawab bukan
 * "apakah katalognya bagus" melainkan "apakah perubahan hari ini benar di
 * video sungguhan".
 *
 *   hands_only  frasa larangan wajah yang ditulis positif + label produk
 *   tvc         packshot product-only + framing dada ke atas
 *   ads         genre Ads (CTA "detailnya ada di bawah") + framing anti-produksi
 *
 * Tiap klip melewati rantai yang sama dengan produksi: generateScripts ->
 * planShots -> periksaPemicu (gerbang negasi) -> assertVisualSpec -> provider.
 * Kalau salah satu gerbang menyala, klipnya TIDAK dikirim dan itu jawabannya.
 *
 * Sesudah render: QC dijalankan atas klip nyata (QC-02/03/04/05/07/08/10/12
 * sejauh yang berlaku untuk satu klip), dan hasilnya ditulis apa adanya.
 *
 * Jalankan:
 *   RENDER_CONFIRM=YA npx tsx scripts/render-bukti-10.ts
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

const FOTO = path.resolve(process.cwd(), "..", "test_output", process.env.FOTO_PRODUK ?? "produk-polos.jpg");
const OUT = path.resolve(process.cwd(), "..", "test_output", process.env.OUT_DIR ?? "bukti_10");

interface Tugas {
  id: string;
  label: string;
  format: "hands_only" | "tvc" | "ads";
  contentType: "affiliate" | "ads";
  /** Shot yang dirender — dipilih karena di situlah aturan barunya terlihat. */
  shot: number;
  buktikan: string;
}

const TUGAS: Tugas[] = [
  { id: "hands", label: "hands_only · batas tangan positif", format: "hands_only", contentType: "affiliate", shot: 0,
    buktikan: "frasa larangan wajah ditulis sebagai batas positif; label produk tetap terbaca" },
  { id: "tvc", label: "TVC · packshot product-only", format: "tvc", contentType: "affiliate", shot: 2,
    buktikan: "shot penutup tanpa orang, ditulis positif (bukan 'not a single person')" },
  { id: "ads", label: "Ads · genre sendiri", format: "ads", contentType: "ads", shot: 0,
    buktikan: "naskah Ads lolos gerbang tanpa CTA keranjang" },
];

const HANYA = process.env.HANYA?.split(",").map((x) => x.trim()).filter(Boolean);

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error(`Ditolak: ${(HANYA ? TUGAS.filter((x) => HANYA.includes(x.id)) : TUGAS).length} klip = uang sungguhan. Ulangi dengan RENDER_CONFIRM=YA.`);
    process.exit(1);
  }
  if (!fs.existsSync(FOTO)) throw new Error(`Foto produk tidak ada: ${FOTO}`);
  fs.mkdirSync(OUT, { recursive: true });

  const kategori = getCreatorCategory("hijaber")!;
  const produk: ProductInput = {
    id: "bukti10", name: "Mosseru Bright Shower Gel", price_idr: 189000,
    category: "beauty", sourceUrl: null,
  };

  const laporan: Record<string, unknown>[] = [];
  let total = 0;

  for (const t of (HANYA ? TUGAS.filter((x) => HANYA.includes(x.id)) : TUGAS)) {
    console.log(`\n=== ${t.label} ===`);
    console.log(`    membuktikan: ${t.buktikan}`);

    // 1. NASKAH lewat mesin yang sama dengan produksi (genre ikut).
    const [skrip] = await generateScripts({
      product: produk, register: "bunda", qualityTier: "high_quality",
      durationSec: 15, count: 1, hookLevel: "berani",
      contentType: t.contentType, format: t.format,
    });
    console.log(`    naskah: ${skrip.script_source}${skrip.standarGaris ? ` · ${skrip.standarGaris}` : ""}`);
    for (const s of skrip.segments) console.log(`      [${s.role}] ${s.text}`);
    if (skrip.script_source === "degraded") {
      console.error("    DIHENTIKAN: naskahnya sendiri tidak lolos gate. Tidak ada yang dirender.");
      laporan.push({ id: t.id, status: "batal", sebab: "naskah degraded", errors: skrip.validation.errors });
      continue;
    }

    // 2. RENCANA SHOT + gerbang yang sama persis dengan worker.
    const spec = planShots({
      jobId: t.id, durationSec: 15, segments: skrip.segments, category: kategori,
      productName: produk.name, productCategory: "beauty", imageRefPath: FOTO,
      qualityTier: "high_quality", format: t.format, hookLevel: "berani",
    });
    const pemicu = spec.shots.flatMap((sh) => periksaPemicu(sh.prompt, { namaProduk: produk.name }))
      .filter((x) => x.jenis === "negasi-orang");
    if (pemicu.length) {
      console.error(`    DIHENTIKAN gerbang prompt: ${ringkasPemicu(pemicu)}`);
      laporan.push({ id: t.id, status: "batal", sebab: "gerbang prompt", pemicu: pemicu.map((p) => p.cocok) });
      continue;
    }
    assertVisualSpec(spec);

    const idx = Math.min(t.shot, spec.shots.length - 1);
    console.log(`    shot ${idx}: ${spec.shots[idx].prompt.slice(0, 130)}...`);

    // 3. RENDER satu klip.
    const dir = path.join(OUT, t.id);
    fs.mkdirSync(dir, { recursive: true });
    const mulai = Date.now();
    let berkas: string | null = null;
    let biaya = 0;
    try {
      const aset = await byteplusVideo.generate({ ...spec, shots: [{ ...spec.shots[idx], index: 0 }] }, dir);
      berkas = aset[0]?.filePath ?? null;
      biaya = aset.reduce((n, a) => n + a.costIdr, 0);
      total += biaya;
      console.log(`    OK ${berkas} (${Math.round((Date.now() - mulai) / 1000)} dtk, Rp${biaya.toLocaleString("id-ID")})`);
    } catch (err) {
      console.error(`    GAGAL render: ${err instanceof Error ? err.message : String(err)}`);
      laporan.push({ id: t.id, status: "gagal-render", sebab: String(err) });
      continue;
    }

    // 4. QC atas klip NYATA.
    let qc: Awaited<ReturnType<typeof runQc>> | null = null;
    try {
      qc = await runQc({
        filePath: berkas!, targetDurationSec: 5,
        finalTexts: skrip.segments.map((s) => s.text),
        hookFamily: skrip.hook_family, register: "bunda",
        productName: produk.name, priceIdr: produk.price_idr,
        renderParams: { watermark: false }, format: t.format,
        productCategory: "beauty", refImagePath: FOTO,
      });
      for (const c of qc.checks) console.log(`    ${c.code} ${c.status.toUpperCase()} — ${c.detail ?? ""}`.slice(0, 200));
    } catch (err) {
      console.error(`    QC gagal jalan: ${err instanceof Error ? err.message : String(err)}`);
    }

    laporan.push({
      id: t.id, status: "ok", berkas, biaya,
      script_source: skrip.script_source, standar: skrip.standarGaris ?? null,
      segments: skrip.segments.map((s) => ({ role: s.role, text: s.text })),
      qc: qc?.checks.map((c) => ({ code: c.code, status: c.status, detail: c.detail })) ?? null,
    });
  }

  console.log(`\nTOTAL: Rp${total.toLocaleString("id-ID")} untuk ${laporan.filter((r) => r.status === "ok").length} klip`);
  fs.writeFileSync(path.join(OUT, "laporan.json"), JSON.stringify({ total, laporan }, null, 2));
  console.log(`Laporan: ${path.join(OUT, "laporan.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
