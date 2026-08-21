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
  readonly versiBukti: number;
  /** Luas kotak teks / luas gambar. `>=` berarti promosi. */
  readonly ambangRasio: number;
  /** Kata meyakinkan. `>=` berarti promosi. */
  readonly ambangKata: number;
}

/**
 * DIBEKUKAN, dan itu bukan formalitas.
 *
 * Versi pertama mengekspornya sebagai objek biasa sementara classifier menyalin
 * ambangnya SEKALI ke konstanta modul. Importer mana pun bisa memutasi
 * `ambangRasio`, lalu validator membaca nilai baru sementara classifier terus
 * memakai snapshot lama — persis perbedaan penerbit–penilai yang objek ini ada
 * untuk menutupnya, dihidupkan kembali lewat pintu belakang.
 *
 * Dua lapis: `readonly` menahan mutasi yang sengaja saat kompilasi,
 * `Object.freeze` menahan yang lewat `any`/JS biasa saat runtime. Dan tidak ada
 * lagi snapshot: setiap keputusan membaca objek ini langsung.
 */
export const KEBIJAKAN_KLASIFIKASI: KebijakanKlasifikasi = Object.freeze({
  versiBukti: 1,
  ambangRasio: 0.02,
  ambangKata: 6,
});

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
// SENGAJA TIDAK ADA konstanta snapshot di sini. Ambangnya dibaca langsung dari
// KEBIJAKAN_KLASIFIKASI di titik keputusan, supaya penerbit bukti dan penilainya
// tidak mungkin memakai nilai yang berbeda.

export interface OpsiKlasifikasi {
  /**
   * Batas per-eksekusi biner, ms. Default 20 detik — nilai produksi.
   *
   * Bisa diperpendek oleh pemanggil yang TIDAK BOLEH menunggu selama itu.
   * Probe kapabilitas `/api/health` contohnya: tiga tahap × 20 detik berarti
   * health check bisa tertahan satu menit oleh biner yang menggantung, dan
   * platform menganggap service-nya mati.
   */
  batasMs?: number;
}

export async function klasifikasiGambar(
  fotoPath: string,
  opsi: OpsiKlasifikasi = {}
): Promise<HasilKlasifikasi> {
  const batas = opsi.batasMs ?? 20_000;
  // `mkdtempSync` ADA DI DALAM try, dan itu koreksi 21 Agu.
  //
  // Sebelumnya ia di luar, jadi fungsi ini masih bisa MENOLAK walau seluruh
  // kegagalan biner ditangani di dalam — cukup TMPDIR tidak bisa ditulis.
  // Penolakan itu naik ke pemanggilnya, dan blok tangkap di sana menuliskan
  // vonis palsu "promosi" — persis bukti permanen yang berbohong yang perubahan
  // ini ada untuk menghapusnya.
  //
  // Kontraknya sekarang: fungsi ini TIDAK PERNAH menolak. Apa pun yang gagal,
  // jawabannya `belum_diperiksa` + `layakReferensi: false`.
  let dir = "";
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "klasifikasi-"));
    // Dinormalkan ke lebar tetap supaya rasio area bisa dibandingkan antar
    // gambar dengan resolusi berbeda-beda.
    const png = path.join(dir, "besar.png");
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", fotoPath, "-vf", "scale=1440:-2:flags=lanczos", png],
      { timeout: batas, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
    // TIMEOUT WAJIB. Sampai 21 Agu panggilan ini satu-satunya dari ketiga biner
    // yang berjalan TANPA batas waktu — ffmpeg dan tesseract keduanya 20 detik.
    // ffprobe yang menggantung karena itu bisa menahan permintaan unggah
    // pengguna selamanya, sampai platform memutusnya, tanpa satu pun log yang
    // menjelaskan kenapa. Terukur di tests/klasifikasi-gambar.test.ts: sebelum
    // baris ini, mode "ffprobe MENGGANTUNG" harus dibunuh tenggat test.
    const { stdout: ukuran } = await jalankan("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", png],
      { timeout: batas, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    const [w, h] = ukuran.trim().split(",").map(Number);
    const luas = Math.max(1, (w || 1440) * (h || 1440));

    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11", "tsv"],
      { timeout: batas, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });

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
    const promosi =
      rasioAreaTeks >= KEBIJAKAN_KLASIFIKASI.ambangRasio || jumlahKata >= KEBIJAKAN_KLASIFIKASI.ambangKata;
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
    // Pembersihan TIDAK BOLEH mengubah jawaban. `rmSync` bisa melempar
    // (izin, mount hilang), dan lemparan dari `finally` MENGGANTIKAN nilai
    // balik yang sudah benar dengan sebuah penolakan.
    try {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    } catch (errBersih) {
      console.warn(`[klasifikasi] gagal membersihkan ${dir}: ${(errBersih as Error).message}`);
    }
  }
}
