// QC otomatis (FSD F-08). Semua check kini punya implementasi nyata atau
// alasan N/A yang spesifik — tidak ada lagi yang berstatus "stub".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { probeDurationSec, probeHasVideoStream, probeFormatTags, volumeDetect, runFfmpeg, runFf } from "./ffmpeg";
import { validateScript } from "../script-engine/validator";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";
import { isServiceLike } from "../config/hooks";
import { qcVision, POSISI_SAMPEL } from "./qc-vision";

export interface QcCheck {
  code: string;
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
  /** Detik-detik penyebab kegagalan, bila check-nya bisa menunjuk tempat.
   *
   *  Ada supaya kegagalan bisa DIPERBAIKI, bukan cuma dilaporkan: dari
   *  detiknya ketahuan shot mana yang cacat, jadi yang digenerate ulang cukup
   *  shot itu. */
  detikGagal?: number[];
}

export interface QcResult {
  passed: boolean;
  checks: QcCheck[];
  checked_at: string;
}

/**
 * Production acceptance policy. A `skip` is never equivalent to `pass`.
 * Only a named, inapplicable check may be skipped.  The currently supported
 * render format is hands_only; new formats must add a policy before use.
 */
export const QC_POLICY_BY_FORMAT = {
  // QC-06 keluar dari requiredPass untuk format bersuara (2026-08-07): mode
  // embedded tidak merender overlay teks sama sekali (harga/CTA diucapkan AI,
  // keputusan Brian "tulisan di layar hilangin aja") sehingga QC-06 skip
  // dengan alasan "tidak ada overlay" — fail tetap menolak output.
  hands_only: {
    requiredPass: ["QC-02", "QC-03", "QC-04", "QC-05", "QC-07", "QC-08", "QC-09"],
    permittedSkip: ["QC-01", "QC-06", "QC-10", "QC-11"],
    skipReason: {
      "QC-11": "Boleh skip HANYA bila tak terperiksa (model visi mati / provider mock). fail = jumlah orang atau tangan melanggar batas, dan itu MENOLAK output.",
      "QC-01": "N/A: hands_only tidak menampilkan pembicara. fail = presenter membeku padahal seharusnya bicara.",
      "QC-06": "N/A: mode bersuara tanpa overlay teks (tulisan di layar dihapus 2026-08-07).",
      "QC-10": "N/A hanya bila produk tanpa token teks merek (cek memutuskan sendiri); fail = label rusak.",
    },
  },
  // Wajah AI (v1, 2026-08-03): wajah presenter AI SENGAJA terlihat, jadi
  // QC-09 (larangan wajah) tidak berlaku sama sekali untuk format ini —
  // qcNoFace() hanya pernah dipanggil untuk hands_only (lihat runQc di bawah).
  // QC-01 (lip-sync) tetap skip: verifikasi viseme belum ada (fase 2),
  // dimitigasi lewat instruksi jeda/enunciate di shot-planner.
  talking_head: {
    requiredPass: ["QC-02", "QC-03", "QC-04", "QC-05", "QC-07", "QC-08"],
    permittedSkip: ["QC-01", "QC-06", "QC-10", "QC-11"],
    skipReason: {
      "QC-11": "Boleh skip HANYA bila tak terperiksa (model visi mati / provider mock). fail = jumlah orang atau tangan melanggar batas, dan itu MENOLAK output.",
      "QC-01": "N/A bila suara dari VO terpisah (mulut sengaja tidak disinkronkan). fail = presenter lipsync membeku.",
      "QC-06": "N/A: mode bersuara tanpa overlay teks (tulisan di layar dihapus 2026-08-07).",
      "QC-10": "N/A hanya bila produk tanpa token teks merek (cek memutuskan sendiri); fail = label rusak.",
    },
  },
  // TVC (M9, 2026-08-11): geometri sama seperti talking_head — presenter
  // terlihat memegang produk, jadi QC-09 (larangan wajah) TIDAK berlaku dan
  // memang tidak pernah dijalankan untuk format ini. QC-10 justru penting di
  // sini (brand membayar untuk label produknya benar), tapi tetap boleh skip
  // kalau produknya memang tanpa token teks merek.
  //
  // Ketiadaan entri ini adalah bug yang ketahuan dari render TVC asli
  // pertama: tanpa kebijakan, resolusi jatuh ke hands_only yang mewajibkan
  // QC-09 lulus — padahal QC-09 tidak pernah dijalankan untuk presenter —
  // sehingga job DITOLAK tanpa satu pun check berstatus fail.
  tvc: {
    requiredPass: ["QC-02", "QC-03", "QC-04", "QC-05", "QC-07", "QC-08"],
    permittedSkip: ["QC-01", "QC-06", "QC-10", "QC-11"],
    skipReason: {
      "QC-11": "Boleh skip HANYA bila tak terperiksa (model visi mati / provider mock). fail = jumlah orang atau tangan melanggar batas, dan itu MENOLAK output.",
      "QC-01": "N/A bila suara dari VO terpisah (mulut sengaja tidak disinkronkan). fail = presenter lipsync membeku.",
      "QC-06": "N/A: mode bersuara tanpa overlay teks (overlay brand ditambahkan di post, bukan di prompt).",
      "QC-10": "N/A hanya bila produk tanpa token teks merek (cek memutuskan sendiri); fail = label rusak.",
    },
  },
  // AI UGC Ads (2026-08-11): iklan untuk app/jasa/toko, TANPA produk fisik.
  //
  // QC-03 dan QC-10 dikeluarkan dari requiredPass karena keduanya menilai
  // benda yang memang tidak ada. Membiarkannya wajib berarti setiap iklan jasa
  // ditolak walau hasilnya bagus — persis pola bug yang sudah dua kali kena di
  // sini (TVC tanpa entri kebijakan, dan QC-10 memblokir semua produk fashion).
  // Sisanya TETAP wajib: morphing, durasi, audio, dan kualitas teknis sama
  // pentingnya untuk iklan jasa seperti untuk iklan produk.
  ads: {
    requiredPass: ["QC-02", "QC-04", "QC-05", "QC-07", "QC-08"],
    permittedSkip: ["QC-01", "QC-03", "QC-06", "QC-09", "QC-10", "QC-11"],
    skipReason: {
      "QC-11": "Boleh skip HANYA bila tak terperiksa (model visi mati / provider mock). fail = jumlah orang atau tangan melanggar batas, dan itu MENOLAK output.",
      "QC-01": "N/A bila suara dari VO terpisah. fail = presenter membeku padahal seharusnya bicara.",
      "QC-03": "N/A: iklan jasa/app/toko tidak punya produk fisik untuk dicocokkan.",
      "QC-06": "N/A: mode bersuara tanpa overlay teks.",
      "QC-09": "N/A: format ini memang menampilkan presenter.",
      "QC-10": "N/A: tidak ada label kemasan untuk dibaca.",
    },
  },
  // VO+Foto (v1, 2026-08-03): visual adalah foto produk ASLI di-pan/zoom
  // (bukan video AI-generated), jadi QC-02 (morphing tangan AI) tidak
  // relevan — tidak ada tangan yang di-generate untuk bisa morphing.
  vo_broll: {
    requiredPass: ["QC-03", "QC-04", "QC-05", "QC-06", "QC-07", "QC-08"],
    permittedSkip: ["QC-01", "QC-02", "QC-11"],
    skipReason: {
      "QC-11": "Boleh skip HANYA bila tak terperiksa (model visi mati / provider mock). fail = jumlah orang atau tangan melanggar batas, dan itu MENOLAK output.",
      "QC-01": "N/A: visual adalah foto produk, bukan presenter. fail = presenter membeku.",
      "QC-02": "N/A: video dari foto produk asli (pan/zoom), bukan tangan hasil AI-generated.",
    },
  },
} as const;

