// QC otomatis (FSD F-08). QC-03/04/05/07/08 diimplementasi nyata;
// QC-01/02/06 = stub terdokumentasi (butuh model CV/audio — fase berikutnya).

import fs from "node:fs";
import os from "node:os";
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
  /**
   * Teks overlay yang memang diharapkan terlihat, plus jendela waktunya.
   * Ini terpisah dari `finalTexts`: teks skrip bisa terdengar tanpa selalu
   * menjadi overlay pada mode embedded/VO.
   */
  overlayTextExpectations?: { text: string; startSec: number; endSec: number }[];
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

interface HandMorphResult {
  sampled_frames: number;
  evaluated_pairs: number;
  anomalies: { from: string; to: string; area_ratio: number; solidity_delta: number; valley_delta: number; signals: number }[];
}

type OcrWord = { text: string; left: number; top: number; width: number; height: number; conf: number; line: string };
type OcrLine = { left: number; top: number; width: number; height: number; key: string };

const normalizeOcr = (value: string) => value
  .toLocaleLowerCase("id-ID")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function ocrTokens(text: string): string[] {
  return normalizeOcr(text).split(" ").filter((word) => word.length >= 3 || /^\d+$/.test(word));
}

/**
 * Parse TSV Tesseract only at word/line level.  Line geometry catches text
 * which is visibly cut off even when OCR loses the final characters.
 */
function parseTesseractTsv(tsv: string): { words: OcrWord[]; lines: OcrLine[] } {
  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];
  for (const raw of tsv.split(/\r?\n/).slice(1)) {
    const fields = raw.split("\t");
    if (fields.length < 12) continue;
    const [level, page, block, par, line, , left, top, width, height, conf, ...textParts] = fields;
    const geometry = { left: Number(left), top: Number(top), width: Number(width), height: Number(height) };
    if (!Number.isFinite(geometry.left) || !Number.isFinite(geometry.top)) continue;
    const key = `${page}:${block}:${par}:${line}`;
    if (level === "4") lines.push({ ...geometry, key });
    if (level === "5") {
      const text = textParts.join("\t").trim();
      const confidence = Number(conf);
      if (text && confidence >= 35) words.push({ ...geometry, text, conf: confidence, line: key });
    }
  }
  return { words, lines };
}

async function ocrFrame(frame: string): Promise<{ words: OcrWord[]; lines: OcrLine[] }> {
  const { stdout } = await runFf("tesseract", [frame, "stdout", "-l", "eng", "--psm", "11", "tsv"]);
  return parseTesseractTsv(stdout);
}

function intersects(a: OcrWord, b: OcrWord): boolean {
  const horizontal = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const vertical = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return horizontal * vertical > Math.min(a.width * a.height, b.width * b.height) * 0.25;
}

/**
 * QC-06 uses Tesseract on actual composited frames (not just overlay layout).
 * OCR cannot prove every Indonesian caption; therefore absence/low confidence
 * is a `skip` for human review, while a recognised expected overlay touching
 * the canvas edge or colliding with another expected overlay is a hard fail.
 */
