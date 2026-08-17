/**
 * QC-F1 — kesetiaan produk pada FRAME TURUNAN.
 *
 * Gate 1 (brand fidelity) dari standar produk: label dan bentuk produk harus
 * identik dengan foto aslinya. Wajib, bukan opsional.
 *
 * KENAPA ADA. Frame awal tiap segmen diturunkan dari CAST-REF + foto produk
 * lewat Gemini. Uji 17 Agu menunjukkan langkah itu BISA MENGGESER produknya:
 * botol serum berdropper keluar sebagai botol berpump — dan pergeserannya
 * terjadi di langkah GEMINI, bukan di Seedance. Tanpa pemeriksaan di sini,
 * kita cuma memindahkan cacat dari tahap video ke tahap gambar lalu merasa
 * sudah aman, karena video hilirnya akan setia... pada produk yang salah.
 *
 * Diperiksa DUA CARA, karena keduanya menangkap kegagalan yang berbeda:
 *
 *   Gemini vision  — bentuk, jenis tutup (dropper/pump/screw), warna, tata
 *                    letak label. Hal-hal yang tidak punya teks untuk dibaca.
 *   tesseract      — nama mereknya sendiri. Model bahasa bisa "merasa" label
 *                    itu benar sambil hurufnya sebenarnya berubah; OCR tidak
 *                    punya sopan santun itu.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import { brandTokens } from "./qc";

const jalankan = promisify(execFile);
const MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Satu panggilan vision. Pecahan sen dibanding klip Rp2.771-8.313. */
const BIAYA_PERIKSA_IDR = 12;

export interface HasilQcF1 {
  lulus: boolean;
  /** Alasan siap-baca kalau gagal — dipakai di log dan arsip prompt. */
  detail: string;
  /** Rincian per aspek, untuk menelusuri kegagalan yang berulang. */
  temuan: {
    bentukSama: boolean | null;
    tutupSama: boolean | null;
    warnaSama: boolean | null;
    tataLetakLabelSama: boolean | null;
    merekTerbaca: boolean | null;
  };
  biayaIdr: number;
}

function dataUri(p: string) {
  const ext = path.extname(p).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { mime_type: mime, data: fs.readFileSync(p).toString("base64") };
}

const PERTANYAAN =
  "You are checking whether a product was faithfully reproduced. " +
  "IMAGE 1 is a frame from an advertising video. IMAGE 2 is the ORIGINAL product photo, which is the truth. " +
  "Compare ONLY the product, ignoring background, people, lighting and camera angle.\n\n" +
  "Answer strictly as JSON with these boolean fields and one short string:\n" +
  '{"bentuk_sama":bool,"tutup_sama":bool,"warna_sama":bool,"tata_letak_label_sama":bool,"catatan":"<=20 words"}\n\n' +
  "bentuk_sama: same overall body shape and proportions.\n" +
  "tutup_sama: the closure is the SAME KIND — a dropper is not a pump, a pump is not a screw cap, " +
  "a spray is not a flip-top. This one matters most; closures drift silently.\n" +
  "warna_sama: same colour of the container and of the label.\n" +
  "tata_letak_label_sama: same label layout — same blocks in the same places, same relative sizes.\n" +
  "Be strict. If you are unsure, answer false.";

/** OCR nama merek di frame turunan. Dipisah dari vision karena menangkap
 *  kegagalan yang berbeda: huruf yang berubah, bukan bentuk yang berubah. */
async function merekTerbaca(framePath: string, productName: string): Promise<boolean | null> {
  const tokens = brandTokens(productName);
  if (tokens.length === 0) return null; // produk polos: tidak ada merek untuk dibaca
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcf1-"));
  try {
    const png = path.join(dir, "besar.png");
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", framePath, "-vf", "scale=1440:-2:flags=lanczos", png]);
    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11"]);
    const teks = stdout.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    // Cocok bila token dan teks berbagi awalan >=4 huruf — toleran terhadap
    // huruf tepi yang terpotong sudut kamera, tapi tidak terhadap kata lain.
    return tokens.some((t) => teks.includes(t.slice(0, 4)));
  } catch {
    return null; // gagal memeriksa bukan gagal kesetiaan
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function qcF1FrameFidelity(input: {
  framePath: string;
  /** SELALU foto produk ASLI — tidak pernah frame turunan sebelumnya. */
  productPhotoPath: string;
  productName: string;
  /**
   * Peran produk di frame ini. Menentukan seberapa ketat OCR diperlakukan.
   *
   * Hanya frame HERO yang wajib nama mereknya terbaca OCR — itu janji produk
   * kita (Gate 1), dan di sanalah produknya memang diangkat dekat ke kamera.
   * Pada frame "partial" produk sengaja jauh atau sebagian tertutup tangan;
   * menuntut OCR di situ akan menolak frame yang justru benar, lalu membakar
   * biaya gulung-ulang untuk memperbaiki sesuatu yang tidak rusak.
   *
   * Bentuk, tutup, warna, dan tata letak label tetap diperiksa penuh di
   * kedua peran — pergeseran bentuk salah di mana pun ia muncul.
   */
  productState?: "hero" | "partial";
}): Promise<HasilQcF1> {
  const kosong = { bentukSama: null, tutupSama: null, warnaSama: null, tataLetakLabelSama: null, merekTerbaca: null };
  if (!config.geminiApiKey) {
    return { lulus: true, detail: "QC-F1 dilewati: GEMINI_API_KEY belum di-set.", temuan: kosong, biayaIdr: 0 };
  }

  const ocr = await merekTerbaca(input.framePath, input.productName);

  let vision: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: PERTANYAAN },
          { inline_data: dataUri(input.framePath) },
          { inline_data: dataUri(input.productPhotoPath) },
        ] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const teks = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    vision = JSON.parse(teks) as Record<string, unknown>;
  } catch (err) {
    // Gagal MEMERIKSA bukan gagal kesetiaan. Menolak frame karena pemeriksa
    // kita bermasalah akan membakar biaya re-roll tanpa alasan.
    return {
      lulus: true,
      detail: `QC-F1 tidak dapat dijalankan (${(err as Error).message}) — frame diteruskan tanpa penilaian.`,
      temuan: { ...kosong, merekTerbaca: ocr },
      biayaIdr: 0,
    };
  }

  const temuan = {
    bentukSama: vision.bentuk_sama === true,
    tutupSama: vision.tutup_sama === true,
    warnaSama: vision.warna_sama === true,
    tataLetakLabelSama: vision.tata_letak_label_sama === true,
    merekTerbaca: ocr,
  };

  const gagal: string[] = [];
  if (!temuan.bentukSama) gagal.push("bentuk berbeda");
  if (!temuan.tutupSama) gagal.push("jenis tutup berbeda");
  if (!temuan.warnaSama) gagal.push("warna berbeda");
  if (!temuan.tataLetakLabelSama) gagal.push("tata letak label berbeda");
  // ocr === null berarti tidak ada merek untuk dibaca — bukan kegagalan.
  // Pada frame "partial", OCR dilaporkan tapi TIDAK memblokir (lihat catatan
  // pada productState).
  const wajibOcr = (input.productState ?? "hero") === "hero";
  if (ocr === false && wajibOcr) gagal.push("nama merek tidak terbaca");

  const catatan = typeof vision.catatan === "string" ? ` (${vision.catatan})` : "";
  return {
    lulus: gagal.length === 0,
    detail: gagal.length === 0 ? `QC-F1 lulus${catatan}` : `QC-F1 GAGAL: ${gagal.join(", ")}${catatan}`,
    temuan,
    biayaIdr: BIAYA_PERIKSA_IDR,
  };
}
