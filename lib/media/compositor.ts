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
import { AUDIO_TARGET, audioEncoderArgs, loudnormFilter, masterAudioFile } from "./audio-master";
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
  /** Tampilkan juga priceText di mode caption (add-on promo 2026-08-06: badge
   * harga-coret + % + deadline harus terlihat di tier senyap juga — caption card
   * hanya memuat teks skrip yang dilarang membawa angka %/tanggal oleh L-14). */
  priceInCaptionMode?: boolean;
  ctaText: string; // teks badge CTA (pill) saat segmen cta — semua mode
  demoRange: [number, number]; // detik
  ctaRange: [number, number];
  providerVideo: string;
  /** Mode embedded: GANTI audio klip dengan VO eksternal (Gemini TTS — suara
   * resmi semua video sejak 2026-08-07; gerak bibir dari klip tetap dipakai). */
  voiceoverWavPath?: string;
  /** Tunda VO eksternal sampai beat lisan pertama; Story Ads memakai ini agar
   * HOOK visual SA3 tetap benar-benar senyap di master final. */
  voiceoverStartSec?: number;
}

export interface CompositeResult {
  outPath: string;
  renderParams: { watermark: true; watermarkText: string };
}

type CompositeObserver = (input: Readonly<CompositeInput>) => void | Promise<void>;
let compositeObserverForTests: CompositeObserver | undefined;

/** Test-only observation point at the production compositor boundary.
 * Unset in production; observers may throw to stop before FFmpeg encoding. */
export function setCompositeObserverForTests(observer?: CompositeObserver): void {
  compositeObserverForTests = observer;
}

/** Filter sumber VO embedded, diekspor agar offset hook-senyap dapat diuji
 * tanpa menjalankan encode FFmpeg penuh. */
export function embeddedVoiceoverInputFilter(voIdx: number, startSec = 0, output = "vopre"): string {
  const delayMs = Math.max(0, Math.round(startSec * 1000));
  return `[${voIdx}:a]aresample=${AUDIO_TARGET.sampleRate},adelay=delays=${delayMs}:all=1,apad[${output}]`;
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

/** Parse warna CSS sederhana ("white", "#FFD34D", "rgba(0,0,0,0.9)") -> RGBA 0-255. */
function cssToRgba(css: string): number[] {
  if (css === "white") return [255, 255, 255, 255];
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Math.round((rgba[4] ? Number(rgba[4]) : 1) * 255)];
  return [255, 255, 255, 255];
}

/** Render PNG teks transparan via renderer PIL (render_caption.py) — python3+PIL
 * adalah kontrak container worker. RIWAYAT 2026-08-06 malam: versi lama memanggil
 * ImageMagick di path Homebrew macOS (/opt/homebrew/bin/magick) yang TIDAK ADA
 * di worker Debian production -> semua job ber-badge promo gagal COMPOSITING
 * ("Hasilnya belum bagus" tanpa sebab jelas). Jangan pernah memanggil binary
 * ber-path macOS dari jalur worker. */
async function renderTextPng(opts: {
  text: string;
  outPath: string;
  pointsize: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}): Promise<void> {
  const specPath = `${opts.outPath}.spec.json`;
  fs.writeFileSync(
    specPath,
    JSON.stringify([
      {
        out: opts.outPath,
        // Renderer PIL melakukan word-wrap sendiri (max_width) dan merender per
        // baris rata tengah — newline eksplisit cukup jadi spasi.
        text: opts.text.replace(/\n/g, " "),
        size: opts.pointsize,
        fill: cssToRgba(opts.fill),
        stroke_fill: cssToRgba(opts.stroke ?? "rgba(0,0,0,1)").slice(0, 3),
        stroke_width: opts.stroke ? (opts.strokeWidth ?? 3) : 0,
        max_width: 640,
        highlight_words: [],
      },
    ])
  );
  const py = path.join(process.cwd(), "lib", "media", "render_caption.py");
  await runFf("python3", [py, specPath]);
}