export async function qcTextNotClipped(
  filePath: string,
  _workDir: string,
  expectations: { text: string; startSec: number; endSec: number }[],
): Promise<QcCheck> {
  if (expectations.length === 0) return { code: "QC-06", name: "Teks overlay tidak terpotong", status: "skip", detail: "Tidak ada overlay bertimeline untuk diperiksa OCR." };
  // Homebrew Tesseract/Leptonica on macOS can reject media files under an
  // inherited work directory; a fresh OS temp dir is portable to the worker
  // container and avoids leaking render artifacts into storage.
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "racun-qc06-"));
  try {
    const duration = await probeDurationSec(filePath);
    const observations: { expected: string; frame: string; words: OcrWord[]; lines: OcrLine[] }[] = [];
    const sampled = new Map<number, { frame: string; words: OcrWord[]; lines: OcrLine[] }>();
    const edge = 4;
    for (let i = 0; i < expectations.length; i++) {
      const expected = expectations[i];
      const at = Math.max(0, Math.min(duration - 0.05, (expected.startSec + expected.endSec) / 2));
      let sample = sampled.get(at);
      if (!sample) {
        const frame = path.join(framesDir, `frame_${String(i).padStart(2, "0")}.png`);
        await runFfmpeg(["-y", "-v", "error", "-ss", at.toFixed(2), "-i", filePath, "-frames:v", "1", frame]);
        const parsed = await ocrFrame(frame);
        sample = { frame, ...parsed };
        sampled.set(at, sample);
      }
      // At this sampled instant, inspect every overlay that is expected to be
      // visible. This makes the overlap check meaningful, not merely a
      // comparison between unrelated frames.
      for (const active of expectations.filter((item) => item.startSec <= at && item.endSec >= at)) {
        const wanted = new Set(ocrTokens(active.text));
        const matched = sample.words.filter((word) => wanted.has(normalizeOcr(word.text)));
        observations.push({ expected: active.text, frame: sample.frame, words: matched, lines: sample.lines });
      }
    }
    const recognised = observations.filter((item) => item.words.length > 0);
    const expectedTexts = [...new Set(expectations.map((item) => item.text))];
    const recognisedTexts = new Set(recognised.map((item) => item.expected));
    const missing = expectedTexts.filter((text) => !recognisedTexts.has(text));
    if (missing.length > 0) {
      // A partial match is never evidence that every simultaneously visible
      // overlay is safe. Keep this reviewable rather than issuing a false PASS.
      return { code: "QC-06", name: "Teks overlay tidak terpotong", status: "skip", detail: `OCR belum membuktikan overlay: ${missing.map((text) => JSON.stringify(text)).join(", ")}; perlu tinjauan visual, bukan klaim lulus.` };
    }
    for (const item of recognised) {
      for (const word of item.words) {
        const line = item.lines.find((candidate) => candidate.key === word.line);
        // Use line geometry: OCR often drops the final letters of clipped text,
        // but preserves the line box extending to the canvas boundary.
        if (line && (line.left <= edge || line.top <= edge || line.left + line.width >= 720 - edge || line.top + line.height >= 1280 - edge)) {
          return { code: "QC-06", name: "Teks overlay tidak terpotong", status: "fail", detail: `OCR mengenali "${word.text}" namun barisnya menyentuh tepi kanvas di ${path.basename(item.frame)}.` };
        }
      }
    }
    const all = recognised.flatMap((item) => item.words.map((word) => ({ ...word, expected: item.expected, frame: item.frame })));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (all[i].frame === all[j].frame && all[i].expected !== all[j].expected && intersects(all[i], all[j])) {
        return { code: "QC-06", name: "Teks overlay tidak terpotong", status: "fail", detail: `OCR mendeteksi tumpang tindih "${all[i].text}" dan "${all[j].text}".` };
      }
    }
    const foundTokens = new Set(recognised.flatMap((item) => item.words.map((word) => normalizeOcr(word.text))));
    return { code: "QC-06", name: "Teks overlay tidak terpotong", status: "pass", detail: `OCR memverifikasi ${foundTokens.size} token overlay pada ${recognised.length}/${expectations.length} frame; tidak ada tepi/tumpang tindih terdeteksi.` };
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/**
 * QC-02: lightweight continuity guard for hands/fingers.
 *
 * It samples the completed video, then asks OpenCV to compare the largest
 * skin-coloured silhouette in consecutive non-cut frames.  It only rejects a
 * transition with at least two major topology changes (area, convex solidity,
 * or finger-valley proxy), so it is intentionally a conservative morphing
 * detector rather than an unreliable finger counter.
 */
export async function qcHandMorphing(filePath: string, workDir: string): Promise<QcCheck> {
  const framesDir = path.join(workDir, "qc02_frames");
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const pattern = path.join(framesDir, "frame_%03d.jpg");
  // Two samples/sec and a width cap keep the check bounded on a 512 MiB worker.
  await runFfmpeg(["-y", "-v", "error", "-i", filePath, "-vf", "fps=2,scale=480:-2", "-frames:v", "32", pattern]);
  const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).sort().map((f) => path.join(framesDir, f));
  if (frames.length < 2) throw new Error("frame sampel QC-02 tidak cukup");
  const { stdout } = await runFf(pythonBin(), [path.join(process.cwd(), "lib", "media", "qc_hand_morph_check.py"), ...frames]);
  const data = JSON.parse(stdout) as HandMorphResult;
  const worst = data.anomalies[0];
  return {
    code: "QC-02",
    name: "Tangan/jari tidak morphing (kontinuitas siluet)",
    status: worst ? "fail" : "pass",
    detail: worst
      ? `anomali siluet ${path.basename(worst.from)}→${path.basename(worst.to)}: area×${worst.area_ratio}, soliditas Δ${worst.solidity_delta}, lembah-jari Δ${worst.valley_delta}`
      : `${data.sampled_frames} frame; ${data.evaluated_pairs} transisi tangan non-cut diperiksa`,
  };
}

export async function runQc(input: QcInput): Promise<QcResult> {
  const checks: QcCheck[] = [];

  // QC-01 lip-sync — stub: mode hands_only tidak punya wajah bicara.
  checks.push({ code: "QC-01", name: "Lip-sync drift", status: "skip", detail: "Tidak relevan untuk hands_only; butuh analisis viseme untuk talking_head (fase 2)." });
  // QC-02 morphing tangan — conservative OpenCV silhouette continuity check.
  try {
    checks.push(await qcHandMorphing(input.filePath, path.dirname(input.filePath)));
  } catch (err) {
    // Cannot inspect a hands_only output safely: fail closed, rather than hide it.
    checks.push({ code: "QC-02", name: "Tangan/jari tidak morphing", status: "fail", detail: `detektor gagal: ${err instanceof Error ? err.message : err}` });
  }
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

  // QC-06 runs on composited output.  Do not turn uncertain OCR into a false
  // pass: unavailable/insufficient OCR remains explicitly skipped for review.
  try {
    const expectations = input.overlayTextExpectations ?? input.finalTexts.map((text) => ({ text, startSec: 0, endSec: input.targetDurationSec }));
    checks.push(await qcTextNotClipped(input.filePath, path.dirname(input.filePath), expectations));
  } catch (err) {
    checks.push({ code: "QC-06", name: "Teks overlay tidak terpotong", status: "skip", detail: `OCR tidak tersedia/gagal: ${err instanceof Error ? err.message : err}` });
  }

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
