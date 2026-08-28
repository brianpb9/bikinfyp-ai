/**
 * VIDEO PENUH DENGAN PACKSHOT PENUTUP ASLI — bukti untuk Brian, 20 Agu 2026.
 *
 * Empat render sebelumnya semuanya SATU shot: cukup untuk menjawab "apakah
 * kamera menuruti penulis" dan "apakah label masih mengarang huruf", tapi tidak
 * cukup untuk menilai videonya sebagai video. Yang ini merender ketiga shot,
 * menyusunnya dengan VO, lalu menutupnya dengan packshot foto asli.
 *
 * Memakai MODUL PRODUKSI yang sama persis — planShots, gerbang prompt akhir,
 * byteplus, Gemini TTS, compositeVideo, appendPackshot, runQc. Yang TIDAK
 * dilalui hanyalah mesin status job di Postgres (QUEUED -> ... -> READY);
 * dikatakan di sini supaya tidak ada yang membacanya sebagai "job produksi".
 *
 * Jalankan:
 *   RENDER_CONFIRM=YA npx tsx scripts/video-penuh-packshot.ts
 */
import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { periksaPromptAkhir, ringkasTemuanPrompt } from "../lib/media/gerbang-prompt";
import { assertVisualSpec } from "../lib/providers/types";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { synthesizeGeminiVoiceover } from "../lib/media/gemini-tts";
import { hargaTerbilang } from "../lib/script-engine/terbilang";
import { stripDeliveryTags } from "../lib/script-engine/delivery-tags";
import { compositeVideo } from "../lib/media/compositor";
import { appendPackshot } from "../lib/media/packshot-asli";
import { runQc } from "../lib/media/qc";

const FOTO_DIR = path.resolve(process.cwd(), "..", "test_output");
const OUT = path.resolve(process.cwd(), "..", "test_output", "video_penuh_packshot");