export type QcSupportedFormat = keyof typeof QC_POLICY_BY_FORMAT;

export function evaluateQcPolicy(format: string | undefined, checks: QcCheck[]): boolean {
  const key = (format ?? "hands_only") as QcSupportedFormat;
  const policy = QC_POLICY_BY_FORMAT[key];
  if (!policy) return false;
  const byCode = new Map(checks.map((check) => [check.code, check]));
  // Required checks must be present and explicitly pass. Missing, fail, and
  // skip all reject the output.
  if (policy.requiredPass.some((code) => byCode.get(code)?.status !== "pass")) return false;
  // Any check outside the documented N/A list must also pass; this prevents a
  // future check from silently becoming optional.
  const permittedSkip: readonly string[] = policy.permittedSkip;
  return checks.every((check) => check.status === "pass" || (check.status === "skip" && permittedSkip.includes(check.code)));
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
  /** QC-10: kategori produk — pakaian tidak punya merek tercetak untuk di-OCR. */
  productCategory?: string;
  /**
   * Teks overlay yang memang diharapkan terlihat, plus jendela waktunya.
   * Ini terpisah dari `finalTexts`: teks skrip bisa terdengar tanpa selalu
   * menjadi overlay pada mode embedded/VO.
   */
  overlayTextExpectations?: { text: string; startSec: number; endSec: number; critical?: boolean; edgeExempt?: boolean }[];
  /** true bila video dari provider MOCK (dev/e2e) — konten sintetis (zoom-in
   * generik) TIDAK PERNAH punya label produk nyata untuk dibaca; QC-10 wajib
   * skip, bukan fail (insiden r13 2026-08-07: e2e stuck 180s krn QC-10 selalu
   * gagal di produk yang nama-nya kebetulan lolos filter kata generik). */
  isMockProvider?: boolean;
  /** true untuk mode presenter-lipsync (Super HQ): satu-satunya mode yang
   *  mempertahankan audio embedded model, jadi satu-satunya yang benar-benar
   *  menuntut mulutnya bergerak. */
  presenterLipsync?: boolean;
  /** QC-11: berapa orang yang BOLEH ada di frame. Datang dari spec
   *  (maksOrangPerFrame di shot-planner) — bukan diturunkan ulang di sini,
   *  supaya pemeriksa dan prompt tidak bisa berbeda pendapat. Tanpa nilai,
   *  QC-11 tidak dijalankan: menebak batasnya berarti menolak video yang
   *  sebenarnya sah. */
  maxPeople?: number;
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

/** QC-03: konsistensi antar shot + kehadiran warna khas produk referensi (color_similarity.py).
 *
 * talking_head (fix 2026-08-07, insiden production 9ee95693): produk dipegang
 * KECIL di samping wajah — fraksi warna khas di region tengah wajar rendah,
 * dan single-shot berarti cuma 1 frame sampel (produk bisa sedang tak jelas
 * di detik itu). Ambang 0.10 kalibrasi hands_only (produk memenuhi frame)
 * membuang video sehat. Untuk talking_head: sampel 3 titik per shot dan pakai
 * fraksi MAKSIMUM (produk harus jelas terlihat di SUATU titik) dengan ambang
 * lebih rendah 0.02. hands_only tetap aturan lama (min per shot, 0.10).
 */
export const QC03_HUE_FRAC_MIN_TALKING_HEAD = 0.02;

export async function qcProductSimilarity(shotPaths: string[], refImagePath: string, workDir: string, format?: string, labelProven = false): Promise<QcCheck> {
  // tvc ikut kalibrasi talking_head (2026-08-11, ketahuan dari render TVC
  // asli pertama, job ebb93c4d): geometrinya SAMA — presenter memegang produk
  // di samping wajah, produk tidak memenuhi frame. Kalibrasi hands_only
  // (1 titik sampel, ambang 0.10) menolak video TVC yang sehat, persis
  // insiden production 9ee95693 yang melahirkan pengecualian talking_head.
  const presenterLed = format === "talking_head" || format === "tvc";
  const samplePoints = presenterLed ? [0.15, 0.5, 0.85] : [0.5];
  const frames: string[] = [];
  for (let i = 0; i < shotPaths.length; i++) {
    const dur = await probeDurationSec(shotPaths[i]);
    for (let k = 0; k < samplePoints.length; k++) {
      const frame = path.join(workDir, `qc03_shot${i}_${k}.png`);
      await runFfmpeg(["-y", "-v", "error", "-ss", (dur * samplePoints[k]).toFixed(2), "-i", shotPaths[i], "-frames:v", "1", frame]);
      frames.push(frame);
    }
  }
  const { stdout } = await runFf("python3", [
    path.join(process.cwd(), "lib", "media", "color_similarity.py"), refImagePath, ...frames,
  ]);
  const data = JSON.parse(stdout) as ColorSim;
  // Pair-delta antar frame: pada talking_head multi-frame, pasangan intra-shot
  // ikut terhitung — tak apa (delta intra-shot kecil; ambang 60 tetap longgar).
  const shotMax = Math.max(0, ...data.shot_pairs.map((p) => p.max));
  const fracs = data.signature === null ? null : (data.ref_fractions as number[]);
  const refFrac = fracs === null ? null : presenterLed ? Math.max(...fracs) : Math.min(...fracs);
  const hueThreshold = presenterLed ? QC03_HUE_FRAC_MIN_TALKING_HEAD : QC03_HUE_FRAC_MIN;
  const failShot = shotMax > QC03_SHOT_DELTA_MAX;
  // r12 (Brian, video Wardah asli ditolak 2x — fraksi warna kasar terlalu
  // ketat utk produk pucat/kecil di frame ramai walau label & identitas
  // sudah TERBUKTI benar via OCR QC-10): label terbaca = bukti identitas
  // jauh lebih presisi daripada heuristik hue-fraction — bila QC-10 lulus,
  // fraksi warna tidak lagi hard-fail sendirian (tetap dilaporkan di detail).
  // Konsistensi ANTAR SHOT (indikasi produk BERGANTI di tengah video) tetap
  // keras — itu sesuatu yang OCR satu-titik tidak bisa buktikan sendirian.
  const failRef = refFrac !== null && refFrac < hueThreshold && !labelProven;
  const fail = failShot || failRef;
  return {
    code: "QC-03",
    name: "Identitas produk konsisten (antar shot + warna khas referensi)",
    status: fail ? "fail" : "pass",
    detail:
      `antar_shot_max=${shotMax} (ambang ${QC03_SHOT_DELTA_MAX}) · ` +
      (refFrac === null
        ? "warna signature referensi tidak terdeteksi (produk polos) — cek referensi di-skip"
        : `hue_khas_${presenterLed ? "max" : "min"}=${refFrac} (ambang ${hueThreshold}${labelProven && refFrac < hueThreshold ? ", diabaikan — QC-10 sudah buktikan label" : ""})`) +
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
  const base = parseTesseractTsv(stdout);
  // Pass kedua: threshold luminance — overlay app ini putih ATAU kuning
  // (badge promo #FFD34D ≈ Y209!) by design. Ambang 185 (bukan 210) supaya
  // teks kuning ikut lolos; latar sibuk (tangan/produk, umumnya Y<180) tetap
  // terbuang sehingga psm 11 menemukan teks yang jelas terbaca mata (kasus
  // nyata 2026-08-06: pill CTA "Klik Keranjang" 0 token di frame mentah,
  // 96%/93% conf setelah threshold).
  // Resolusi TIDAK diubah supaya koordinat bbox tetap sebanding untuk cek
  // tepi/tumpang tindih. Ini memperkuat PENGENALAN, bukan melonggarkan gate —
  // syarat fail/skip tidak berubah.
  const thresholded = `${frame}.thresh.png`;
  try {
    await runFfmpeg(["-y", "-v", "error", "-i", frame, "-vf",
      "format=gray,geq=lum='if(gt(lum(X\\,Y)\\,185)\\,0\\,255)'", thresholded]);
    const second = await runFf("tesseract", [thresholded, "stdout", "-l", "eng", "--psm", "11", "tsv"]);
    const extra = parseTesseractTsv(second.stdout);
    // Pass threshold menyumbang KATA saja, TANPA line-box: pada citra biner,
    // tesseract kerap menggabungkan area putih jadi satu baris lebar yang
    // menyentuh tepi kanvas -> false positive "teks terpotong" (kasus nyata
    // 2026-08-06: watermark di footage ramai). Cek tepi tetap berjalan penuh
    // lewat line-box pass mentah; key line berprefix agar lookup line untuk
    // kata threshold sengaja tidak menemukan apa-apa.
    base.words.push(...extra.words.map((w) => ({ ...w, line: `thresh:${w.line}` })));
  } catch {
    /* pass threshold opsional — kegagalannya tidak boleh mematikan OCR utama */
  }
  return base;
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
  expectations: { text: string; startSec: number; endSec: number; critical?: boolean; edgeExempt?: boolean }[],
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
        const wanted = ocrTokens(active.text);
        // Bidirectional substring match between expected and OCR'd sub-tokens,
        // not exact equality: Tesseract's sparse-text mode (--psm 11) on these
        // overlays sometimes (a) merges two adjacent words into one blob with
        // no space ("Cuma Rp75.000" -> one word "maiRp75:000"), or (b) splits
        // a single word into fragments ("dengan" -> a separate "gan" word).
        // Exact-string comparison missed both even though the text was
        // clearly legible on the frame (confirmed 2026-08-03 by inspecting an
        // actual failing composite via the QC_DEBUG_MODE persistence below).
        const matched = sample.words.filter((word) =>
          ocrTokens(word.text).some((token) => wanted.some((want) => token.includes(want) || want.includes(token)))
        );
        observations.push({ expected: active.text, frame: sample.frame, words: matched, lines: sample.lines });
      }
    }
    const recognised = observations.filter((item) => item.words.length > 0);
    const expectedTexts = [...new Set(expectations.map((item) => item.text))];
    const recognisedTexts = new Set(recognised.map((item) => item.expected));
    const missing = expectedTexts.filter((text) => !recognisedTexts.has(text));
    // KEBIJAKAN (revisi 2026-08-06 malam, insiden production): OCR server
    // (tesseract Debian) tidak sanggup membuktikan SETIAP kartu caption
    // Indonesia di footage ramai — all-or-nothing membuang video sehat
    // (BytePlus+compositing+QC lain lolos, refund gara-gara 1 kartu tak
    // terbaca). Aturan baru:
    // - Teks KRITIS (watermark AIGC, harga/promo, CTA — ditandai pemanggil)
    //   WAJIB terbukti; tidak terbukti = skip (fail-closed, seperti semula).
    // - Teks non-kritis (kartu caption skrip, dirender deterministik oleh
    //   pipeline PIL kita sendiri) cukup >= 60% terbukti.
    // - Deteksi tepi-terpotong & tumpang-tindih TETAP hard-fail di bawah.
    const criticalTexts = new Set(expectations.filter((e) => e.critical).map((e) => e.text));
    const missingCritical = missing.filter((t) => criticalTexts.has(t));
    const provenRatio = expectedTexts.length === 0 ? 1 : (expectedTexts.length - missing.length) / expectedTexts.length;
    if (missingCritical.length > 0 || provenRatio < 0.6) {
      return {
        code: "QC-06",
        name: "Teks overlay tidak terpotong",
        status: "skip",
        detail:
          missingCritical.length > 0
            ? `OCR belum membuktikan overlay KRITIS: ${missingCritical.map((t) => JSON.stringify(t)).join(", ")}; perlu tinjauan visual, bukan klaim lulus.`
            : `OCR hanya membuktikan ${Math.round(provenRatio * 100)}% overlay (< 60%); perlu tinjauan visual, bukan klaim lulus.`,
      };
    }
    // Overlay yang BY DESIGN tinggal di margin tepi (watermark AIGC, 24px dari
    // kanan-bawah) dikecualikan dari analisis tepi: pada psm 11 di footage
    // ramai, tesseract menggabungkan noise pinggir frame ke "baris" watermark
    // sehingga line-box menyentuh kanvas walau teksnya utuh (kasus nyata
    // 2026-08-07 job ec925061: "Dibuat" -> refund palsu). Kehadiran watermark
    // dijamin QC-08 + penempatan deterministik compositor; overlay lain
    // (caption/harga/CTA) dirender PIL terpusat dengan margin >=60px sehingga
    // cek tepi tetap bermakna penuh untuk mereka.
    const edgeExemptTexts = new Set(expectations.filter((e) => e.edgeExempt).map((e) => e.text));
    for (const item of recognised.filter((r) => !edgeExemptTexts.has(r.expected))) {
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
    // GLYPH YANG SAMA bisa cocok ke dua ekspektasi berbeda (mis. "120" ada di
    // caption card DAN di badge promo) dan juga terbaca dua kali dengan
    // segmentasi berbeda antar pass OCR (mentah "185)" vs threshold "85" di
    // region yang sama). Kotak yang satu (hampir) BERISI kotak lainnya = satu
    // region teks fisik yang terbaca ganda, bukan dua overlay saling menimpa —
    // jangan dihitung tabrakan (kasus nyata 2026-08-06). Tabrakan sungguhan
    // (dua teks berbeda ditumpuk) menghasilkan overlap parsial, bukan containment.
    const sameGlyph = (a: OcrWord, b: OcrWord) => {
      const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
      const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
      const inter = ix * iy;
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      return minArea > 0 && inter / minArea > 0.8;
    };
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (all[i].frame === all[j].frame && all[i].expected !== all[j].expected && intersects(all[i], all[j]) && !sameGlyph(all[i], all[j])) {
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

/**
 * QC-10 — FIDELITAS LABEL PRODUK (gate anti "AI slop label", keputusan Brian
 * 2026-08-07: label rusak/gibberish DILARANG selamanya). Sampling 5 frame,
 * OCR (pass mentah + threshold), lalu cari token merek dari nama produk.
 * Tidak ketemu di SEMUA frame = fail -> retry sekali -> refund. Produk tanpa
 * token alfabet >=4 huruf (mis. baju polos) = skip N/A terdokumentasi.
 */
// Kata produk GENERIK — bukan identitas merek. Video slop bisa menulis kata
// generik dengan benar sambil MENGGANTI mereknya (kasus food-lokal: pack palsu
// "Hi Tempura" tetap memuat "tempura"/"seaweed" yang legible). Token merek =
// token NON-generik; hanya itu yang membuktikan label benar.
// Kategori PAKAIAN (2026-08-11). QC-10 berdiri di atas satu asumsi: nama
// merek TERCETAK cukup besar di kemasan/produk sehingga bisa dibaca OCR.
// Asumsi itu benar untuk botol, tube dan kotak — TIDAK untuk baju: mereknya
// ada di label jahitan di dalam kerah, yang memang tidak pernah menghadap
// kamera di video try-on.
//
// Akibatnya SETIAP produk fashion gagal QC-10 lalu di-refund walau videonya
// bagus (dress Shella Saukia gagal 2x; Diario bahkan tidak jadi dirender
// karena kegagalannya sudah bisa diprediksi). Itu KESALAHAN KATEGORI di
// pemeriksaannya, bukan cacat video — jadi diperlakukan N/A, pola yang sama
// dengan QC-09 yang tidak berlaku untuk format berpresenter.
//
// Identitas produk pakaian tetap dijaga QC-03: untuk baju, WARNA & bahan
// justru sinyal identitas yang kuat (kebalikan produk kemasan pucat yang
// kecil di frame, yang justru mengandalkan teks label).
const APPAREL_CATEGORIES = new Set(["fashion", "muslim_fashion"]);

const GENERIC_PRODUCT_WORDS = new Set([
  "gamis", "dress", "baju", "kaos", "kemeja", "jaket", "sweater", "hoodie", "celana", "rok",
  "hijab", "kerudung", "jilbab", "scarf", "jubah", "sepatu", "sandal", "tas", "tote", "pouch",
  "serum", "cream", "krim", "ampoule", "essence", "toner", "sunscreen", "cleanser", "lotion",
  "snack", "keripik", "kripik", "tempura", "seaweed", "cemilan", "kopi", "teh", "susu",
  "earphone", "headset", "gaming", "chair", "kursi", "mouse", "mousepad", "deskmat", "tumbler", "botol",
  "original", "flavor", "premium", "murah", "viral", "terlaris", "wanita", "pria", "anak", "basic", "polos",
]);

export function brandTokens(productName: string): string[] {
  const all = normalizeOcr(productName)
    .split(" ")
    .filter((token) => token.length >= 4 && /[a-z]/.test(token));
  const brand = all.filter((token) => !GENERIC_PRODUCT_WORDS.has(token));
  // Tanpa token non-generik (mis. "Gamis Polos Premium") -> tidak ada merek
  // untuk diverifikasi; qcLabelFidelity akan skip N/A.
  return brand.sort((a, b) => b.length - a.length).slice(0, 3);
}

export async function qcLabelFidelity(filePath: string, productName: string): Promise<QcCheck> {
  const tokens = brandTokens(productName);
  if (tokens.length === 0) {
    return { code: "QC-10", name: "Label produk terbaca (anti-slop)", status: "skip", detail: "N/A: nama produk tanpa token teks merek (produk polos)." };
  }
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "racun-qc10-"));
  try {
    const duration = await probeDurationSec(filePath);
    const found = new Set<string>();
    let sampled = 0;
    // 8 titik sampel + upscale 2x (label kecil di frame 720p sering di bawah
    // ukuran minimum tesseract — kasus genz-r2: label tajam secara visual tapi
    // OCR full-frame gagal; upscale menyelesaikannya).
    for (const frac of [0.08, 0.2, 0.3, 0.42, 0.55, 0.68, 0.8, 0.92]) {
      const frame = path.join(framesDir, `f${Math.round(frac * 100)}.png`);
      await runFfmpeg(["-y", "-v", "error", "-ss", (duration * frac).toFixed(2), "-i", filePath,
        "-frames:v", "1", "-vf", "scale=1440:-2:flags=lanczos", frame]);
      sampled++;
      const { words } = await ocrFrame(frame);
      for (const word of words) {
        const norm = normalizeOcr(word.text);
        for (const token of tokens) {
          // cocok bila token dan kata OCR berbagi substring >=4 huruf
          // (toleran huruf awal/akhir terpotong sudut kamera)
          for (let i = 0; i + 4 <= token.length; i++) {
            if (norm.includes(token.slice(i, i + 4))) { found.add(token); break; }
          }
        }
      }
      if (found.size > 0) break; // satu frame terbukti sudah cukup
    }
    if (found.size > 0) {
      return { code: "QC-10", name: "Label produk terbaca (anti-slop)", status: "pass", detail: `token merek ${[...found].join(",")} terbaca (sampai ${sampled} frame diperiksa).` };
    }
    return {
      code: "QC-10", name: "Label produk terbaca (anti-slop)", status: "fail",
      detail: `token merek (${tokens.join(", ")}) tidak terbaca di ${sampled} frame sampel — indikasi label rusak/gibberish (AI slop).`,
    };
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/** CADANGAN LOKAL untuk QC-11 — menghitung WAJAH tanpa layanan luar.
 *
 *  Kenapa perlu: QC-11 memanggil model visi lewat internet, dan 2026-08-14
 *  layanan itu menjawab 503 berjam-jam. Selama itu QC-11 berstatus skip, dan
 *  skip DIIZINKAN oleh kebijakan (supaya produksi tidak berhenti total saat
 *  pihak ketiga mati). Konsekuensinya jujur tapi buruk: selama layanan itu
 *  mati, cacat yang persis memicu QC-11 dibuat — DUA PEREMPUAN di satu frame —
 *  bisa lolos lagi ke tangan brand.
 *
 *  Gerbang mutu yang mati bersama pihak ketiga bukan gerbang, cuma dekorasi.
 *
 *  Detektor YuNet sudah ada di repo ini (dipakai QC-09) dan jalan sepenuhnya
 *  di mesin sendiri. Ia menghitung WAJAH, bukan orang — jadi cadangan ini
 *  lebih sempit daripada QC-11 penuh: ia TIDAK bisa melihat telapak ketiga,
 *  dan tidak melihat orang yang membelakangi kamera. Yang bisa dilihatnya
 *  justru cacat yang paling mahal: subjek yang digandakan.
 *
 *  Dilaporkan apa adanya sebagai "cadangan", supaya tidak ada yang mengira
 *  pemeriksaan penuh sudah berjalan. */
/** Frame per detik untuk pemeriksa lokal. Dua sudah menangkap kemunculan
 *  sekejap (orang lewat, tangan menyelinap masuk) tanpa membuat pemeriksaan
 *  lebih lambat daripada compositing. */
export const SAMPEL_PER_DETIK = 2;

export async function qcSubjekLokal(videoPath: string, maksWajah: number, workDir: string): Promise<QcCheck> {
  const model = path.join(process.cwd(), "assets", "models", "face_detection_yunet_2023mar.onnx");
  if (!fs.existsSync(model)) {
    return { code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip", detail: "cadangan lokal tidak tersedia: model YuNet tidak ada" };
  }
  const durasi = await probeDurationSec(videoPath);
  // SAMPEL RAPAT — dua frame per detik, bukan tiga frame per video.
  //
  // Batas yang tertulis di papan nilai berbunyi "sampel 3 frame/video, cacat
  // sekejap di antaranya tetap mungkin", dan itu benar: video 30 detik yang
  // diperiksa di detik 6, 15, dan 25 punya 27 detik yang tidak pernah dilihat
  // siapa pun. Orang kedua yang muncul selama dua detik lolos begitu saja.
  //
  // Model visi berbayar memang harus hemat frame. Detektor lokal TIDAK —
  // YuNet jalan di mesin sendiri, gratis, dan satu frame selesai dalam
  // milidetik. Menjarangkan sampelnya di sini bukan penghematan, cuma
  // kelalaian yang diwarisi dari jalur berbayar.
  //
  // Diekstrak dalam SATU panggilan ffmpeg dengan fps filter, bukan satu
  // panggilan per frame: 60 panggilan ffmpeg untuk video 30 detik akan membuat
  // pemeriksaan ini lebih lambat daripada rendernya.
  // Direktori SENDIRI per pemanggilan, bukan workDir bersama.
  //
  // Versi pertama menulis qc11lokal_0001.png ke workDir lalu membaca SEMUA
  // berkas berpola itu — termasuk sisa dari video sebelumnya kalau workDir-nya
  // dipakai ulang. Persis itu yang terjadi saat tes menyapu 33 video: video
  // hands_only 16 detik "diperiksa" dengan 61 frame, sebagian milik video
  // talking_head sebelumnya, lalu dilaporkan mengandung wajah.
  //
  // Enam dari sepuluh kegagalan yang tampak nyata ternyata cuma ini. Pemeriksa
  // yang mencampur bukti antar video lebih berbahaya daripada tidak ada
  // pemeriksa — ia menuduh video yang bersih.
  const dirFrame = fs.mkdtempSync(path.join(workDir, "qc11lokal-"));
  try {
    const pola = path.join(dirFrame, "f_%04d.png");
    await runFfmpeg(["-y", "-v", "error", "-i", videoPath, "-vf", `fps=${SAMPEL_PER_DETIK}`, pola]);
    const frames = fs.readdirSync(dirFrame).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dirFrame, f));
    if (frames.length === 0) {
      return { code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip", detail: "cadangan lokal: tidak ada frame yang bisa diambil" };
    }
    const { stdout } = await runFf(pythonBin(), [path.join(process.cwd(), "lib", "media", "qc_face_check.py"), model, ...frames]);
    const data = JSON.parse(stdout) as { frames: { file: string; faces: number }[]; max_faces: number; max_faces_utama?: number };
    // Yang memblokir WAJAH UTAMA (cukup besar untuk jadi subjek), bukan semua
    // wajah. Orang lewat di latar adalah isi cerita di banyak template — dan
    // menghitungnya sebagai pelanggaran adalah kesalahan yang sudah diperbaiki
    // sekali di pemeriksa visi; jangan diulang di pemeriksa lokal.
    const utama = data.max_faces_utama ?? data.max_faces;
    const lewat = utama > maksWajah;
    return {
      code: "QC-11",
      name: "Jumlah subjek & anatomi (visi)",
      status: lewat ? "fail" : "pass",
      detail: lewat
        ? `${utama} wajah utama terdeteksi di ${data.frames.length} frame (${SAMPEL_PER_DETIK}/dtk), maksimal ${maksWajah}`
        : `${data.frames.length} frame (${SAMPEL_PER_DETIK}/dtk), maksimal ${utama} wajah utama (${data.max_faces} total) — pemeriksa lokal: hanya jumlah wajah, bukan tangan/anatomi`,
    };
  } finally {
    fs.rmSync(dirFrame, { recursive: true, force: true });
  }
}

/** Ambang gerak mulut. Dikalibrasi pada video nyata 2026-08-14:
 *  presenter yang benar-benar bicara -> rata-rata 0,29 (maks 0,94);
 *  frame yang dibekukan -> tepat 0,0.
 *
 *  Ambangnya disetel jauh di bawah kasus bicara dan jauh di atas kasus beku,
 *  supaya derau sensor atau gerak kepala kecil tidak dibaca sebagai bicara,
 *  dan supaya bicara pelan tidak dibaca sebagai beku. */
export const AMBANG_GERAK_MULUT = 0.05;

/** QC-01 — presenter yang seharusnya bicara benar-benar menggerakkan mulutnya.
 *
 *  BUKAN verifikasi viseme. Yang dijawab: "mulutnya bergerak sama sekali atau
 *  tidak", dan itu menangkap kegagalan yang paling parah — presenter membeku
 *  sementara suaranya bicara. Apakah gerakannya COCOK dengan bunyinya butuh
 *  model viseme dan sengaja TIDAK diklaim di sini; lihat qc_lipsync_check.py. */
export async function qcLipSync(videoPath: string, workDir: string): Promise<QcCheck> {
  const model = path.join(process.cwd(), "assets", "models", "face_detection_yunet_2023mar.onnx");
  if (!fs.existsSync(model)) {
    return { code: "QC-01", name: "Mulut presenter bergerak", status: "skip", detail: "model YuNet tidak ada" };
  }
  const durasi = await probeDurationSec(videoPath);
  // Sampel rapat (0,2 dtk) di bagian tengah: pembuka sering transisi, penutup
  // sering packshot. Bicara berlangsung di tengah.
  const mulai = durasi * 0.25;
  const jumlah = Math.min(20, Math.max(6, Math.floor((durasi * 0.5) / 0.2)));
  const frames: string[] = [];
  for (let i = 0; i < jumlah; i++) {
    const detik = mulai + i * 0.2;
    if (detik >= durasi) break;
    const f = path.join(workDir, `qc01_${i}.png`);
    await runFfmpeg(["-y", "-v", "error", "-ss", detik.toFixed(2), "-i", videoPath, "-frames:v", "1", f]);
    if (fs.existsSync(f)) frames.push(f);
  }
  if (frames.length < 4) {
    return { code: "QC-01", name: "Mulut presenter bergerak", status: "skip", detail: "frame sampel tidak cukup" };
  }
  const { stdout } = await runFf(pythonBin(), [path.join(process.cwd(), "lib", "media", "qc_lipsync_check.py"), model, ...frames]);
  const d = JSON.parse(stdout) as { frames_with_face: number; mouth_motion_mean: number; mouth_motion_max: number };
  if (d.frames_with_face < 4) {
    // Tidak ada wajah untuk dinilai. Bukan lulus, bukan gagal — tidak bisa
    // diperiksa, dan itu harus terlihat apa adanya.
    return { code: "QC-01", name: "Mulut presenter bergerak", status: "skip", detail: `wajah terdeteksi di ${d.frames_with_face} frame saja — tidak cukup untuk dinilai` };
  }
  const bergerak = d.mouth_motion_max >= AMBANG_GERAK_MULUT;
  return {
    code: "QC-01",
    name: "Mulut presenter bergerak",
    status: bergerak ? "pass" : "fail",
    detail: bergerak
      ? `gerak mulut maks ${d.mouth_motion_max} (rata-rata ${d.mouth_motion_mean}) di ${d.frames_with_face} frame berwajah`
      : `mulut praktis diam (maks ${d.mouth_motion_max}, ambang ${AMBANG_GERAK_MULUT}) padahal presenter seharusnya bicara`,
  };
}

export async function runQc(input: QcInput): Promise<QcResult> {
  const checks: QcCheck[] = [];

  const qcFormat = input.format ?? "hands_only";

  // QC-01 — DIPERBAIKI 2026-08-14. Sebelumnya selalu skip dengan alasan
  // "verifikasi viseme belum ada", dan itu menyesatkan untuk sebagian besar
  // job: di tier bersuara biasa, VO Gemini TTS SENGAJA menggantikan audio
  // model, jadi mulut yang tidak sinkron memang keputusan desain — bukan
  // pekerjaan yang tertunda. Menyebutnya "stub" membuat seolah ada lubang di
  // semua format, padahal lubangnya cuma di satu tier.
  //
  // Yang benar-benar menuntut mulut bergerak: presenter lipsync, satu-satunya
  // mode yang mempertahankan audio embedded model.
  if (!input.presenterLipsync) {
    checks.push({ code: "QC-01", name: "Mulut presenter bergerak", status: "skip",
      detail: "N/A: suara dari VO terpisah (Gemini TTS) — mulut memang tidak disinkronkan ke kata, sesuai desain." });
  } else if (input.isMockProvider) {
    checks.push({ code: "QC-01", name: "Mulut presenter bergerak", status: "skip", detail: "N/A: provider mock (dev/e2e)." });
  } else {
    try {
      checks.push(await qcLipSync(input.filePath, path.dirname(input.filePath)));
    } catch (err) {
      checks.push({ code: "QC-01", name: "Mulut presenter bergerak", status: "skip", detail: `pemeriksaan gagal jalan: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  // QC-02 morphing tangan — conservative OpenCV silhouette continuity check.
  // Tidak relevan untuk vo_broll: visualnya foto produk asli di-pan/zoom,
  // tidak ada tangan AI-generated yang bisa morphing.
  if (qcFormat === "vo_broll") {
    checks.push({ code: "QC-02", name: "Tangan/jari tidak morphing", status: "skip", detail: "N/A: video dari foto produk asli (pan/zoom), bukan tangan hasil AI-generated." });
  } else {
    try {
      checks.push(await qcHandMorphing(input.filePath, path.dirname(input.filePath)));
    } catch (err) {
      // Cannot inspect a hands_only/talking_head output safely: fail closed, rather than hide it.
      checks.push({ code: "QC-02", name: "Tangan/jari tidak morphing", status: "fail", detail: `detektor gagal: ${err instanceof Error ? err.message : err}` });
    }
  }
  // QC-10 fidelitas label produk (anti "AI slop label") — dijalankan SEBELUM
  // QC-03 (bukan urutan lama) supaya hasilnya bisa dipakai melonggarkan QC-03
  // di bawah: label yang TERBUKTI terbaca adalah bukti identitas produk jauh
  // lebih langsung/presisi daripada heuristik fraksi warna kasar QC-03.
  let labelFidelityPassed = false;
  if (input.isMockProvider) {
    checks.push({ code: "QC-10", name: "Label produk terbaca (anti-slop)", status: "skip", detail: "N/A: provider mock (dev/e2e) — konten sintetis tidak punya label produk nyata untuk dibaca." });
  // tvc ikut diperiksa (2026-08-11): TVC justru format yang PALING butuh
  // label benar — brand membayar untuk identitas produknya. Sebelumnya tvc
  // tidak masuk daftar, jadi QC-10 tidak pernah jalan, labelFidelityPassed
  // tetap false, dan QC-03 hard-fail walau labelnya terbaca sempurna.
  } else if (APPAREL_CATEGORIES.has(input.productCategory ?? "")) {
    checks.push({
      code: "QC-10", name: "Label produk terbaca (anti-slop)", status: "skip",
      detail: `N/A: kategori pakaian (${input.productCategory}) — merek ada di label jahitan, tidak tercetak di produk untuk dibaca OCR. Identitas dijaga QC-03 (warna & bahan).`,
    });
  } else if (input.format === "hands_only" || input.format === "talking_head" || input.format === "tvc") {
    try {
      const labelCheck = await qcLabelFidelity(input.filePath, input.productName);
      checks.push(labelCheck);
      labelFidelityPassed = labelCheck.status === "pass";
    } catch (err) {
      checks.push({ code: "QC-10", name: "Label produk terbaca (anti-slop)", status: "fail", detail: `pemeriksaan gagal jalan: ${err instanceof Error ? err.message : err}` });
    }
  }

  // QC-03 identitas produk konsisten — pemeriksaan kasar tapi nyata (warna region tengah).
  // >= 1 (bukan >= 2, fix 2026-08-07): Wajah AI 15 dtk kini SATU shot — tidak
  // ada pasangan antar-shot, tapi cek warna-khas vs foto referensi tetap
  // bermakna. Ambang lama >= 2 membuat QC-03 skip dan kebijakan menolak job
  // sehat tanpa satu pun check fail (insiden production 21979c08).
  // r12 (Brian, video hands_only Wardah asli DITOLAK 2x padahal label &
  // produk benar secara visual — fraksi-warna heuristik terlalu ketat utk
  // produk pucat/kecil di frame ramai): kalau QC-10 SUDAH membuktikan label
  // terbaca, fraksi-warna tidak lagi jadi hard-fail sendirian — konsistensi
  // ANTAR SHOT (indikasi identitas produk BERGANTI di tengah video) tetap keras.
  if (isServiceLike(input.productCategory)) {
    // Iklan jasa TIDAK punya produk fisik. Gambar yang dikirim adalah visual
    // bisnis (logo/toko/screenshot) yang sengaja TIDAK muncul utuh di layar,
    // jadi membandingkan warna frame dengannya pasti gagal dan akan menolak
    // setiap iklan jasa yang sebenarnya baik-baik saja.
    checks.push({ code: "QC-03", name: "Identitas produk konsisten", status: "skip", detail: "N/A: jasa/app/toko tidak punya produk fisik untuk dicocokkan." });
  } else if (input.shotPaths && input.shotPaths.length >= 1 && input.refImagePath && fs.existsSync(input.refImagePath)) {
    try {
      checks.push(await qcProductSimilarity(input.shotPaths, input.refImagePath, path.dirname(input.filePath), input.format, labelFidelityPassed));
    } catch (err) {
      checks.push({ code: "QC-03", name: "Identitas produk konsisten", status: "skip", detail: `pemeriksaan gagal jalan: ${err instanceof Error ? err.message : err}` });
    }
  } else {
    checks.push({ code: "QC-03", name: "Identitas produk konsisten", status: "skip", detail: "Tidak ada shot/referensi untuk dibandingkan." });
  }

  // QC-09 wajah di hands_only — blocker bila format hands_only dan ada shot.
  // talking_head (Wajah AI) SENGAJA menampilkan wajah -> tidak dicek sama sekali.
  if (qcFormat === "hands_only" && input.shotPaths && input.shotPaths.length > 0) {
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


  // QC-08 label AIGC via METADATA (watermark visual dihapus 2026-08-07 —
  // disclosure ke penonton lewat toggle AIGC platform saat posting):
  // verifikasi parameter render + probe stream + metadata tag racun_aigc.
  try {
    const tags = await probeFormatTags(input.filePath);
    const hasVideo = await probeHasVideoStream(input.filePath);
    const tagOk = (tags["racun_aigc"] ?? "").toLowerCase() === "true";
    const wmOk = input.renderParams.watermark === true;
    const ok = hasVideo && tagOk && wmOk;
    checks.push({
      code: "QC-08", name: "Label AIGC (metadata) tertanam",
      status: ok ? "pass" : "fail",
      detail: `watermark_param=${wmOk} metadata_tag=${tagOk} video_stream=${hasVideo}`,
    });
  } catch (err) {
    checks.push({ code: "QC-08", name: "Label AIGC (metadata) tertanam", status: "fail", detail: String(err) });
  }

  // QC-11 jumlah subjek & anatomi, lewat model visi. BARU 2026-08-13.
  //
  // KENAPA ADA. Sebuah TVC 30 detik keluar dengan DUA perempuan di shot
  // PENUTUP — hal terakhir yang dilihat penonton — dan LOLOS SELURUH QC di
  // atas. Ketahuan hanya karena kebetulan ditonton. Tidak satu pun check yang
  // ada pernah bertanya "ada berapa orang di frame ini": QC-02 memeriksa
  // KONTINUITAS siluet antar frame, QC-09 hanya berlaku di hands_only.
  //
  // vo_broll dikecualikan: visualnya foto produk asli yang di-pan/zoom, tidak
  // ada manusia hasil generate untuk dihitung.
  if (qcFormat === "vo_broll") {
    checks.push({ code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip", detail: "N/A: visual dari foto produk asli, bukan orang hasil AI." });
  } else if (input.isMockProvider) {
    checks.push({ code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip", detail: "N/A: provider mock (dev/e2e) — konten sintetis tidak punya subjek nyata." });
  } else if (input.maxPeople === undefined) {
    checks.push({ code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip", detail: "batas jumlah orang tidak dikirim pemanggil — tidak ditebak." });
  } else {
    try {
      const v = await qcVision({
        videoPath: input.filePath,
        maksOrang: input.maxPeople,
        tanpaWajah: input.maxPeople === 0,
      });
      if (v.temuan === null) {
        // Model visi tidak bisa dipakai. Jangan diam — coba cadangan lokal.
        try {
          checks.push(await qcSubjekLokal(input.filePath, input.maxPeople, path.dirname(input.filePath)));
        } catch (err) {
          checks.push({ code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip",
            detail: `model visi tidak tersedia (${v.masalah.join("; ")}) dan cadangan lokal gagal: ${err instanceof Error ? err.message : String(err)}` });
        }
      } else
      checks.push({
        code: "QC-11", name: "Jumlah subjek & anatomi (visi)",
        ...(v.detikGagal.length ? { detikGagal: v.detikGagal } : {}),
        // temuan null = TIDAK DIPERIKSA, dan itu bukan lulus. Statusnya skip
        // dengan alasannya, supaya kebijakan yang memutuskan — bukan diam.
        status: v.lolos ? "pass" : "fail",
        detail: v.lolos
          ? `${v.temuan.length} frame, maks ${input.maxPeople} orang${v.peringatan.length ? ` · catatan: ${v.peringatan.join("; ")}` : ""}`
          : v.masalah.join("; "),
      });
    } catch (err) {
      checks.push({ code: "QC-11", name: "Jumlah subjek & anatomi (visi)", status: "skip", detail: `pemeriksaan gagal dijalankan: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const passed = evaluateQcPolicy(input.format, checks);
  return { passed, checks, checked_at: new Date().toISOString() };
}
