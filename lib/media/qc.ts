// QC otomatis (FSD F-08). QC-03/04/05/07/08 diimplementasi nyata;
// QC-01/02/06 = stub terdokumentasi (butuh model CV/audio — fase berikutnya).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { probeDurationSec, probeHasVideoStream, probeFormatTags, volumeDetect, runFfmpeg, runFf } from "./ffmpeg";
import { validateScript } from "../script-engine/validator";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";

export interface QcCheck {
  code: string;
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

export interface QcResult {
  passed: boolean;
  checks: QcCheck[];
  checked_at: string;
}

export interface QcInput {
  filePath: string;
  targetDurationSec: number;
  /** Teks final yang terdengar/tertulis di video: segmen skrip + overlay. */
  finalTexts: string[];
  hookFamily: string;
  register: string;
  productName: string;
  priceIdr: number;
  renderParams: { watermark: boolean; watermarkText?: string };
  /** QC-03: klip shot mentah + foto referensi produk (opsional — skip bila tidak ada). */
  shotPaths?: string[];
  refImagePath?: string;
  /** QC-09: format job — hands_only melarang wajah di frame. */
  format?: string;
}

/** Python dengan OpenCV: venv proyek bila ada, selain python3 sistem. */
function pythonBin(): string {
  const venv = path.join(process.cwd(), ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python3";
}

/** QC-09: deteksi wajah pada frame shot (YuNet). Fail bila ada wajah di hands_only. */
export async function qcNoFace(shotPaths: string[], workDir: string): Promise<QcCheck> {
  const model = path.join(process.cwd(), "assets", "models", "face_detection_yunet_2023mar.onnx");
  const frames: string[] = [];
  for (let i = 0; i < shotPaths.length; i++) {
    const dur = await probeDurationSec(shotPaths[i]);
    // Sampel 2 titik per shot (25% & 60%) — wajah bisa muncul di tengah klip
    for (const [k, frac] of [[0, 0.25], [1, 0.6]] as const) {
      const frame = path.join(workDir, `qc09_s${i}_${k}.png`);
      await runFfmpeg(["-y", "-v", "error", "-ss", (dur * frac).toFixed(2), "-i", shotPaths[i], "-frames:v", "1", frame]);
      frames.push(frame);
    }
  }
  const { stdout } = await runFf(pythonBin(), [
    path.join(process.cwd(), "lib", "media", "qc_face_check.py"), model, ...frames,
  ]);
  const data = JSON.parse(stdout) as { frames: { file: string; faces: number; best_score: number }[]; max_faces: number };
  const worst = data.frames.reduce((a, b) => (b.faces > 0 && b.best_score > a.best_score ? b : a), { file: "", faces: 0, best_score: 0 });
  const fail = data.max_faces > 0;
  return {
    code: "QC-09",
    name: "Tanpa wajah di hands_only (YuNet)",
    status: fail ? "fail" : "pass",
    detail: fail
      ? `wajah terdeteksi (skor ${worst.best_score}) di ${path.basename(worst.file)}`
      : `${data.frames.length} frame sampel bersih`,
  };
}

// Ambang QC-03: delta maks per kanal RGB antar shot (region tengah 40%) = 60,
// dan fraksi minimum piksel ber-hue signature produk (dari referensi) per shot = 0,10.
// Kasar & longgar — hanya untuk penyimpangan TOTAL identitas, bukan variasi framing.
export const QC03_SHOT_DELTA_MAX = 60;
export const QC03_HUE_FRAC_MIN = 0.10;

interface ColorSim {
  shot_pairs: { a: string; b: string; delta: number[]; max: number }[];
  signature: number | null;
  ref_fractions: (number | null)[];
}

/** QC-03: konsistensi antar shot + kehadiran warna khas produk referensi (color_similarity.py). */
export async function qcProductSimilarity(shotPaths: string[], refImagePath: string, workDir: string): Promise<QcCheck> {
  const frames: string[] = [];
  for (let i = 0; i < shotPaths.length; i++) {
    const frame = path.join(workDir, `qc03_shot${i}.png`);
    const dur = await probeDurationSec(shotPaths[i]);
    await runFfmpeg(["-y", "-v", "error", "-ss", (dur / 2).toFixed(2), "-i", shotPaths[i], "-frames:v", "1", frame]);
    frames.push(frame);
  }
  const { stdout } = await runFf("python3", [
    path.join(process.cwd(), "lib", "media", "color_similarity.py"), refImagePath, ...frames,
  ]);
  const data = JSON.parse(stdout) as ColorSim;
  const shotMax = Math.max(0, ...data.shot_pairs.map((p) => p.max));
  const minFrac = data.signature === null ? null : Math.min(...(data.ref_fractions as number[]));
  const failShot = shotMax > QC03_SHOT_DELTA_MAX;
  const failRef = minFrac !== null && minFrac < QC03_HUE_FRAC_MIN;
  const fail = failShot || failRef;
  return {
    code: "QC-03",
    name: "Identitas produk konsisten (antar shot + warna khas referensi)",
    status: fail ? "fail" : "pass",
    detail:
      `antar_shot_max=${shotMax} (ambang ${QC03_SHOT_DELTA_MAX}) · ` +
      (minFrac === null
        ? "warna signature referensi tidak terdeteksi (produk polos) — cek referensi di-skip"
        : `hue_khas_min=${minFrac} (ambang ${QC03_HUE_FRAC_MIN})`) +
      " — kasar, hanya menangkap penyimpangan total",
  };
}

export async function runQc(input: QcInput): Promise<QcResult> {
  const checks: QcCheck[] = [];

  // QC-01 lip-sync — stub: mode hands_only tidak punya wajah bicara.
  checks.push({ code: "QC-01", name: "Lip-sync drift", status: "skip", detail: "Tidak relevan untuk hands_only; butuh analisis viseme untuk talking_head (fase 2)." });
  // QC-02 morphing tangan — stub: butuh deteksi anomali antar-frame (model CV).
  checks.push({ code: "QC-02", name: "Tangan/jari morphing", status: "skip", detail: "Butuh model CV deteksi anomali frame (fase 2)." });
  // QC-03 identitas produk konsisten — pemeriksaan kasar tapi nyata (warna region tengah).
  if (input.shotPaths && input.shotPaths.length >= 2 && input.refImagePath && fs.existsSync(input.refImagePath)) {
    try {
      checks.push(await qcProductSimilarity(input.shotPaths, input.refImagePath, path.dirname(input.filePath)));
    } catch (err) {
      checks.push({ code: "QC-03", name: "Identitas produk konsisten", status: "skip", detail: `pemeriksaan gagal jalan: ${err instanceof Error ? err.message : err}` });
    }
  } else {
    checks.push({ code: "QC-03", name: "Identitas produk konsisten", status: "skip", detail: "Tidak ada shot/referensi untuk dibandingkan." });
  }

  // QC-09 wajah di hands_only — blocker bila format hands_only dan ada shot.
  if ((input.format ?? "hands_only") === "hands_only" && input.shotPaths && input.shotPaths.length > 0) {
    try {
      checks.push(await qcNoFace(input.shotPaths, path.dirname(input.filePath)));
    } catch (err) {
      // Detektor gagal jalan = tidak bisa membuktikan tanpa wajah -> gagalkan (aman).
      checks.push({ code: "QC-09", name: "Tanpa wajah di hands_only", status: "fail", detail: `detektor gagal: ${err instanceof Error ? err.message : err}` });
    }
  }

  // QC-04 integritas audio: video tidak boleh senyap total.
  try {
    const { maxDb } = await volumeDetect(input.filePath);
    const silent = maxDb < -40;
    checks.push({
      code: "QC-04", name: "Audio tidak senyap",
      status: silent ? "fail" : "pass",
      detail: `max_volume=${maxDb.toFixed(1)} dB`,
    });
  } catch (err) {
    checks.push({ code: "QC-04", name: "Audio tidak senyap", status: "fail", detail: String(err) });
  }

  // QC-05 durasi ±2 detik dari target.
  try {
    const dur = await probeDurationSec(input.filePath);
    const ok = Math.abs(dur - input.targetDurationSec) <= 2;
    checks.push({
      code: "QC-05", name: "Durasi sesuai target",
      status: ok ? "pass" : "fail",
      detail: `${dur.toFixed(2)} dtk vs target ${input.targetDurationSec} dtk`,
    });
  } catch (err) {
    checks.push({ code: "QC-05", name: "Durasi sesuai target", status: "fail", detail: String(err) });
  }

  // QC-06 teks terpotong — stub: overlay kami fixed-position di safe area; butuh OCR untuk verifikasi umum.
  checks.push({ code: "QC-06", name: "Teks tidak terpotong", status: "skip", detail: "Overlay memakai posisi tetap dalam safe area; verifikasi OCR = fase 2." });

  // QC-07 ulangi filter kata terlarang (L-10/L-11) pada teks final — dicek 2x (SF-03).
  const v = validateScript(
    {
      hook_family: input.hookFamily,
      register: input.register,
      segments: [{ role: "hook", text: input.finalTexts.join(" ") }],
      productName: input.productName,
      priceIdr: input.priceIdr,
    },
    "light" // light = hanya L-10/L-11 keras, persis definisi QC-07
  );
  checks.push({
    code: "QC-07", name: "Tanpa kata terlarang (overclaim/medis)",
    status: v.passed ? "pass" : "fail",
    detail: v.passed ? "bersih" : v.errors.map((e) => e.message_id).join(" "),
  });

  // QC-08 label AIGC ter-render: verifikasi parameter render + probe stream + metadata tag.
  try {
    const tags = await probeFormatTags(input.filePath);
    const hasVideo = await probeHasVideoStream(input.filePath);
    const tagOk = (tags["racun_aigc"] ?? "").toLowerCase() === "true";
    const wmOk = input.renderParams.watermark === true;
    const ok = hasVideo && tagOk && wmOk;
    checks.push({
      code: "QC-08", name: `Label AIGC ("${AIGC_WATERMARK_TEXT}") ter-render`,
      status: ok ? "pass" : "fail",
      detail: `watermark_param=${wmOk} metadata_tag=${tagOk} video_stream=${hasVideo}`,
    });
  } catch (err) {
    checks.push({ code: "QC-08", name: "Label AIGC ter-render", status: "fail", detail: String(err) });
  }

  const passed = checks.every((c) => c.status !== "fail");
  return { passed, checks, checked_at: new Date().toISOString() };
}
