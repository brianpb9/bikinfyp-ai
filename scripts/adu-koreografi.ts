/**
 * ADU KOREOGRAFI — bukti piksel, diotorisasi Brian 20 Agu 2026.
 *
 * Board review 20 Agu menutup penilaian mutu visual dengan NOT SCORABLE:
 * tidak ada render sejak 13 Agu, jadi klaim "koreografi penulis sekarang
 * sampai ke kamera" hanya hidup di test unit. Test unit membuktikan STRING
 * ada di prompt; ia tidak membuktikan model video mematuhinya.
 *
 * Rancangan adu yang jujur — SATU naskah, dua lengan:
 *   A (tersambung)  segmen utuh: action/framing/angle/camera/expression penulis.
 *   B (kontrol)     segmen yang field sinematografinya DILUCUTI, sehingga
 *                   shot-planner jatuh ke tabel beat tetap — persis perilaku
 *                   sebelum commit 00ee62e.
 *
 * Karena naskah, produk, foto, format, dan tier identik, satu-satunya variabel
 * adalah koreografi. Kalau dua klipnya tetap terlihat sama, patch itu kosmetik
 * dan harus dikatakan begitu.
 *
 * Satu shot per lengan (~5 dtk, ~Rp8rb) — pertanyaannya "apakah kamera menuruti
 * penulis" terjawab dari shot pembuka, dan dua video penuh berharga 3x.
 *
 * Jalankan:
 *   RENDER_CONFIRM=YA npx tsx scripts/adu-koreografi.ts
 */
import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { periksaPemicu, ringkasPemicu } from "../lib/media/pemicu-filter";
import { periksaPromptAkhir, ringkasTemuanPrompt } from "../lib/media/gerbang-prompt";
import { assertVisualSpec } from "../lib/providers/types";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";

const FOTO_DIR = path.resolve(process.cwd(), "..", "test_output");
const OUT = path.resolve(process.cwd(), "..", "test_output", "adu_koreografi");

const PRODUK: ProductInput = {
  id: "p-glow", name: "Serum Glow Bright", price_idr: 85000,
  category: "beauty", sourceUrl: null, promoPriceBeforeIdr: 120000,
} as ProductInput;
const FOTO = path.join(FOTO_DIR, "canary-glow.jpg");
const FORMAT = "hands_only" as const;
const PERSONA = "hijaber";
const DURASI = 15 as const;

/** Field sinematografi yang dulu dibuang perakit prompt. */
const FIELD_SINEMA = ["framing", "angle", "camera", "action", "start_state", "expression"] as const;

function lucuti(segments: unknown[]): unknown[] {
  return segments.map((s) => {
    const c = { ...(s as Record<string, unknown>) };
    for (const f of FIELD_SINEMA) delete c[f];
    return c;
  });
}

function rakit(segments: unknown[], id: string) {
  const spec = planShots({
    jobId: id, durationSec: DURASI, segments,
    category: getCreatorCategory(PERSONA)!, productName: PRODUK.name,
    productCategory: PRODUK.category, imageRefPath: FOTO,
    qualityTier: "super_hq", format: FORMAT, hookLevel: "berani",
  } as never) as { shots: { index: number; prompt: string }[]; negativePrompt: string };
  assertVisualSpec(spec as never);
  return spec;
}

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Render BERBAYAR. Jalankan dengan RENDER_CONFIRM=YA.");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // ---- 1. Satu naskah, jalur produksi penuh (LLM, bukan template) ----
  console.log("NASKAH (jalur produksi: Idea Stage -> FYP Gate -> penulis -> validator)");
  const [skrip] = await generateScripts({
    product: PRODUK, register: "bestie", qualityTier: "super_hq",
    durationSec: DURASI, count: 1, hookLevel: "berani",
    contentType: "affiliate", format: FORMAT,
  } as never);
  console.log(`  sumber: ${skrip.script_source}${skrip.standarGaris ? ` · ${skrip.standarGaris}` : ""}`);
  if (skrip.script_source !== "llm") {
    console.error(`  BATAL — naskah bukan dari penulis LLM (${skrip.script_source}). Adu ini menguji koreografi penulis; naskah template tidak punya koreografi untuk diuji.`);
    process.exit(1);
  }
  for (const s of skrip.segments) {
    const g = s as unknown as Record<string, string>;
    console.log(`    [${s.role}] "${s.text}"`);
    console.log(`        aksi   : ${g.action ?? "(kosong)"}`);
    console.log(`        kamera : ${[g.framing, g.angle, g.camera].filter(Boolean).join(", ") || "(kosong)"}`);
  }
  fs.writeFileSync(path.join(OUT, "naskah.json"), JSON.stringify(skrip, null, 2));

  // ---- 2. Dua lengan ----
  const lengan = [
    { id: "A-tersambung", segments: skrip.segments as unknown[] },
    { id: "B-kontrol", segments: lucuti(skrip.segments as unknown[]) },
  ];

  const hasil: Record<string, unknown>[] = [];
  for (const L of lengan) {
    console.log(`\n=== ${L.id} ===`);
    const spec = rakit(L.segments, `adu-${L.id}`);
    const shot = spec.shots[0];
    fs.writeFileSync(path.join(OUT, `prompt-${L.id}.txt`), shot.prompt);
    console.log(shot.prompt.slice(0, 400).replace(/\n/g, "\n  "));

    const temuan = periksaPromptAkhir({
      shots: [shot], negativePrompt: spec.negativePrompt,
      namaProduk: PRODUK.name, format: FORMAT, withAudio: true,
    });
    const keras = temuan.filter((t) => t.keras);
    console.log(`  gerbang prompt akhir: ${keras.length ? "TOLAK — " + ringkasTemuanPrompt(keras) : "LOLOS"}`);
    if (keras.length) { hasil.push({ id: L.id, status: "batal-gerbang" }); continue; }

    const negasi = periksaPemicu(shot.prompt, { namaProduk: PRODUK.name }).filter((x) => x.jenis === "negasi-orang");
    if (negasi.length) { console.log(`  pemicu: ${ringkasPemicu(negasi)}`); hasil.push({ id: L.id, status: "batal-pemicu" }); continue; }

    const dir = path.join(OUT, L.id);
    fs.mkdirSync(dir, { recursive: true });
    const mulai = Date.now();
    try {
      const satuShot = { ...(spec as Record<string, unknown>), shots: [{ ...shot, index: 0 }] };
      const aset = await byteplusVideo.generate(satuShot as never, dir);
      const biaya = aset.reduce((n: number, a: { costIdr: number }) => n + a.costIdr, 0);
      console.log(`  render OK ${Math.round((Date.now() - mulai) / 1000)} dtk · Rp${biaya.toLocaleString("id-ID")} · ${aset[0].filePath}`);
      hasil.push({ id: L.id, status: "ok", berkas: aset[0].filePath, biaya, prompt: shot.prompt });
    } catch (err) {
      console.error(`  GAGAL: ${err instanceof Error ? err.message : String(err)}`);
      hasil.push({ id: L.id, status: "gagal-render", sebab: String(err) });
    }
  }

  fs.writeFileSync(path.join(OUT, "hasil.json"), JSON.stringify({ skrip, hasil }, null, 2));
  console.log(`\nTotal biaya: Rp${hasil.reduce((n, h) => n + Number(h.biaya ?? 0), 0).toLocaleString("id-ID")}`);
  console.log(`Berkas: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
