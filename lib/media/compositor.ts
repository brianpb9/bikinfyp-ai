// Compositor FFmpeg (FSD F-06 langkah 5 + F-07 LABELING) — 3 mode audio:
//
//  mode "vo"       : klip senyap + VO TTS per segmen (alur mock tier bersuara —
//                    mock MENSIMULASIKAN audio embedded; byteplus mengerjakan
//                    sungguhan di dalam model, lihat mode "embedded").
//  mode "embedded" : audio ikut dari klip video (tier bersuara via provider nyata).
//  mode "caption"  : F-05c Senyap+Teks — video bisu + caption tersinkron (multi
//                    PNG overlay ber-timeline enable=between) + musik latar −20 dB.
//
// WATERMARK "Dibuat dengan AI" opasitas 70% SELAMA SELURUH VIDEO di SEMUA mode —
// wajib, tidak ada parameter/flag/cabang kode untuk mematikannya (BR-07.3).
// Metadata provenance (tag AIGC + comment). C2PA penuh: TODO (c2pa-rs).

import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, runFf, escDrawtext, detectFont } from "./ffmpeg";
import { config } from "../config";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";
import { renderCtaBadge, type RenderedCaption } from "./render-captions";

export interface VoSegment {
  path: string;
  startSec: number;
}

export type CompositeMode = "vo" | "embedded" | "caption";

export interface CompositeInput {
  jobId: string;
  workDir: string;
  clipPaths: string[]; // 2 klip berurutan
  mode: CompositeMode;
  vo?: VoSegment[]; // mode "vo"
  captions?: RenderedCaption[]; // mode "caption"
  musicPath?: string; // mode "caption"
  durationSec: number; // target 15
  priceText: string; // overlay harga saat demo (mode vo/embedded)
  ctaText: string; // teks badge CTA (pill) saat segmen cta — semua mode
  demoRange: [number, number]; // detik
  ctaRange: [number, number];
  providerVideo: string;
}

export interface CompositeResult {
  outPath: string;
  renderParams: { watermark: true; watermarkText: string };
}

let drawtextSupported: boolean | null = null;
async function hasDrawtext(): Promise<boolean> {
  if (drawtextSupported !== null) return drawtextSupported;
  try {
    const { stdout } = await runFf(config.ffmpegPath, ["-hide_banner", "-filters"]);
    drawtextSupported = /\bdrawtext\b/.test(stdout);
  } catch {
    drawtextSupported = false;
  }
  return drawtextSupported;
}

/** Render PNG teks transparan via ImageMagick (fallback drawtext). */
async function renderTextPng(opts: {
  text: string;
  outPath: string;
  pointsize: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}): Promise<void> {
  const font = detectFont();
  const args = [
    "-background", "none",
    "-font", font,
    "-pointsize", String(opts.pointsize),
    "-fill", opts.fill,
  ];
  if (opts.stroke) args.push("-stroke", opts.stroke, "-strokewidth", String(opts.strokeWidth ?? 3));
  args.push(`label:${opts.text}`, opts.outPath);
  await runFf(process.env.MAGICK_PATH ?? "/opt/homebrew/bin/magick", args);
}

