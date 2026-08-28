/**
 * UKUR COGS NYATA PER TIER — satu klip, satu angka.
 *
 * Alasannya ada di docs/evidence/cogs-canary-2026-08-20.md: seluruh biaya yang
 * kita ukur hari ini berasal dari tier super_hq (Rp11.655/klip terukur),
 * sementara tarif high_quality di kode masih berlabel ESTIMASI dari BRD.
 * Harga jual high_quality Rp12.000/video, jadi selisih antara estimasi dan
 * kenyataan menentukan apakah tier itu untung atau rugi — dan alarm margin
 * 19 Agu memakai angka lama.
 *
 * Naskahnya DIPAKAI ULANG dari adu putaran 1, bukan ditulis baru: yang diukur
 * biaya render, dan naskah baru cuma menambah variabel plus biaya LLM.
 *
 * Jalankan:
 *   RENDER_CONFIRM=YA npx tsx scripts/ukur-cogs-tier.ts high_quality
 */
import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { periksaPromptAkhir, ringkasTemuanPrompt } from "../lib/media/gerbang-prompt";
import { assertVisualSpec } from "../lib/providers/types";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { config } from "../lib/config";

const TIER = (process.argv[2] ?? "high_quality") as "high_quality" | "super_hq" | "silent_caption";
const FOTO = path.resolve(process.cwd(), "..", "test_output", "canary-glow.jpg");
const NASKAH = path.resolve(process.cwd(), "..", "test_output", "adu_koreografi", "naskah-putaran1.json");
const OUT = path.resolve(process.cwd(), "..", "test_output", `cogs_${TIER}`);

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Render BERBAYAR. Jalankan dengan RENDER_CONFIRM=YA.");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const skrip = JSON.parse(fs.readFileSync(NASKAH, "utf8")) as { segments: unknown[] };

  const tierCfg = (config.tiers as Record<string, { byteplusModel?: string }>)[TIER];
  console.log(`TIER ${TIER} · model ${tierCfg?.byteplusModel ?? "?"}`);

  const spec = planShots({
    jobId: `cogs-${TIER}`, durationSec: 15, segments: skrip.segments,
    category: getCreatorCategory("hijaber")!, productName: "Serum Glow Bright",
    productCategory: "beauty", imageRefPath: FOTO,
    qualityTier: TIER, format: "hands_only", hookLevel: "berani",
  } as never) as { shots: { index: number; prompt: string }[]; negativePrompt: string };
  assertVisualSpec(spec as never);

  const shot = spec.shots[0];
  const keras = periksaPromptAkhir({
    shots: [shot], negativePrompt: spec.negativePrompt,
    namaProduk: "Serum Glow Bright", format: "hands_only",
    withAudio: TIER !== "silent_caption",
  }).filter((t) => t.keras);
  if (keras.length) {
    console.error(`GERBANG MENOLAK: ${ringkasTemuanPrompt(keras)}`);
    process.exit(1);
  }

  const mulai = Date.now();
  const satu = { ...(spec as Record<string, unknown>), shots: [{ ...shot, index: 0 }] };
  const aset = await byteplusVideo.generate(satu as never, OUT);
  const biaya = aset.reduce((n: number, a: { costIdr: number }) => n + a.costIdr, 0);

  console.log(`\nHASIL UKUR`);
  console.log(`  tier          ${TIER}`);
  console.log(`  model         ${tierCfg?.byteplusModel}`);
  console.log(`  durasi render ${Math.round((Date.now() - mulai) / 1000)} dtk`);
  console.log(`  biaya 1 klip  Rp${biaya.toLocaleString("id-ID")}`);
  console.log(`  video 15 dtk  Rp${(biaya * 3).toLocaleString("id-ID")} (3 klip)`);
  fs.writeFileSync(path.join(OUT, "hasil.json"), JSON.stringify({ tier: TIER, model: tierCfg?.byteplusModel, biayaPerKlip: biaya }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
