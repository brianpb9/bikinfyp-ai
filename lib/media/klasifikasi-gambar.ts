// FOTO PRODUK vs GRAFIS PROMOSI — diputuskan saat unggah, sekali.
//
// Kenapa ini ada. Model video memperlakukan gambar referensi sebagai "seperti
// inilah produknya". Kalau yang dikirim banner marketing — produk kecil di
// tengah, judul besar "Kulit Cerah Rahasianya Apa?", badge diskon, bunga
// properti — model menyalin SEMUANYA: teks banner ikut dilukis ke kemasan,
// dan hasilnya kemasan berhuruf karangan. Itu bukan kegagalan model, itu
// kegagalan bahan.
//
// Sudah pernah terjadi dan sudah pernah ditandai manusia: berkas fixture
// bernama `02-banner-promo-JANGAN-DIPAKAI.jpeg` di handover JJ Glow 18 Agu.
// Yang belum ada sampai sekarang: kode yang tahu bedanya.
//
// DUA SINYAL, keduanya murah dan tidak butuh model:
//
//   1. RASIO AREA TEKS — total luas kotak kata OCR dibagi luas gambar. Banner
//      dirancang supaya terbaca dari jauh, jadi hurufnya besar; foto produk
//      hanya punya teks label yang kecil.
//   2. JUMLAH KATA MEYAKINKAN — banner membawa headline, sub-headline, daftar
//      klaim, dan badge harga sekaligus.
//
// RAGU = TIDAK LOLOS (perintah Brian 20 Agu). Alasannya asimetris: menolak foto
// produk yang sah merepotkan satu pengguna dan ia bisa unggah ulang; menerima
// banner merusak SETIAP render sesudahnya dan baru ketahuan setelah dibayar.
//
// KEPUTUSAN BUKAN VONIS — koreksi 21 Agu, lihat JenisGambar di bawah.
// Aturan lama menuliskannya "RAGU = PROMOSI", dan bukan cuma keputusannya yang
// dibuat ketat: vonisnya ikut dipalsukan. Gambar yang tidak bisa diperiksa
// dicatat sebagai `promotional_graphic`, tidak bisa dibedakan dari banner
// sungguhan, selamanya. Sekarang keputusannya tetap sama ketat
// (`layakReferensi: false`) sementara catatannya jujur (`belum_diperiksa`).
//
// LUBANG WARISAN, DAN CARA IA TERTUTUP — KEBIJAKAN BERUBAH 21 Agu.
//
// Gambar yang ada sebelum classifier ini tidak punya sidecar kelayakan.
// Penutup lamanya adalah BACKFILL MALAS: gambar lama diklasifikasi saat hendak
// dipakai jadi referensi, dan sidecarnya ditulis dari dalam jalur baca.
//
// Itu DICABUT. Bukti yang dicetak di tengah jalur render tidak pernah dilihat
// siapa pun, tidak punya rantai kustodi, dan menempel pada bytes apa pun yang
// kebetulan ada di storage detik itu — dan di runtime tanpa biner ia membekukan
// vonis palsu secara permanen. Penggantinya KARANTINA: gambar tanpa bukti sah
// tidak layak jadi referensi, dan jalur baca tidak menulis apa pun. Bukti hanya
// diterbitkan di jalur ingestion/revalidasi yang terbukti punya binernya.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const jalankan = promisify(execFile);

/**
 * TIGA KEADAAN, BUKAN DUA.
 *
 * `belum_diperiksa` ditambahkan karena dua keadaan yang secara epistemik
 * berbeda sebelumnya dipetakan ke vonis yang sama:
 *
 *   diperiksa, ternyata banner      -> promotional_graphic   (vonis)
 *   TIDAK BISA diperiksa            -> promotional_graphic   (BUKAN vonis)
 *
 * Keputusan gerbangnya benar dan tidak berubah — ragu tidak boleh lolos, jadi
 * `layakReferensi` tetap `false` di kedua keadaan. Yang salah adalah CATATANNYA:
 * menuliskan "ini banner" saat yang terjadi adalah "saya tidak bisa memeriksa"
 * menghasilkan bukti yang berbohong, dan bukti itu permanen.
 *
 * Kenapa itu bukan soal kerapian: service web produksi berjalan di Render
 * `runtime: node` dan TIDAK dijamin punya ffmpeg/ffprobe/tesseract (hanya
 * Dockerfile.worker memasangnya), sementara seluruh jalur unggah berjalan di
 * web. Dengan dua keadaan, setiap foto produk yang sah yang diunggah di sana
 * dicap "promosi" selamanya oleh sidecar yang tidak bisa dibedakan dari banner
 * sungguhan oleh pembaca mana pun. Dengan tiga keadaan, catatannya jujur dan
 * boundary yang punya binernya bisa merevalidasinya.
 */
