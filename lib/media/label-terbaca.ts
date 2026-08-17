/**
 * Gerbang intake: apakah label di foto produk benar-benar TERBACA?
 *
 * Kenapa di intake, bukan di QC. QC-10 memeriksa label di VIDEO HASIL, yaitu
 * setelah kredit ditahan dan provider dibayar. Kalau foto sumbernya sendiri
 * sudah tidak terbaca, video hasilnya tidak akan pernah lolos — dan penggunanya
 * membayar untuk kegagalan yang bisa diketahui sebelum sepeser pun bergerak.
 *
 * PEMBEDANYA DIUKUR, BUKAN DITEBAK — dan percobaan pertama SALAH.
 *
 * Versi pertama hanya menghitung kata >=4 huruf. Foto AI-slop lolos, karena
 * tesseract dengan senang hati membaca "Sdadpgeer" dan "NNSONGO" sebagai kata
 * empat huruf lebih. Panjang huruf bukan pembeda antara tulisan dan coretan.
 *
 * Yang membedakan ternyata SKOR KEYAKINAN OCR, dan bedanya besar. Diukur pada
 * dua foto nyata di storage:
 *
 *   foto asli (Scarlett Acne Serum)
 *     SCARLETT(96) Salicylic(63) Acid(63) Contelle(69) Extract(61)
 *     -> 5 kata dengan conf >= 60
 *
 *   foto AI-slop (label karangan)
 *     Sdadpgeer(10) meer(21) omonle(27) alll(51) CUIMERWDZA(42) Sony(86)
 *     -> 1 kata dengan conf >= 60, dan itu pun salah baca
 *
 * Jadi syaratnya: minimal DUA kata, masing-masing >=4 huruf, didominasi huruf,
 * dengan keyakinan >=60. Ambang 60 diambil dari sebaran di atas — bukan angka
 * bulat yang enak dilihat.
 *
 * Ketidakcocokan nama diperlakukan BERBEDA: ia PERINGATAN, bukan penolakan.
 * Pengguna sah-sah saja menamai produknya lebih pendek daripada yang tercetak
 * di kemasan, dan menolak mereka karena itu akan menghukum penamaan yang wajar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { brandTokens } from "./qc";

const jalankan = promisify(execFile);

/** Minimal kata meyakinkan sebelum sebuah foto dianggap punya label. */
const MIN_KATA = 2;
/** Ambang keyakinan tesseract. Lihat sebaran terukur di komentar atas berkas. */
const MIN_CONF = 60;

export interface HasilLabel {
  /** false = tolak unggahannya. */
  terbaca: boolean;
  /** Kata >=4 huruf yang dikenali OCR. */
  kata: string[];
  /** true kalau salah satu kata cocok dengan nama produk yang diketik. */
  cocokNama: boolean;
  /** Alasan siap-tampil kalau ditolak. */
  alasan?: string;
}

export async function periksaLabelFoto(fotoPath: string, productName: string): Promise<HasilLabel> {
  // Direktori sementara di dalam ruang kerja proses, BUKAN /tmp global:
  // tesseract pada sebagian lingkungan tidak bisa membaca berkas yang ditulis
  // proses lain ke /tmp (terbukti saat audit 17 Agu — ffmpeg menulis PNG yang
  // sah, tesseract melaporkan "image file not found").
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "label-"));
  const png = path.join(dir, "besar.png");
  try {
    // Diperbesar sebelum OCR: label produk di foto 1080px sering di bawah
    // ukuran minimum tesseract — sama alasannya dengan upscale di QC-10.
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", fotoPath, "-vf", "scale=1440:-2:flags=lanczos", png], { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
    // TSV, bukan teks polos: kita butuh kolom keyakinan per kata.
    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11", "tsv"], { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });

    const kata = stdout
      .split("\n")
      .slice(1)
      .map((baris) => baris.split("\t"))
      .filter((k) => k.length >= 12)
      .map((k) => ({ teks: k[11].replace(/[^A-Za-z0-9]/g, ""), conf: Number(k[10]) }))
      .filter((w) =>
        w.teks.length >= 4 &&
        Number.isFinite(w.conf) &&
        w.conf >= MIN_CONF &&
        // Didominasi huruf: menyingkirkan "—_—_~_-" dan potongan angka.
        (w.teks.replace(/[^A-Za-z]/g, "").length / w.teks.length) >= 0.7
      )
      .map((w) => w.teks);

    if (kata.length < MIN_KATA) {
      return {
        terbaca: false,
        kata,
        cocokNama: false,
        alasan:
          "Foto produknya harus tajam dan labelnya terbaca. Yang ini belum — teksnya tidak terbaca sama sekali. Ambil ulang lebih dekat, dengan cahaya cukup dan label menghadap kamera.",
      };
    }

    const tokens = brandTokens(productName);
    const rendah = kata.map((w) => w.toLowerCase());
    const cocokNama =
      tokens.length === 0 ||
      tokens.some((t) => rendah.some((w) => w.includes(t.slice(0, 4)) || t.includes(w.slice(0, 4))));

    return { terbaca: true, kata, cocokNama };
  } catch (err) {
    // Gagal memeriksa BUKAN alasan menolak unggahan. Pengguna tidak boleh
    // kehilangan akses karena tesseract/ffmpeg kita bermasalah — pemeriksaan
    // ini menyaring foto buruk, bukan menjaga uang.
    console.warn(`[label-terbaca] pemeriksaan gagal jalan, dilewati: ${(err as Error).message}`);
    return { terbaca: true, kata: [], cocokNama: true };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
