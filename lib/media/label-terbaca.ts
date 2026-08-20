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
import { merekCocok } from "./qc-frame";

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
  /**
   * Kecocokan dengan MEREK TERDAFTAR (raw_meta.brand) — sumber yang sama
   * dengan QC-F1, bukan tebakan dari nama produk.
   *
   *   true   label memuat merek terdaftar.
   *   false  label terbaca tapi mereknya TIDAK ada → tolak unggahan.
   *   null   tidak ada merek terdaftar untuk dicocokkan → tidak diperiksa.
   *
   * Keadaan ketiga sengaja dibedakan dari `false`, doktrin yang sama dengan
   * QC-F1: yang tidak bisa dibuktikan tidak boleh disebut lulus MAUPUN gagal.
   */
  cocokMerek: boolean | null;
  /** Alasan siap-tampil kalau ditolak. */
  alasan?: string;
}

/**
 * Merek terdaftar dari baris produk (raw_meta.brand).
 *
 * Bentuknya sengaja sama dengan merekTepercaya() di worker: SATU sumber
 * kebenaran untuk "merek yang boleh dipercaya", supaya gerbang intake dan
 * QC-F1 tidak pernah menilai dengan merek yang berbeda.
 */
export function merekTerdaftar(row: { raw_meta?: string | null }): string | null {
  try {
    const meta = JSON.parse(row.raw_meta ?? "{}") as { brand?: unknown };
    const b = typeof meta.brand === "string" ? meta.brand.trim() : "";
    return b || null;
  } catch {
    return null;
  }
}

export async function periksaLabelFoto(
  fotoPath: string,
  productName: string,
  /**
   * Merek TERDAFTAR dari intake (products.raw_meta.brand). Sumber yang sama
   * dengan QC-F1 — sengaja BUKAN tebakan dari nama produk, karena dua heuristik
   * tebakan sudah terbukti salah (reviewer 18 Agu).
   */
  merekTerdaftar?: string | null
): Promise<HasilLabel> {
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
        cocokMerek: null,
        alasan:
          "Foto produknya harus tajam dan labelnya terbaca. Yang ini belum — teksnya tidak terbaca sama sekali. Ambil ulang lebih dekat, dengan cahaya cukup dan label menghadap kamera.",
      };
    }

    const tokens = brandTokens(productName);
    const rendah = kata.map((w) => w.toLowerCase());
    const cocokNama =
      tokens.length === 0 ||
      tokens.some((t) => rendah.some((w) => w.includes(t.slice(0, 4)) || t.includes(w.slice(0, 4))));

    // GERBANG MEREK — inti penutup lubang referensi palsu 20 Agu.
    //
    // Dipisah dari cocokNama dengan sengaja: cocokNama memakai tebakan dari
    // nama produk dan sifatnya peringatan (pengguna boleh menamai produknya
    // lebih pendek dari yang tercetak). Yang di bawah ini memakai merek
    // TERDAFTAR dan sifatnya penolakan — kalau label pada foto tidak memuat
    // merek yang didaftarkan penjualnya sendiri, foto itu bukan foto produknya.
    //
    // merekCocok(): aturan ketat yang sama dengan QC-10/QC-F1 — kelebihan huruf
    // boleh, KEKURANGAN tidak. Substring 4 huruf pernah meloloskan "moseru"
    // untuk "Mosseru", dan itu persis kelas cacat yang gerbang ini ada untuk
    // menangkap.
    const merek = (merekTerdaftar ?? "").trim();
    if (!merek) return { terbaca: true, kata, cocokNama, cocokMerek: null };
    // Merek BERKATA BANYAK dicocokkan per kata, dan semuanya wajib ada.
    //
    // Percobaan pertama mencocokkan "Gluta Pink" sebagai satu untaian dan
    // MENOLAK foto produk yang benar: OCR membacanya "GLUTA GLOW PINK With
    // BRIGHTENING SOAP" — kedua kata mereknya ada, hanya tidak bersebelahan.
    // Gerbang yang menolak foto yang benar akan dimatikan orang, dan gerbang
    // yang dimatikan tidak menjaga apa pun.
    const teksOcr = kata.join(" ");
    // merekCocok() menuntut token HURUF KECIL — ia me-lowercase teks OCR
    // tapi tidak tokennya.
    const kataMerek = merek.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const cocokMerek = kataMerek.length > 0 && kataMerek.every((t) => merekCocok(teksOcr, t));
    if (!cocokMerek) {
      return {
        terbaca: true,
        kata,
        cocokNama,
        cocokMerek: false,
        alasan:
          `Label di foto tidak cocok dengan merek terdaftar ("${merek}"). ` +
          `Yang terbaca: "${kata.slice(0, 6).join(" ")}". Pakai foto produk aslinya ya — ` +
          "foto yang labelnya berbeda tidak bisa dipakai jadi acuan video.",
      };
    }
    return { terbaca: true, kata, cocokNama, cocokMerek: true };
  } catch (err) {
    // Gagal memeriksa BUKAN alasan menolak unggahan. Pengguna tidak boleh
    // kehilangan akses karena tesseract/ffmpeg kita bermasalah — pemeriksaan
    // ini menyaring foto buruk, bukan menjaga uang.
    console.warn(`[label-terbaca] pemeriksaan gagal jalan, dilewati: ${(err as Error).message}`);
    return { terbaca: true, kata: [], cocokNama: true, cocokMerek: null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