export type JenisGambar = "product_photo" | "promotional_graphic" | "belum_diperiksa";

/**
 * SATU SUMBER KEBIJAKAN untuk penerbit bukti DAN penilainya.
 *
 * `klasifikasiGambar` memakai objek ini saat MENERBITKAN bukti; validator
 * (lib/product-truth.ts) memakai objek yang SAMA saat MENILAINYA. Selama
 * keduanya menyalin ambang masing-masing, ambang bisa digeser di satu sisi dan
 * bukti diterbitkan dengan satu aturan lalu dinilai dengan aturan lain — tanpa
 * satu pun test merah.
 *
 * `versiBukti` mengikat keduanya ke revisi aturan yang sama. Setiap perubahan
 * ambang WAJIB menaikkannya; bukti versi lama tidak boleh dinilai dengan aturan
 * baru.
 */
export interface KebijakanKlasifikasi {
  /** Revisi aturan. Naikkan setiap kali ambang di bawah berubah. */
  versiBukti: number;
  /** Luas kotak teks / luas gambar. `>=` berarti promosi. */
  ambangRasio: number;
  /** Kata meyakinkan. `>=` berarti promosi. */
  ambangKata: number;
}

export const KEBIJAKAN_KLASIFIKASI: KebijakanKlasifikasi = {
  versiBukti: 1,
  ambangRasio: 0.02,
  ambangKata: 6,
};

export interface HasilKlasifikasi {
  jenis: JenisGambar;
  /** Boleh dipakai sebagai referensi visual untuk render. */
  layakReferensi: boolean;
  /** Total luas kotak kata OCR / luas gambar. */
  rasioAreaTeks: number;
  /** Kata >=3 huruf dengan keyakinan >= MIN_CONF. */
  jumlahKata: number;
  /** Alasan siap-tampil ke pengguna. */
  alasan: string;
}

/** Ambang keyakinan OCR — sama dengan gerbang label (label-terbaca.ts). */
const MIN_CONF = 60;

/**
 * Ambang DITURUNKAN DARI FIXTURE, bukan ditebak.
 *
 * Diukur 20 Agu atas berkas nyata (scripts/ukur-klasifikasi.ts):
 *
 *   01-packshot-bersih-351px.webp        rasio 0,0103  kata  2   foto produk
 *   canary-glow.jpg                      rasio 0,0014  kata  4   foto produk
 *   03-thumbnail.jpeg                    rasio 0,0024  kata  1   foto produk
 *   02-banner-promo-JANGAN-DIPAKAI.jpeg  rasio 0,0339  kata  2   BANNER
 *   04-crop-banner-JANGAN-DIPAKAI.png    rasio 0,0692  kata 23   BANNER
 *
 * Jurangnya bersih pada RASIO: foto produk berhenti di 0,0103, banner mulai
 * di 0,0339. Ambang 0,02 duduk di tengah jurang itu.
 *
 * JUMLAH KATA bukan sinyal yang bisa berdiri sendiri, dan itu ketahuan dari
 * fixture: banner promo 02 hanya membawa DUA kata meyakinkan ("Kulit Cerah
 * Rahasianya Apa?" — sisanya gagal OCR) sementara foto produk canary membawa
 * empat. Ia dipertahankan sebagai jaring kedua dengan ambang longgar (6),
 * bukan sebagai penentu.
 */