const PRODUK = {
  id: "p-glow", name: "Serum Glow Bright", price_idr: 85000,
  category: "beauty", sourceUrl: null, promoPriceBeforeIdr: 120000,
} as ProductInput;
const FOTO = path.join(FOTO_DIR, "canary-glow.jpg");
const FORMAT = "hands_only" as const;
const PERSONA = "hijaber";
const DURASI = 15;

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Render BERBAYAR (3 klip + TTS). Jalankan dengan RENDER_CONFIRM=YA.");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const kategori = getCreatorCategory(PERSONA)!;

  // --- 1. Naskah lewat jalur penuh. S-10 sekarang aktif: hands_only wajib
  //        membuka dengan produk sudah di frame.
  console.log("NASKAH");
  const [skrip] = await generateScripts({
    product: PRODUK, register: "bestie", qualityTier: "super_hq",
    durationSec: DURASI, count: 1, hookLevel: "berani",
    contentType: "affiliate", format: FORMAT,
  } as never);
  if (skrip.script_source !== "llm") {
    console.error(`BATAL — naskah bukan dari penulis LLM (${skrip.script_source}).`);
    process.exit(1);
  }
  for (const s of skrip.segments) {
    const g = s as unknown as Record<string, string>;
    console.log(`  [${s.role}] product_state=${g.product_state ?? "-"} "${s.text}"`);
    console.log(`      aksi: ${(g.action ?? "(kosong)").slice(0, 140)}`);
  }
  fs.writeFileSync(path.join(OUT, "naskah.json"), JSON.stringify(skrip, null, 2));

  // --- 2. Rencana shot + gerbang prompt akhir (sama seperti worker).
  const spec = planShots({
    jobId: "video-penuh", durationSec: DURASI, segments: skrip.segments,
    category: kategori, productName: PRODUK.name, productCategory: PRODUK.category,
    imageRefPath: FOTO, qualityTier: "super_hq", format: FORMAT, hookLevel: "berani",
  } as never) as { shots: { index: number; prompt: string }[]; negativePrompt: string; maxPeople?: number };
  assertVisualSpec(spec as never);
  const temuan = periksaPromptAkhir({
    shots: spec.shots, negativePrompt: spec.negativePrompt,
    namaProduk: PRODUK.name, format: FORMAT, withAudio: true,
  }).filter((t) => t.keras);
  if (temuan.length) {
    console.error(`GERBANG MENOLAK: ${ringkasTemuanPrompt(temuan)}`);
    process.exit(1);
  }
  console.log(`gerbang prompt akhir: LOLOS (${spec.shots.length} shot)`);

  // --- 3. Render semua shot.
  const workDir = path.join(OUT, "kerja");
  fs.mkdirSync(workDir, { recursive: true });
  const clipPaths: string[] = [];
  let biaya = 0;
  for (const shot of spec.shots) {
    const dir = path.join(workDir, `shot${shot.index}`);
    fs.mkdirSync(dir, { recursive: true });
    const satu = { ...(spec as Record<string, unknown>), shots: [{ ...shot, index: 0 }] };
    const aset = await byteplusVideo.generate(satu as never, dir);
    clipPaths.push(aset[0].filePath);
    biaya += aset.reduce((n: number, a: { costIdr: number }) => n + a.costIdr, 0);
    console.log(`  shot ${shot.index + 1}/${spec.shots.length} OK`);
  }

  // --- 4. VO Gemini (suara resmi semua video sejak 7 Agu).
  const voText = hargaTerbilang(
    skrip.segments.map((s) => stripDeliveryTags((s as { tts_text?: string }).tts_text ?? s.text)).join(" ... ")
  );
  const tts = await synthesizeGeminiVoiceover(voText, kategori.voiceName, kategori.voiceStyle, path.join(workDir, "vo.wav"));
  biaya += tts.costIdr;
  console.log(`  VO Gemini OK`);

  // --- 5. Susun, lalu tutup dengan packshot foto asli.
  const demo = skrip.segments.find((s) => s.role === "demo")!;
  const cta = skrip.segments.find((s) => s.role === "cta")!;
  const comp = await compositeVideo({
    jobId: "video-penuh", workDir, clipPaths, mode: "embedded",
    voiceoverWavPath: tts.filePath, durationSec: DURASI,
    musicPath: path.join(process.cwd(), "assets", "music", "bg-bed.m4a"),
    priceText: `Cuma ${PRODUK.price_idr}`, ctaText: "Klik Keranjang Kuning »",
    demoRange: [demo.start, demo.end], ctaRange: [cta.start, cta.end],
    providerVideo: "byteplus",
  } as never);
  const pack = await appendPackshot({
    videoPath: comp.outPath, workDir, fotoPath: FOTO,
    musicPath: path.join(process.cwd(), "assets", "music", "bg-bed.m4a"),
  });
  console.log(`  packshot penutup: ${pack.ditambahkan ? `ditambahkan ${pack.ekorSec} dtk` : "GAGAL"}`);

  const akhir = path.join(OUT, "video-penuh.mp4");
  fs.copyFileSync(pack.path, akhir);

  // --- 6. QC atas video jadi, dengan ekor yang disengaja dilaporkan.
  const qc = await runQc({
    filePath: akhir, targetDurationSec: DURASI,
    ekorDisengajaSec: pack.ekorSec, packshotSidik: pack.sidik,
    maxPeople: spec.maxPeople,
    finalTexts: skrip.segments.map((s) => s.text),
    hookFamily: skrip.hook_family, register: skrip.register,
    productName: PRODUK.name, priceIdr: PRODUK.price_idr,
    renderParams: comp.renderParams, shotPaths: clipPaths,
    refImagePath: FOTO, format: FORMAT, productCategory: PRODUK.category,
    overlayTextExpectations: [],
  } as never);
  console.log("\nQC:");
  for (const c of (qc as { checks: { code: string; status: string; detail?: string }[] }).checks) {
    console.log(`  ${c.code} ${c.status.toUpperCase()} — ${(c.detail ?? "").slice(0, 150)}`);
  }

  fs.writeFileSync(path.join(OUT, "hasil.json"), JSON.stringify({ skrip, qc, biaya, akhir }, null, 2));
  console.log(`\nBiaya render: Rp${biaya.toLocaleString("id-ID")}`);
  console.log(`Video: ${akhir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