export async function compositeVideo(input: CompositeInput): Promise<CompositeResult> {
  const font = detectFont();
  const outPath = path.join(input.workDir, "output.mp4");
  const useDrawtext = await hasDrawtext();

  // Watermark SELALU dirender — konstanta, bukan parameter opsional.
  const watermarkText: string = AIGC_WATERMARK_TEXT;

  const args: string[] = ["-y"];
  for (const clip of input.clipPaths) args.push("-i", clip);
  // Input audio: VO (mode vo) atau musik (mode caption) — SEBELUM input PNG overlay,
  // supaya indeks stream konsisten dengan filter graph.
  const hasMusic = input.mode === "caption" && !!input.musicPath && fs.existsSync(input.musicPath);
  if (input.mode === "vo") for (const vo of input.vo ?? []) args.push("-i", vo.path);
  if (hasMusic) args.push("-stream_loop", "-1", "-i", input.musicPath!);

  const vChain: string[] = [];
  const aChain: string[] = [];
  let mapAudio = "";
  let pngCount = 0;
  const addPngInput = (p: string) => {
    args.push("-i", p);
    return input.clipPaths.length + (input.mode === "vo" ? (input.vo?.length ?? 0) : 0) + (hasMusic ? 1 : 0) + pngCount++;
  };

  // --- Rantai video: concat + watermark + overlay sesuai mode ---
  // N klip dinamis (2 di 15/30 dtk, 3 di 45 dtk — lihat shot-planner.ts) bukan
  // hardcode 2 (2026-08-04, v1.3): label input dibangun dari clipPaths.length.
  const n = input.clipPaths.length;
  if (input.mode === "embedded") {
    // Klip membawa audio; concat video+audio sekaligus.
    const labels = Array.from({ length: n }, (_, i) => `[${i}:v][${i}:a]`).join("");
    vChain.push(`${labels}concat=n=${n}:v=1:a=1[vcat][acat]`);
    aChain.push(`[acat]aresample=24000[aout]`);
    mapAudio = "[aout]";
  } else {
    const labels = Array.from({ length: n }, (_, i) => `[${i}:v]`).join("");
    vChain.push(`${labels}concat=n=${n}:v=1:a=0[vcat]`);
  }
  // Normalisasi kanvas ke 720x1280 SEBELUM overlay — klip 480p (480x854) dari
  // provider di-upscale supaya PNG overlay (lebar ~680px) tidak terpotong.
  vChain.push(`[vcat]scale=720:1280:flags=bilinear[vsc]`);

  // Watermark (selalu)
  let cur = "vsc";
  if (useDrawtext) {
    vChain.push(
      `[${cur}]drawtext=fontfile='${font}':text='${escDrawtext(watermarkText)}':` +
        `fontsize=28:fontcolor=white@0.7:x=w-text_w-24:y=h-text_h-24[vw]`
    );
    cur = "vw";
  } else {
    const wmPng = path.join(input.workDir, "ov_watermark.png");
    await renderTextPng({ text: watermarkText, outPath: wmPng, pointsize: 28, fill: "rgba(255,255,255,0.7)", stroke: "rgba(0,0,0,0.35)", strokeWidth: 1 });
    const idx = addPngInput(wmPng);
    vChain.push(`[${cur}][${idx}:v]overlay=x=W-w-24:y=H-h-24:eof_action=repeat[vw]`);
    cur = "vw";
  }

  if (input.mode === "caption") {
    // Caption tersinkron: multi PNG overlay ber-timeline. Harga tampil di card demo
    // (di-highlight kuning); segmen CTA diganti BADGE pill (bukan card biasa).
    for (const card of (input.captions ?? []).filter((c) => c.segmentRole !== "cta")) {
      const idx = addPngInput(card.pngPath);
      const next = `vc${card.index}`;
      vChain.push(
        `[${cur}][${idx}:v]overlay=x=(W-w)/2:y=H*0.12:eof_action=repeat:` +
          `enable='between(t,${card.startSec},${card.endSec})'[${next}]`
      );
      cur = next;
    }
    // Badge CTA pill ~17% dari bawah (tidak menutupi area keranjang asli TikTok)
    const badgePath = await renderCtaBadge(input.ctaText, input.workDir);
    const bIdx = addPngInput(badgePath);
    vChain.push(
      `[${cur}][${bIdx}:v]overlay=x=(W-w)/2:y=H*0.83-h/2:eof_action=repeat:` +
        `enable='between(t,${input.ctaRange[0]},${input.ctaRange[1]})'[vcta]`
    );
    cur = "vcta";
    // Musik latar pelan (volume 0.5 — satu-satunya sumber audio di mode caption,
    // jadi harus tetap terdengar lembut TAPI terdeteksi QC-04; tanpa suara mengagetkan).
    if (hasMusic) {
      const mIdx = input.clipPaths.length; // indeks input musik (setelah klip)
      aChain.push(`[${mIdx}:a]atrim=0:${input.durationSec},volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, input.durationSec - 1)}:d=1,aresample=24000[aout]`);
    } else {
      aChain.push(`aevalsrc=0:d=${input.durationSec}:s=24000[aout]`);
    }
    mapAudio = "[aout]";
  } else if (input.mode === "vo") {
    // Overlay harga & CTA statis + VO per segmen
    if (useDrawtext) {
      vChain.push(
        `[${cur}]drawtext=fontfile='${font}':text='${escDrawtext(input.priceText)}':` +
          `fontsize=64:fontcolor=white:borderw=4:bordercolor=black@0.9:` +
          `x=(w-text_w)/2:y=h*0.68:enable='between(t,${input.demoRange[0]},${input.demoRange[1]})'[vp]`
      );
      cur = "vp";
      const badgePath = await renderCtaBadge(input.ctaText, input.workDir);
      const bIdx = addPngInput(badgePath);
      vChain.push(
        `[${cur}][${bIdx}:v]overlay=x=(W-w)/2:y=H*0.83-h/2:eof_action=repeat:` +
          `enable='between(t,${input.ctaRange[0]},${input.ctaRange[1]})'[vq]`
      );
      cur = "vq";
    } else {
      const pricePng = path.join(input.workDir, "ov_price.png");
      await renderTextPng({ text: input.priceText, outPath: pricePng, pointsize: 64, fill: "white", stroke: "rgba(0,0,0,0.9)", strokeWidth: 4 });
      let idx = addPngInput(pricePng);
      vChain.push(`[${cur}][${idx}:v]overlay=x=(W-w)/2:y=H*0.68-h/2:eof_action=repeat:enable='between(t,${input.demoRange[0]},${input.demoRange[1]})'[vp]`);
      cur = "vp";
      const badgePath = await renderCtaBadge(input.ctaText, input.workDir);
      idx = addPngInput(badgePath);
      vChain.push(`[${cur}][${idx}:v]overlay=x=(W-w)/2:y=H*0.83-h/2:eof_action=repeat:enable='between(t,${input.ctaRange[0]},${input.ctaRange[1]})'[vq]`);
      cur = "vq";
    }
    // Audio: basis hening + VO per segmen di-delay ke timestamp segmen.
    aChain.push(`aevalsrc=0:d=${input.durationSec}:s=24000[sil]`);
    const mixInputs = ["[sil]"];
    (input.vo ?? []).forEach((vo, i) => {
      const streamIdx = input.clipPaths.length + i;
      const delayMs = Math.round(vo.startSec * 1000);
      aChain.push(`[${streamIdx}:a]aresample=24000,adelay=delays=${delayMs}:all=1[a${i}]`);
      mixInputs.push(`[a${i}]`);
    });
    aChain.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0[aout]`);
    mapAudio = "[aout]";
  } else if (input.mode === "embedded") {
    // Overlay harga & CTA statis di atas video bersuara
    if (useDrawtext) {
      vChain.push(
        `[${cur}]drawtext=fontfile='${font}':text='${escDrawtext(input.priceText)}':` +
          `fontsize=64:fontcolor=white:borderw=4:bordercolor=black@0.9:` +
          `x=(w-text_w)/2:y=h*0.68:enable='between(t,${input.demoRange[0]},${input.demoRange[1]})'[vp]`
      );
      cur = "vp";
      const badgePath = await renderCtaBadge(input.ctaText, input.workDir);
      const bIdx = addPngInput(badgePath);
      vChain.push(
        `[${cur}][${bIdx}:v]overlay=x=(W-w)/2:y=H*0.83-h/2:eof_action=repeat:` +
          `enable='between(t,${input.ctaRange[0]},${input.ctaRange[1]})'[vq]`
      );
      cur = "vq";
    } else {
      const pricePng = path.join(input.workDir, "ov_price.png");
      await renderTextPng({ text: input.priceText, outPath: pricePng, pointsize: 64, fill: "white", stroke: "rgba(0,0,0,0.9)", strokeWidth: 4 });
      let idx = addPngInput(pricePng);
      vChain.push(`[${cur}][${idx}:v]overlay=x=(W-w)/2:y=H*0.68-h/2:eof_action=repeat:enable='between(t,${input.demoRange[0]},${input.demoRange[1]})'[vp]`);
      cur = "vp";
      const badgePath = await renderCtaBadge(input.ctaText, input.workDir);
      idx = addPngInput(badgePath);
      vChain.push(`[${cur}][${idx}:v]overlay=x=(W-w)/2:y=H*0.83-h/2:eof_action=repeat:enable='between(t,${input.ctaRange[0]},${input.ctaRange[1]})'[vq]`);
      cur = "vq";
    }
  }

  vChain.push(`[${cur}]null[vout]`);

  args.push(
    "-filter_complex", [...vChain, ...aChain].join(";"),
    "-map", "[vout]",
    "-map", mapAudio,
    "-t", String(input.durationSec),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "faststart+use_metadata_tags",
    "-metadata", `comment=BikinFYP AI AIGC v0.2 | provider_video=${input.providerVideo} | mode=${input.mode} | ${new Date().toISOString()}`,
    "-metadata", "racun_aigc=true",
    "-metadata", `aigc_watermark=${watermarkText}`,
    // TODO(produksi): sisipkan manifest C2PA penuh (c2pa-rs / c2patool) — BR-07.2.
    outPath
  );

  await runFfmpeg(args);
  console.log(`[compositor] job ${input.jobId}: output.mp4 selesai (mode=${input.mode}, watermark AIGC aktif 100% durasi)`);
  return { outPath, renderParams: { watermark: true, watermarkText } };
}