const { ambangRasio: AMBANG_RASIO, ambangKata: AMBANG_KATA } = KEBIJAKAN_KLASIFIKASI;

export async function klasifikasiGambar(fotoPath: string): Promise<HasilKlasifikasi> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klasifikasi-"));
  try {
    // Dinormalkan ke lebar tetap supaya rasio area bisa dibandingkan antar
    // gambar dengan resolusi berbeda-beda.
    const png = path.join(dir, "besar.png");
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", fotoPath, "-vf", "scale=1440:-2:flags=lanczos", png],
      { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
    // TIMEOUT WAJIB. Sampai 21 Agu panggilan ini satu-satunya dari ketiga biner
    // yang berjalan TANPA batas waktu — ffmpeg dan tesseract keduanya 20 detik.
    // ffprobe yang menggantung karena itu bisa menahan permintaan unggah
    // pengguna selamanya, sampai platform memutusnya, tanpa satu pun log yang
    // menjelaskan kenapa. Terukur di tests/klasifikasi-gambar.test.ts: sebelum
    // baris ini, mode "ffprobe MENGGANTUNG" harus dibunuh tenggat test.
    const { stdout: ukuran } = await jalankan("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", png],
      { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    const [w, h] = ukuran.trim().split(",").map(Number);
    const luas = Math.max(1, (w || 1440) * (h || 1440));

    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11", "tsv"],
      { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });

    let areaTeks = 0;
    let jumlahKata = 0;
    for (const baris of stdout.split("\n").slice(1)) {
      const k = baris.split("\t");
      if (k.length < 12) continue;
      const conf = Number(k[10]);
      const teks = (k[11] ?? "").replace(/[^A-Za-z0-9]/g, "");
      if (!Number.isFinite(conf) || conf < MIN_CONF || teks.length < 3) continue;
      const lw = Number(k[8]);
      const lh = Number(k[9]);
      if (!Number.isFinite(lw) || !Number.isFinite(lh)) continue;
      areaTeks += lw * lh;
      jumlahKata++;
    }

    const rasioAreaTeks = areaTeks / luas;
    const promosi = rasioAreaTeks >= AMBANG_RASIO || jumlahKata >= AMBANG_KATA;
    return promosi
      ? {
          jenis: "promotional_graphic",
          layakReferensi: false,
          rasioAreaTeks,
          jumlahKata,
          alasan:
            "Ini terbaca seperti materi promosi (banyak tulisan besar), bukan foto produk. " +
            "Untuk acuan video, pakai foto produknya saja — tanpa tulisan promo, badge harga, atau judul.",
        }
      : {
          jenis: "product_photo",
          layakReferensi: true,
          rasioAreaTeks,
          jumlahKata,
          alasan: "Foto produk.",
        };
  } catch (err) {
    // RAGU = TIDAK LOLOS, dan gagal memeriksa termasuk ragu.
    //
    // Ini KEBALIKAN dari gerbang label (label-terbaca.ts), yang meloloskan
    // unggahan saat OCR mati supaya pengguna tidak terkunci oleh alat kita.
    // Bedanya konsekuensi: di sana yang gagal cuma pemeriksaan mutu foto; di
    // sini yang salah menetapkan BAHAN untuk setiap render sesudahnya.
    //
    // TAPI KEPUTUSAN BUKAN VONIS. Sampai 21 Agu jalur ini mengembalikan
    // `promotional_graphic` — menuliskan "ini banner" untuk sesuatu yang tidak
    // pernah diperiksa. Yang dikembalikan sekarang `belum_diperiksa`: tetap
    // tidak layak (gerbangnya sama ketatnya), tapi catatannya jujur, dan
    // karena jujur ia bisa direvalidasi oleh boundary yang punya binernya.
    // Vonis palsu tidak bisa.
    console.warn(`[klasifikasi] gagal memeriksa, ditandai belum diperiksa: ${(err as Error).message}`);
    return {
      jenis: "belum_diperiksa",
      layakReferensi: false,
      rasioAreaTeks: 0,
      jumlahKata: 0,
      alasan: "Kami belum bisa memeriksa gambar ini. Coba unggah ulang foto produknya ya.",
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