/** Gain tambahan untuk musik bed.
 *
 *  1.0 karena levelnya sudah DITETAPKAN DI ASETNYA (assets/music/bg-bed.m4a,
 *  dinormalkan ke -22 LUFS), bukan ditebak lewat angka di filter.
 *
 *  Ini pelajaran dari percobaan pertama: bg-loop.m4a aslinya -40,5 dB rata-rata
 *  — praktis senyap. Di mode caption ia tertolong karena satu-satunya sumber
 *  audio, jadi loudnorm akhir mengangkatnya; di bawah VO ia tidak akan pernah
 *  terdengar berapa pun gain yang dipasang. Menaikkan gain 6x di filter tidak
 *  mengubah apa pun yang terukur, dan itu ketahuan hanya karena diukur. */
const MUSIK_GAIN = Number(process.env.MUSIK_GAIN ?? 1);

/** Setelan ducking. threshold rendah supaya bicara pelan pun tetap memicu;
 *  release 350 ms supaya musik naik lagi di jeda antar kalimat tanpa terdengar
 *  memompa. */
const DUCK = { threshold: 0.03, ratio: 6, attack: 15, release: 350 } as const;

export async function compositeVideo(input: CompositeInput): Promise<CompositeResult> {
  await compositeObserverForTests?.(input);
  const font = detectFont();
  const outPath = path.join(input.workDir, "output.mp4");
  const useDrawtext = await hasDrawtext();

  // Watermark SELALU dirender — konstanta, bukan parameter opsional.
  const watermarkText: string = AIGC_WATERMARK_TEXT;

  const args: string[] = ["-y"];
  for (const clip of input.clipPaths) args.push("-i", clip);
  // Input audio: VO (mode vo) atau musik (mode caption) — SEBELUM input PNG overlay,
  // supaya indeks stream konsisten dengan filter graph.
  // MUSIK BED untuk SEMUA mode. Sempat dibatalkan, lalu DIPULIHKAN setelah
  // pengukuran ulang — dan ceritanya layak ditulis karena kesalahannya ada
  // pada CARA MENGUKUR, bukan pada fiturnya.
  //
  // Pembatalan pertama berdasar satu angka: selisih antara keluaran ber-musik
  // dan tanpa-musik cuma -48 dB, dan tidak berubah walau gain dinaikkan 10x.
  // Kesimpulannya waktu itu "musiknya tidak pernah sampai ke campuran".
  //
  // Angka itu tidak sah. Kedua berkas dinormalkan loudnorm SENDIRI-SENDIRI,
  // jadi berkas ber-musik menerima gain sedikit lebih kecil (ia memang lebih
  // keras sebelum normalisasi). Mengurangkan keduanya menghasilkan sisa yang
  // didominasi selisih gain suara, bukan musiknya.
  //
  // Diukur ulang dengan cara yang sah — membandingkan dua keluaran ber-musik
  // pada gain berbeda, sehingga normalisasinya sebanding:
  //   selisih gain 5 vs gain 1        -21,6 dB  (itu musiknya, jelas ada)
  //   jeda VO detik 13-15, gain 1     -14,0 dB
  //   jeda VO detik 13-15, gain 5     -17,7 dB
  // Rantai filternya juga diuji berdiri sendiri, tahap demi tahap: amix
  // menambah 1,7 dB, loudnorm tidak menghapusnya, sidechain tidak menelannya.
  //
  // Pelajarannya bukan soal audio: sebuah fitur yang bekerja hampir dibuang
  // karena metode pengukurannya salah. "Diukur" tidak sama dengan "diukur
  // dengan benar", dan angka yang tidak masuk akal (tidak berubah walau gain
  // 10x) seharusnya langsung mencurigakan alat ukurnya, bukan fiturnya.
  const hasMusic = !!input.musicPath && fs.existsSync(input.musicPath);
  // Musik untuk mode BERSUARA di-duck; mode caption tidak (musiknya satu-
  // satunya sumber audio di sana).
  const musikDiDuck = hasMusic && input.mode !== "caption";
  if (input.mode === "vo") for (const vo of input.vo ?? []) args.push("-i", vo.path);
  if (hasMusic) args.push("-stream_loop", "-1", "-i", input.musicPath!);

  const vChain: string[] = [];
  const aChain: string[] = [];
  let mapAudio = "";
  let pngCount = 0;
  const addPngInput = (p: string) => {
    args.push("-i", p);
    return input.clipPaths.length + (input.mode === "vo" ? (input.vo?.length ?? 0) : 0) + (hasMusic ? 1 : 0) +
      (input.mode === "embedded" && input.voiceoverWavPath ? 1 : 0) + pngCount++;
  };
  /** Indeks stream input musik. Urutannya: klip, VO (mode vo), musik, lalu PNG
   *  — sama dengan urutan args.push di atas. Dihitung sekali di sini supaya
   *  tidak ada dua rumus indeks yang bisa hanyut berbeda. */
  const idxMusik = input.clipPaths.length + (input.mode === "vo" ? (input.vo?.length ?? 0) : 0);
  /** Rantai musik ber-ducking, dipasang di atas suara yang sudah jadi.
   *
   *  sidechaincompress: yang DIKOMPRES musiknya, yang MEMICU suaranya. Jadi
   *  begitu talent bicara, musik turun sendiri, lalu naik lagi di jeda —
   *  persis yang ditulis dokumen produksi, dan yang membuat VO tetap jelas
   *  tanpa harus mengecilkan musik sepanjang video.
   *
   *  Tanpa fade-out: dokumen produksinya minta potong keras di akhir. Fade
   *  membuat penutup terasa mengambang, dan penutup adalah tempat CTA. */
  const rantaiMusik = (labelSuara: string, keluar: string): string[] => [
    `[${labelSuara}]asplit=2[sx1][sx2]`,
    `[${idxMusik}:a]atrim=0:${input.durationSec},volume=${MUSIK_GAIN},aresample=${AUDIO_TARGET.sampleRate}[mus]`,
    `[mus][sx2]sidechaincompress=threshold=${DUCK.threshold}:ratio=${DUCK.ratio}:attack=${DUCK.attack}:release=${DUCK.release}:makeup=1[musd]`,
    `[sx1][musd]amix=inputs=2:duration=first:normalize=0[${keluar}]`,
  ];

  // --- Rantai video: concat + watermark + overlay sesuai mode ---
  // N klip dinamis (2 di 15/30 dtk, 3 di 45 dtk — lihat shot-planner.ts) bukan
  // hardcode 2 (2026-08-04, v1.3): label input dibangun dari clipPaths.length.
  const n = input.clipPaths.length;
  if (input.mode === "embedded" && input.voiceoverWavPath) {
    // Suara resmi = Gemini TTS (Brian 2026-08-07): audio embedded klip DIBUANG,
    // diganti VO eksternal (apad supaya pas durasi video).
    args.push("-i", input.voiceoverWavPath);
    // Indeks VO menghitung input musik yang sudah didorong lebih dulu.
    //
    // Sampai 2026-08-14 baris ini berbunyi `const voIdx = n` — benar selama
    // musik TIDAK PERNAH ada di mode embedded. Begitu musik dipasang untuk
    // semua tier, n menunjuk ke MUSIK, dan setiap video bersuara akan keluar
    // dengan musik menggantikan suara narator. Ketahuan sebelum dirilis karena
    // kalibrasi musiknya diukur, bukan diasumsikan jalan.
    const voIdx = n + (hasMusic ? 1 : 0);
    const labels = Array.from({ length: n }, (_, i) => `[${i}:v]`).join("");
    vChain.push(`${labels}concat=n=${n}:v=1:a=0[vcat]`);
    if (musikDiDuck) {
      aChain.push(embeddedVoiceoverInputFilter(voIdx, input.voiceoverStartSec, "vopre"));
      aChain.push(...rantaiMusik("vopre", "aout"));
    } else {
      aChain.push(embeddedVoiceoverInputFilter(voIdx, input.voiceoverStartSec, "aout"));
    }
    mapAudio = "[aout]";
  } else if (input.mode === "embedded") {
    // Klip membawa audio; concat video+audio sekaligus (jalur lama tanpa TTS).
    const labels = Array.from({ length: n }, (_, i) => `[${i}:v][${i}:a]`).join("");
    vChain.push(`${labels}concat=n=${n}:v=1:a=1[vcat][acat]`);
    if (musikDiDuck) {
      aChain.push(`[acat]aresample=${AUDIO_TARGET.sampleRate}[vopre]`);
      aChain.push(...rantaiMusik("vopre", "aout"));
    } else {
      aChain.push(`[acat]aresample=${AUDIO_TARGET.sampleRate}[aout]`);
    }
    mapAudio = "[aout]";
  } else {
    const labels = Array.from({ length: n }, (_, i) => `[${i}:v]`).join("");
    vChain.push(`${labels}concat=n=${n}:v=1:a=0[vcat]`);
  }
  // Normalisasi kanvas ke 720x1280 SEBELUM overlay — klip 480p (480x854) dari
  // provider di-upscale supaya PNG overlay (lebar ~680px) tidak terpotong.
  vChain.push(`[vcat]scale=720:1280:flags=bilinear[vsc]`);

  // Watermark VISUAL DIHAPUS (keputusan Brian 2026-08-07): teks "Dibuat
  // dengan AI" di video mengganggu dan platform (TikTok) punya toggle label
  // AIGC sendiri saat posting. Provenance AIGC TETAP ada secara tak terlihat:
  // metadata racun_aigc/aigc_watermark + comment di bawah (diverifikasi QC-08).
  let cur = "vsc";

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
    // Badge promo (opsional): harga coret + % + deadline saat demo, di bawah
    // area caption card (y 0.68) — posisi sama dengan overlay harga mode vo.
    if (input.priceInCaptionMode) {
      const promoPng = path.join(input.workDir, "ov_promo.png");
      await renderTextPng({ text: input.priceText, outPath: promoPng, pointsize: 52, fill: "#FFD34D", stroke: "rgba(0,0,0,0.9)", strokeWidth: 4 });
      const pIdx = addPngInput(promoPng);
      vChain.push(
        `[${cur}][${pIdx}:v]overlay=x=(W-w)/2:y=H*0.68-h/2:eof_action=repeat:` +
          `enable='between(t,${input.demoRange[0]},${input.demoRange[1]})'[vpromo]`
      );
      cur = "vpromo";
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
      aChain.push(`[${idxMusik}:a]atrim=0:${input.durationSec},volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, input.durationSec - 1)}:d=1,aresample=${AUDIO_TARGET.sampleRate}[aout]`);
    } else {
      aChain.push(`aevalsrc=0:d=${input.durationSec}:s=${AUDIO_TARGET.sampleRate}[aout]`);
    }
    mapAudio = "[aout]";
  } else if (input.mode === "vo") {
    // Overlay harga & CTA statis + VO per segmen. Teks harga multiline (badge
    // promo 2 baris) wajib jalur PNG — drawtext satu baris akan keluar kanvas.
    if (useDrawtext && !input.priceText.includes("\n")) {
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
    aChain.push(`aevalsrc=0:d=${input.durationSec}:s=${AUDIO_TARGET.sampleRate}[sil]`);
    const mixInputs = ["[sil]"];
    (input.vo ?? []).forEach((vo, i) => {
      const streamIdx = input.clipPaths.length + i;
      const delayMs = Math.round(vo.startSec * 1000);
      aChain.push(`[${streamIdx}:a]aresample=${AUDIO_TARGET.sampleRate},adelay=delays=${delayMs}:all=1[a${i}]`);
      mixInputs.push(`[a${i}]`);
    });
    if (musikDiDuck) {
      aChain.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0[vopre]`);
      aChain.push(...rantaiMusik("vopre", "aout"));
    } else {
      aChain.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0[aout]`);
    }
    mapAudio = "[aout]";
  } else if (input.mode === "embedded") {
    // Mode bersuara TANPA overlay teks (keputusan Brian 2026-08-07: "tulisan
    // di layar hilangin aja" — overlay harga/CTA hasil render dinilai jelek dan
    // menurunkan kesan UGC natural). Harga & CTA sudah DIUCAPKAN oleh AI di
    // dialog; satu-satunya elemen di atas video adalah watermark AIGC
    // (kewajiban kepatuhan, sudah dipasang sebelum cabang mode ini).
  }

  vChain.push(`[${cur}]null[vout]`);

  // MASTERING AUDIO (2026-08-13). Diukur pada video yang benar-benar dirender
  // pipeline ini: -12,4 LUFS di 32 kHz, padahal standar TikTok -14 LUFS di
  // 44,1 kHz. Sumbernya ada DI SINI — compositor me-resample ke 24 kHz di enam
  // tempat, dan tidak ada satu pun langkah normalisasi loudness.
  //
  // Disisipkan sebagai langkah terakhir rantai audio, bukan sebagai lewatan
  // encode tambahan: encode ulang video demi audio berarti membuang kualitas
  // gambar tanpa alasan.
  //
  // Lewatan TUNGGAL (tanpa measured_*): compositor dipanggil sekali per video
  // dan berkas sumbernya belum ada saat filter disusun, jadi pengukuran dua
  // lewatan butuh render ganda. Meleset ~1 LU dibanding dua lewatan — masih
  // jauh lebih baik daripada 1,6 LU terlalu keras dan sample rate salah.
  const aFinal = aChain.length > 0
    ? [...aChain.slice(0, -1), aChain[aChain.length - 1].replace(/\[aout\]$/, "[apre]"), `[apre]${loudnormFilter(null)}[aout]`]
    : aChain;

  // Jejak graf audio. Dipertahankan: satu-satunya cara cepat memastikan filter
  // yang BENAR-BENAR dikirim ke ffmpeg sama dengan yang dikira.
  if (process.env.COMPOSITOR_DEBUG) console.log("[compositor] filter audio:", aFinal.join(";"));
  args.push(
    "-filter_complex", [...vChain, ...aFinal].join(";"),
    "-map", "[vout]",
    "-map", mapAudio,
    "-t", String(input.durationSec),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    ...audioEncoderArgs(),
    "-movflags", "faststart+use_metadata_tags",
    "-metadata", `comment=BikinFYP AI AIGC v0.2 | provider_video=${input.providerVideo} | mode=${input.mode} | ${new Date().toISOString()}`,
    "-metadata", "racun_aigc=true",
    "-metadata", `aigc_watermark=${watermarkText}`,
    // TODO(produksi): sisipkan manifest C2PA penuh (c2pa-rs / c2patool) — BR-07.2.
    outPath
  );

  await runFfmpeg(args);

  // MASTERING AUDIO — lewatan kedua, di berkas jadi.
  //
  // Lewatan pertama sudah ada di dalam filter_complex di atas, tapi terukur
  // 2026-08-13 ia meleset: dari -12,4 LUFS mendarat di -15,5, yaitu 1,5 LU
  // di luar toleransi. Sebabnya audio akhir adalah CAMPURAN yang baru ada
  // setelah dirakit — lewatan tunggal menebak dari awal berkas.
  //
  // Di sini campurannya sudah jadi, jadi bisa diukur betulan. Video di-copy,
  // hanya audio yang di-encode ulang: tidak ada kualitas gambar yang hilang.
  // Terukur sesudahnya: -14,02 LUFS di 44,1 kHz.
  //
  // GAGAL = BIARKAN YANG ASLI. Video yang audionya kurang pas masih bisa
  // dipakai; video yang hilang tidak.
  const mastered = outPath.replace(/\.mp4$/, ".mastered.mp4");
  try {
    const hasil = await masterAudioFile({ filePath: outPath, outPath: mastered });
    if (fs.existsSync(mastered) && fs.statSync(mastered).size > 0) {
      fs.renameSync(mastered, outPath);
      console.log(`[compositor] job ${input.jobId}: audio ${hasil.sebelum?.inputI} -> ${hasil.sesudah?.inputI} LUFS @ ${AUDIO_TARGET.sampleRate} Hz${hasil.ok ? "" : " (MASIH DI LUAR TARGET)"}`);
    }
  } catch (err) {
    console.error(`[compositor] job ${input.jobId}: mastering audio gagal, memakai audio apa adanya —`, err instanceof Error ? err.message : err);
    try { if (fs.existsSync(mastered)) fs.unlinkSync(mastered); } catch { /* abaikan */ }
  }

  console.log(`[compositor] job ${input.jobId}: output.mp4 selesai (mode=${input.mode}, label AIGC via metadata — tanpa watermark visual)`);
  return { outPath, renderParams: { watermark: true, watermarkText } };
}
